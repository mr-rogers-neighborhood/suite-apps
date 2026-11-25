import { pathToFileURL } from "node:url";
import { desktopCsp } from "@suite/desktop";
import { net, type Session } from "electron";
import { DEFAULT_CONTAINER_ID } from "./container.js";
import { type PackInfo, resolvePackRequest } from "./packs.js";
import { PACK_SCHEME } from "./shared.js";

/**
 * Serve one pack from its own session.
 *
 * A custom partition has its own protocol table: registering `suite-pack` on the
 * default session would leave a sandboxed pack with no handler at all. This
 * registers the scheme on the pack's session and answers only that pack's
 * `<container>.<pack>` host, so one session cannot borrow another pack's origin.
 */
export function registerPackProtocol(
  packSession: Session,
  pack: PackInfo,
  containerId = DEFAULT_CONTAINER_ID,
): void {
  packSession.protocol.handle(PACK_SCHEME, async (request) => {
    const resolved = resolvePackRequest(request.url, [pack], containerId);
    if (resolved === null) return new Response("not found", { status: 404 });

    const network = pack.capabilities.includes("network");
    const csp = network
      ? desktopCsp({ wasm: true, connectSrc: ["https:", "wss:"] })
      : desktopCsp({ wasm: true });
    const response = await net.fetch(pathToFileURL(resolved.file).toString());
    const headers = new Headers(response.headers);
    headers.set("Content-Security-Policy", csp);
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(response.body, { status: response.status, headers });
  });
}
