import { isSafePackId } from "@suite/pack/manifest";
import type { PackLaunchContext } from "@suite/pack-runtime";
import type { PackInfo } from "./packs.js";

/**
 * `suite://<pack-id>/<path>` routing.
 *
 * The input is untrusted by construction: a browser, a desktop file, a second
 * copy of Suite or the operating system can hand over any string. This function
 * decides only which *installed* pack a link names. It has no side effects, so a
 * link can never install or update anything; opening the tab is the caller's
 * job. A refusal carries one sentence for the host notice.
 */

export type SuiteLinkRefusal =
  | "empty-target"
  | "not-a-suite-url"
  | "credentials-or-port"
  | "malformed-id"
  | "unknown-pack"
  | "no-entry";

export interface SuiteLink {
  readonly pack: PackInfo;
  /** The canonical link as the pack receives it in its launch context. */
  readonly url: string;
  /** The decoded path after the pack id. The host does not load it. */
  readonly path: string;
  readonly launch: PackLaunchContext;
}

export type SuiteLinkParse =
  | { readonly ok: true; readonly value: SuiteLink }
  | { readonly ok: false; readonly reason: SuiteLinkRefusal; readonly message: string };

/** The context a tab was opened without a link. */
export const LAUNCHER_CONTEXT: PackLaunchContext = Object.freeze({ kind: "launcher" });

/** The launch context for a deep link, or the plain launcher context. */
export function launchContextForLink(url: string | null): PackLaunchContext {
  return url === null ? LAUNCHER_CONTEXT : { kind: "deep-link", url };
}

/**
 * Parse one Suite link against the installed packs.
 *
 * A malformed id, an unknown or uninstalled pack, and a pack with no entry are
 * refused. A link never becomes an install: the caller already has the pack list
 * and the result is either a tab to open or a sentence to show.
 */
export function parseSuiteLink(input: string, packs: readonly PackInfo[]): SuiteLinkParse {
  const trimmed = input.trim();
  if (trimmed.length === 0) return refuse("empty-target", "That Suite link is empty.");

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return refuse("not-a-suite-url", "That is not a Suite link.");
  }
  if (parsed.protocol.toLowerCase() !== "suite:") {
    return refuse("not-a-suite-url", "That is not a Suite link.");
  }
  if (parsed.username.length > 0 || parsed.password.length > 0 || parsed.port.length > 0) {
    return refuse(
      "credentials-or-port",
      "That Suite link carries credentials or a port, which this host refuses.",
    );
  }

  const packId = parsed.hostname.toLowerCase();
  if (!isSafePackId(packId)) {
    return refuse("malformed-id", "That Suite link does not name a valid pack id.");
  }

  const pack = packs.find((candidate) => candidate.id === packId);
  if (pack === undefined) {
    return refuse(
      "unknown-pack",
      `The pack “${packId}” is not installed. Open the launcher to install it.`,
    );
  }
  if (pack.entry.trim().length === 0) {
    return refuse("no-entry", `${pack.name} does not name an entry to open.`);
  }

  const url = parsed.toString();
  return {
    ok: true,
    value: {
      pack,
      url,
      path: decodePath(parsed.pathname),
      launch: launchContextForLink(url),
    },
  };
}

/** True when a command-line argument is the Suite link this host should route. */
export function suiteLinkFromArgv(argv: readonly string[]): string | null {
  return argv.find((argument) => /^suite:\/\//iu.test(argument.trim()))?.trim() ?? null;
}

function decodePath(pathname: string): string {
  try {
    return decodeURIComponent(pathname.replace(/^\//u, ""));
  } catch {
    return pathname.replace(/^\//u, "");
  }
}

function refuse(reason: SuiteLinkRefusal, message: string): SuiteLinkParse {
  return { ok: false, reason, message };
}
