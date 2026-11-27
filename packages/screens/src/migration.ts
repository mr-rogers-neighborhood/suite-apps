import {
  type ScreenRefusal,
  findFreePlacement,
  type OccupiedPlacement,
  SUITE_SCREEN_FORMAT,
  SUITE_SCREEN_VERSION,
  screenCorruption,
} from "./screen.js";
import type { SuiteWidgetSize } from "@suite/contracts";

const KNOWN_SIZES = new Set<string>(["1x1", "1x2", "2x1", "2x2", "full"]);

/**
 * Pack version-2 entries into the four-cell grid in document order.
 *
 * Version 2 had order and size but no coordinates. The first free cell, scanning left
 * to right and top to bottom, is the closest thing to that order a grid can express. No
 * entry is dropped; a Screen that already fills the visible rows simply grows.
 */
function packEntries(entries: readonly unknown[]): readonly unknown[] {
  const placed: OccupiedPlacement[] = [];
  return entries.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return entry;
    const record = entry as Record<string, unknown>;
    const size = (
      typeof record.size === "string" && KNOWN_SIZES.has(record.size) ? record.size : "1x1"
    ) as SuiteWidgetSize;
    const cell = findFreePlacement(placed, size);
    placed.push({ ...cell, size });
    return { ...record, ...cell };
  });
}

/**
 * The one migration chain a Screen travels, wherever its bytes came from.
 *
 * The host store and the portable `.screen` importer both call this module. A
 * version that is newer than this build is refused, never guessed at; a version
 * with no step is refused with a sentence rather than read as the current shape.
 *
 * A step is deliberately small and total: it receives the whole logical screen and
 * returns the next version. `document.ts` then rebuilds the Loro containers from the
 * migrated value, so an older snapshot becomes current without a second reader.
 */

export interface ScreenMigrationStep {
  readonly from: number;
  readonly to: number;
  /** One version's change. It may rewrite entries but may not drop a placement. */
  readonly migrate: (screen: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Version 2 added the row primitive. The version-1 entries are already valid
 * version-2 widgets, so the step stamps the version and leaves order, size and
 * settings exactly as they were.
 */
export const SCREEN_MIGRATIONS: readonly ScreenMigrationStep[] = [
  {
    from: 1,
    to: 2,
    migrate: (screen) => ({ ...screen, version: 2 }),
  },
  {
    /**
     * Version 3 places every entry on the four-cell grid. The pack keeps document order
     * and size; nothing is dropped or reshaped.
     */
    from: 2,
    to: 3,
    migrate: (screen) => ({
      ...screen,
      version: 3,
      widgets: Array.isArray(screen.widgets) ? packEntries(screen.widgets) : screen.widgets,
    }),
  },
];

export type ScreenMigration =
  | {
      readonly ok: true;
      readonly value: unknown;
      /** The version the value arrived with; equal to the current version when new. */
      readonly fromVersion: number;
    }
  | ScreenRefusal;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Move one logical Screen to the current version.
 *
 * The chain must be contiguous and may not loop. A missing edge names the version
 * and the action: open the file in the Suite that wrote it, or update this build.
 */
export function migrateScreen(value: unknown): ScreenMigration {
  if (!isRecord(value)) {
    return screenCorruption("This file is not a Suite screen.");
  }
  if (value.format !== SUITE_SCREEN_FORMAT) {
    return screenCorruption("This file is not a Suite screen.");
  }

  const fromVersion = value.version;
  if (typeof fromVersion !== "number" || !Number.isInteger(fromVersion) || fromVersion < 1) {
    return screenCorruption(
      "This screen does not name a version this build can read. Re-export it from the Suite that wrote it.",
    );
  }

  if (fromVersion > SUITE_SCREEN_VERSION) {
    return {
      ok: false,
      reason: "newer",
      message:
        "This screen was written by a newer Suite, so this version cannot open it. Open it in a newer Suite Desk. The file has been left alone.",
      issues: [],
    };
  }

  let current = { ...value };
  let version = fromVersion;
  const visited = new Set<number>();

  while (version < SUITE_SCREEN_VERSION) {
    if (visited.has(version)) {
      return screenCorruption(
        `This screen has a migration loop at version ${version}, so this build cannot open it. Open it in the Suite that wrote it.`,
      );
    }
    visited.add(version);

    const step = SCREEN_MIGRATIONS.find((candidate) => candidate.from === version);
    if (step === undefined) {
      return screenCorruption(
        `This screen is version ${version}, and this build has no step from it. Open it in the Suite that wrote it, or update Suite Desk.`,
      );
    }

    current = step.migrate(current);
    if (current.version !== step.to) {
      return screenCorruption(
        `This screen could not be migrated past version ${version}. Open it in the Suite that wrote it.`,
      );
    }
    version = step.to;
  }

  return { ok: true, value: current, fromVersion };
}
