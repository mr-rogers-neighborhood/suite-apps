import { randomBytes, timingSafeEqual } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { isLoopbackHost } from "./tls.js";
export async function createRelayConsole(options) {
    const token = randomBytes(24).toString("base64url");
    const expected = Buffer.from(token, "utf8");
    const now = options.now ?? (() => new Date());
    const server = createServer((request, response) => {
        void handle(request, response).catch(() => {
            if (!response.headersSent)
                response.writeHead(500, { "content-type": "text/plain" });
            response.end("the console could not read the relay's state\n");
        });
    });
    async function handle(request, response) {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (request.method !== "GET") {
            response.writeHead(405, { allow: "GET", "content-type": "text/plain" });
            response.end("only GET is allowed\n");
            return;
        }
        if (!authorised(request, url, expected)) {
            // A valid token is the only way in, and a rejected request learns nothing.
            response.writeHead(401, { "content-type": "text/plain", "cache-control": "no-store" });
            response.end("this console needs the token suite-sync printed at startup\n");
            return;
        }
        if (url.pathname === "/console" || url.pathname === "/console/") {
            const state = await stateOf();
            response.writeHead(200, {
                "content-type": "text/html; charset=utf-8",
                "cache-control": "no-store",
                "x-content-type-options": "nosniff",
                "referrer-policy": "no-referrer",
                "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; " +
                    "img-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
            });
            response.end(page(state));
            return;
        }
        if (url.pathname === "/console/state") {
            response.writeHead(200, {
                "content-type": "application/json; charset=utf-8",
                "cache-control": "no-store",
                "x-content-type-options": "nosniff",
                "referrer-policy": "no-referrer",
            });
            response.end(`${JSON.stringify(await stateOf())}\n`);
            return;
        }
        response.writeHead(404, { "content-type": "text/plain", "cache-control": "no-store" });
        response.end("not found\n");
    }
    async function stateOf() {
        const storeBytes = await directorySize(options.store);
        const workspaces = options
            .rooms()
            .map((room) => ({
            workspaceId: room.workspaceId,
            frames: room.log.length,
            newestEpoch: room.log.newestEpoch,
            connectedDevices: room.sockets.size,
            members: Object.entries(room.roles.roles)
                .map(([deviceId, role]) => ({
                name: room.keys.get(deviceId)?.name ?? "A device",
                role,
            }))
                .sort((left, right) => left.name.localeCompare(right.name)),
        }))
            .sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));
        return {
            status: "running",
            version: options.version,
            protocolVersion: options.protocolVersion,
            secure: options.fingerprint !== null,
            relayUrl: options.relayUrl,
            bind: options.bind,
            store: { path: options.store, bytes: storeBytes },
            fingerprint: options.fingerprint,
            workspaces,
            checkedAt: now().toISOString(),
        };
    }
    function page(state) {
        const workspaceRows = state.workspaces.length === 0
            ? '<p class="quiet">No workspace has joined this relay yet.</p>'
            : state.workspaces
                .map((workspace) => `<article class="workspace">
  <h3><code>${escapeHtml(workspace.workspaceId)}</code></h3>
  <p>${workspace.frames} ${workspace.frames === 1 ? "frame" : "frames"} · epoch ${workspace.newestEpoch === null ? "none" : workspace.newestEpoch} · ${workspace.connectedDevices} ${workspace.connectedDevices === 1 ? "connection" : "connections"}</p>
  <ul>${workspace.members
                .map((member) => `<li>${escapeHtml(member.name)} · ${escapeHtml(member.role)}</li>`)
                .join("")}</ul>
</article>`)
                .join("\n");
        return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Suite Sync console</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0 auto; max-width: 52rem; padding: 2rem 1.25rem 4rem; font: 15px/1.5 system-ui, sans-serif; }
  h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
  h2 { font-size: 1.05rem; margin: 2rem 0 .5rem; }
  h3 { font-size: .95rem; margin: 0 0 .35rem; }
  p { margin: .25rem 0; }
  code { font-family: ui-monospace, monospace; word-break: break-all; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: .3rem 1rem; margin: 0; }
  dt { color: color-mix(in srgb, currentColor 60%, transparent); }
  dd { margin: 0; }
  .quiet { color: color-mix(in srgb, currentColor 65%, transparent); }
  .workspace { border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: .5rem; padding: .75rem 1rem; margin: .5rem 0; }
  ul { margin: .35rem 0 0; padding-left: 1.2rem; }
  footer { margin-top: 3rem; color: color-mix(in srgb, currentColor 65%, transparent); }
</style>
</head>
<body>
<header>
  <h1>Suite Sync</h1>
  <p>Running · version ${escapeHtml(String(state.version))} · relay protocol ${escapeHtml(String(state.protocolVersion))}</p>
</header>

<section>
  <h2>Relay</h2>
  <dl>
    <dt>Address</dt><dd><code>${escapeHtml(state.relayUrl)}</code></dd>
    <dt>Listening</dt><dd><code>${escapeHtml(state.bind)}</code></dd>
    <dt>Transport</dt><dd>${state.secure ? "wss (certificate pinned)" : "ws (loopback plaintext)"}</dd>
    <dt>Certificate</dt><dd>${state.fingerprint === null
            ? "none on loopback plaintext"
            : `<code>${escapeHtml(state.fingerprint)}</code>`}</dd>
    <dt>Store</dt><dd><code>${escapeHtml(state.store.path)}</code> · ${formatBytes(state.store.bytes)}</dd>
  </dl>
</section>

<section>
  <h2>Workspaces</h2>
  ${workspaceRows}
</section>

<footer>
  <p>This page reads the relay's metadata only. It never opens a frame and shows no keys.</p>
</footer>
<script>setInterval(function () { location.reload(); }, 5000);</script>
</body>
</html>
`;
    }
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        // The one line this module must never be talked out of: loopback, not a host
        // the caller named. A console on a reachable interface would be a second,
        // weaker door into the relay's metadata.
        server.listen(0, "127.0.0.1", () => {
            server.removeListener("error", reject);
            resolve();
        });
    });
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    return {
        host: "127.0.0.1",
        port,
        url: `http://127.0.0.1:${port}/console?token=${encodeURIComponent(token)}`,
        token,
        async close() {
            await new Promise((resolve) => server.close(() => resolve()));
        },
    };
}
/**
 * The address a device would be given, rather than the address the relay bound.
 *
 * `0.0.0.0` is a bind, not somewhere a client can connect; handing it out is how a
 * relay guide produces a link that works nowhere. A wildcard becomes this machine's
 * first reachable IPv4 address, and loopback stays loopback.
 */
export function advertisedRelayUrl(host, port, secure) {
    const bindHost = host.trim().replace(/^\[/u, "").replace(/\]$/u, "");
    const reachable = bindHost === "0.0.0.0" || bindHost === "::" || bindHost.length === 0
        ? (firstLanAddress() ?? "127.0.0.1")
        : isLoopbackHost(bindHost)
            ? "127.0.0.1"
            : bindHost;
    const formatted = reachable.includes(":") ? `[${reachable}]` : reachable;
    return `${secure ? "wss" : "ws"}://${formatted}:${port}/sync`;
}
function firstLanAddress() {
    for (const entries of Object.values(networkInterfaces())) {
        for (const entry of entries ?? []) {
            if (entry.family === "IPv4" && !entry.internal)
                return entry.address;
        }
    }
    return null;
}
function authorised(request, url, expected) {
    const header = request.headers["x-suite-console-token"];
    const provided = typeof header === "string" ? header : (url.searchParams.get("token") ?? "");
    const candidate = Buffer.from(provided, "utf8");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
async function directorySize(directory) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    let total = 0;
    for (const entry of entries) {
        const path = join(directory, entry.name);
        try {
            if (entry.isDirectory())
                total += await directorySize(path);
            else if (entry.isFile())
                total += (await stat(path)).size;
            // A symlink is skipped rather than followed: the console reports the store,
            // not whatever a link points at.
        }
        catch {
            // A file that vanished between the listing and the stat is just not counted.
        }
    }
    return total;
}
function formatBytes(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    const units = ["KiB", "MiB", "GiB", "TiB"];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}
function escapeHtml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}
//# sourceMappingURL=console.js.map