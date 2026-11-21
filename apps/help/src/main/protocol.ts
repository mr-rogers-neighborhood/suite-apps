import { statSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

import { resolveProtocolAsset } from "@suite/desktop";
import { net, protocol } from "electron";

/**
 * The renderer's own origin.
 *
 * `file://` gives every page a privileged origin and is called out by Electron's
 * security checklist. `suite-help://app` is a real, secure origin instead, so the
 * handbook routes, the generated data under `/data` and local storage all work,
 * and the page cannot reach anything the policy does not name.
 */
const APP_SCHEME = "suite-help";
const APP_HOST = "app";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_ENTRY = `${APP_ORIGIN}/`;

/** The pages this app's window answers: its bundle and, while developing, Vite. */
export function pageOrigins(): readonly string[] {
  const dev = process.env.ELECTRON_RENDERER_URL;
  return dev === undefined || dev === "" ? [APP_ORIGIN] : [APP_ORIGIN, dev];
}

/** Must run before `app.whenReady()`. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ]);
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * The file a request resolves to, with the SPA fallback.
 *
 * A route such as `/handbook/reference/commands` has no file of its own; a
 * request whose last segment carries no extension is a page, so it receives
 * `index.html` and the router reads the path. A missing asset keeps its 404:
 * answering a failed module request with HTML would produce a syntax error that
 * reads like a build bug.
 */
export function assetFileFor(
  requestUrl: string,
  root: string,
  exists: (path: string) => boolean = isFile,
): string | null {
  const resolved = resolveProtocolAsset(requestUrl, root, {
    scheme: APP_SCHEME,
    hosts: [APP_HOST],
  });
  if (!resolved.ok) return null;
  if (exists(resolved.file)) return resolved.file;

  const last = basename(resolved.file);
  if (last.includes(".")) return null;
  const index = join(root, "index.html");
  return exists(index) ? index : null;
}

/** Serve the built renderer through the shared resolver. */
export function serveRenderer(root: string, csp: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const file = assetFileFor(request.url, root);
    if (file === null) return new Response("not found", { status: 404 });

    // `net.fetch`, not the global: only this one can read a file URL.
    const response = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(response.headers);
    headers.set("Content-Security-Policy", csp);
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(response.body, { status: response.status, headers });
  });
}
