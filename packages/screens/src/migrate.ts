import { type ContractIssue, type SuiteWidgetSize, suiteWidgetSizeSchema } from "@suite/contracts";
import {
  parseScreen,
  type Screen,
  type ScreenRefusalReason,
  SUITE_SCREEN_FORMAT,
  SUITE_SCREEN_VERSION,
} from "./screen.js";

/**
 * Start's `dashboard.json`, migrated to a Screen.
 *
 * The old file is the current Start shape:
 *
 * ```json
 * { "format": "suite.start.dashboard", "version": 1,
 *   "widgets": [{ "id": "start.apps", "size": "full" }] }
 * ```
 *
 * Its `id` is already a registry id (`start.apps`, `start.recents`), so migration copies
 * the entries in order and keeps every one, including an id this build cannot resolve.
 * The host writes the new document and keeps the old file as a backup; this module has no
 * filesystem and no clock, so it can only produce the Screen and the sentence.
 *
 * A corrupt or newer file is refused whole. A partly migrated layout is worse than a
 * refusal, because the person cannot tell which half survived.
 */

export const START_DASHBOARD_FORMAT = "suite.start.dashboard";
export const START_DASHBOARD_VERSION = 1;

/** The stable id and name of the Screen Start's dashboard becomes. Home is a role. */
export const START_HOME_SCREEN_ID = "start-home";
export const START_HOME_SCREEN_NAME = "Home";

export interface MigratedDashboard {
  readonly ok: true;
  readonly screen: Screen;
}

export interface RefusedDashboard {
  readonly ok: false;
  readonly reason: ScreenRefusalReason | "empty";
  /** A complete sentence the host can show without adding a code. */
  readonly message: string;
  readonly issues: readonly ContractIssue[];
}

export type DashboardMigration = MigratedDashboard | RefusedDashboard;

function refuse(
  reason: RefusedDashboard["reason"],
  message: string,
  issues: readonly ContractIssue[] = [],
): RefusedDashboard {
  return { ok: false, reason, message, issues };
}

const CORRUPT =
  "Start could not read your dashboard, so it was not migrated and the file is unchanged.";
const NEWER =
  "Your dashboard was written by a newer Start, so it was not migrated and the file is unchanged.";
const EMPTY =
  "Your dashboard had no widget in it, so it was not migrated and the file is unchanged.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Migrate one dashboard value.
 *
 * Unknown widget ids are valid input, not corruption: they are copied to the Screen and
 * stay visible to the host until the app that provides them is installed.
 */
export function migrateStartDashboard(value: unknown): DashboardMigration {
  if (!isRecord(value)) return refuse("corrupt", CORRUPT);
  if (value.format !== START_DASHBOARD_FORMAT) return refuse("corrupt", CORRUPT);

  if (
    typeof value.version === "number" &&
    Number.isInteger(value.version) &&
    value.version > START_DASHBOARD_VERSION
  ) {
    return refuse("newer", NEWER);
  }
  if (value.version !== START_DASHBOARD_VERSION) return refuse("corrupt", CORRUPT);

  if (!Array.isArray(value.widgets)) return refuse("corrupt", CORRUPT);
  if (value.widgets.length === 0) return refuse("empty", EMPTY);
  if (value.widgets.length > 64) return refuse("corrupt", CORRUPT);

  const widgets: { registryId: string; size: SuiteWidgetSize }[] = [];
  const seen = new Set<string>();
  for (const candidate of value.widgets) {
    if (!isRecord(candidate)) return refuse("corrupt", CORRUPT);
    const id = candidate.id;
    const size = candidate.size;
    if (typeof id !== "string" || !suiteWidgetSizeSchema.safeParse(size).success) {
      return refuse("corrupt", CORRUPT);
    }
    if (seen.has(id)) return refuse("corrupt", CORRUPT);
    seen.add(id);
    widgets.push({ registryId: id, size: size as SuiteWidgetSize });
  }

  const parsed = parseScreen({
    format: SUITE_SCREEN_FORMAT,
    version: SUITE_SCREEN_VERSION,
    id: START_HOME_SCREEN_ID,
    name: START_HOME_SCREEN_NAME,
    widgets,
  });
  if (!parsed.ok) {
    return refuse("corrupt", CORRUPT, parsed.issues);
  }
  return { ok: true, screen: parsed.value };
}

/** Migrate the bytes of a dashboard file, refusing text that is not JSON at all. */
export function migrateStartDashboardJson(source: string): DashboardMigration {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    return refuse("corrupt", CORRUPT);
  }
  return migrateStartDashboard(value);
}

/** The default Start dashboard as a Screen, used when a host has no file at all. */
export function defaultStartDashboard(): MigratedDashboard {
  const parsed = parseScreen({
    format: SUITE_SCREEN_FORMAT,
    version: SUITE_SCREEN_VERSION,
    id: START_HOME_SCREEN_ID,
    name: START_HOME_SCREEN_NAME,
    widgets: [{ registryId: "start.apps", size: "full" }],
  });
  if (!parsed.ok) throw new Error(parsed.message);
  return { ok: true, screen: parsed.value };
}
