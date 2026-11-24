import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { hubReportPath, parseHubState, type SuiteHub } from "@suite/contracts";

/**
 * Where the hub says it listens, read from the hub's own report.
 *
 * An older Start wrote `hub.json` into the suite data directory whenever it started, stopped
 * or changed scope. No current writer exists after Start's retirement (#314), but Canvas still
 * reads the report if a machine has one: sharing a workspace should not begin with copying an
 * address out of another window. A file that is absent, unreadable or about another format is
 * simply "no answer" — the dialog falls back to its default and stays editable, because a person
 * can always type an address.
 */
export interface HubReport {
  readonly running: boolean;
  readonly address: string | null;
  readonly scope: "loopback" | "network";
}

export const NO_HUB: HubReport = { running: false, address: null, scope: "loopback" };

export async function readHub(): Promise<HubReport> {
  const path = hubReportPath({
    platform: process.platform,
    home: homedir(),
    xdgDataHome: process.env.XDG_DATA_HOME,
  });
  try {
    return fromReport(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return NO_HUB;
  }
}

export function fromReport(value: unknown): HubReport {
  const parsed = parseHubState(value);
  if (!parsed.ok) return NO_HUB;
  const report: SuiteHub = parsed.value;
  return { running: report.running, address: report.address, scope: report.scope };
}
