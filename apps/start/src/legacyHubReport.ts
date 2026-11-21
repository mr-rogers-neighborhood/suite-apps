import { rm } from "node:fs/promises";
import { hubReportPath } from "@suite/contracts";

/**
 * The `hub.json` an older Start wrote about a relay it supervised.
 *
 * Canvas still reads this file to prefill a relay address. A report left behind by
 * a Start that owned the relay would keep claiming one is running and offer a dead
 * address, so this Start removes it before the first window reads state. There is
 * no replacement to write: this Start owns no relay, and a new writer here would
 * only invent a second claim.
 */
export interface LegacyHubReportOptions {
  readonly platform: NodeJS.Platform;
  readonly home: string;
  /** `undefined` on the host means `$HOME/.local/share`; a sandbox passes the host path. */
  readonly xdgDataHome?: string | undefined;
}

/** The path Canvas reads, resolved the same way Canvas resolves it. */
export function legacyHubReportPath(options: LegacyHubReportOptions): string {
  return hubReportPath(options);
}

/**
 * Remove the legacy report. Returns false when the file could not be removed.
 *
 * A missing file is success: the promise is that no stale claim survives, not that
 * this particular launch found one.
 */
export async function clearLegacyHubReport(options: LegacyHubReportOptions): Promise<boolean> {
  try {
    await rm(legacyHubReportPath(options), { force: true });
    return true;
  } catch {
    return false;
  }
}
