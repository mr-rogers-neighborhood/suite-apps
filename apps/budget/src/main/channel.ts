import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Which document folder this build may use.
 *
 * Stable keeps `Documents/Suite/Budget`. A pre-release keeps its work in a folder of its own, so a
 * test build can never write a stable budget in place. The identity comes from the manifest a
 * packaged app ships beside its executable, or from the Flatpak id the sandbox sets; a build without
 * either is stable. Nothing here reads a document, so no file can steer where work is written.
 */
export type DocumentChannel = "stable" | "slop";

export interface ChannelSignals {
  /** `FLATPAK_ID`: a pre-release Flatpak is `run.suite.slop.budget`. */
  readonly flatpakId?: string | undefined;
  /** A parsed `suite.app.json` from beside the executable, when there is one. */
  readonly manifest?: unknown;
}

const SLOP_FLATPAK_PREFIX = "run.suite.slop.";

/**
 * The pre-release manifest id, `slop-<app>`.
 *
 * The release script writes it into a pre-release `suite.app.json`; the hyphen is the canonical
 * form. The dot form is the id an older pre-release build was installed with, and it is still read
 * because that manifest is not rewritten in place — calling it stable would give it the stable
 * documents folder.
 */
const SLOP_MANIFEST_PREFIX = "slop-";
const LEGACY_SLOP_MANIFEST_PREFIX = "slop.";

function manifestIsPreRelease(manifest: unknown): boolean {
  if (typeof manifest !== "object" || manifest === null) return false;
  const record = manifest as Record<string, unknown>;

  // A top-level `channel` is the build's channel. `update.channel` is the release feed and is
  // deliberately not read here: every current stable manifest names `alpha` as its update channel.
  if (typeof record.channel === "string") {
    const channel = record.channel.trim().toLowerCase();
    if (channel.length > 0 && channel !== "stable") return true;
  }

  if (typeof record.id === "string") {
    const id = record.id.trim().toLowerCase();
    if (
      id.startsWith(SLOP_MANIFEST_PREFIX) ||
      id.startsWith(LEGACY_SLOP_MANIFEST_PREFIX) ||
      id.startsWith(SLOP_FLATPAK_PREFIX)
    ) {
      return true;
    }
  }
  return false;
}

/** The channel a build belongs to, from signals a packaged app can supply. */
export function channelFrom(signals: ChannelSignals): DocumentChannel {
  const flatpakId = signals.flatpakId?.trim().toLowerCase() ?? "";
  if (flatpakId.startsWith(SLOP_FLATPAK_PREFIX)) return "slop";
  return manifestIsPreRelease(signals.manifest) ? "slop" : "stable";
}

/** Read the manifest beside an executable, without letting a bad file stop the app. */
export function manifestBeside(execPath: string): unknown {
  try {
    return JSON.parse(readFileSync(join(dirname(execPath), "suite.app.json"), "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

/** The channel of the running build. */
export function currentChannel(): DocumentChannel {
  return channelFrom({
    flatpakId: process.env.FLATPAK_ID,
    manifest: manifestBeside(process.execPath),
  });
}
