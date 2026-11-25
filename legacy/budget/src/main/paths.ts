import { join } from "node:path";

import { suitePaths } from "@suite/contracts";
import { app } from "electron";

import { type AppPaths, slopBudgetsFolder } from "./budgetLocation";
import { currentChannel } from "./channel";

export type { AppPaths };

/** The stable folder, kept separate so a pre-release export can refuse to write there. */
export function stableBudgetsFolder(): string {
  return suitePaths("Budget", {
    platform: process.platform,
    home: app.getPath("home"),
    documentsOverride: process.env.SUITE_BUDGET_LIBRARY,
    xdgDataHome: process.env.XDG_DATA_HOME,
  }).documents;
}

/**
 * Where this window keeps its things.
 *
 * `SUITE_BUDGET_LIBRARY` replaces the documents folder and `SUITE_BUDGET_DATA` the application
 * directory, for a test and a portable install. Neither is read from a document, so no file can steer
 * a write. A pre-release build keeps budgets in `Suite Slop/Budget` under that root, so it cannot
 * fall back to the stable folder.
 */
export function appPaths(root?: string): AppPaths {
  const channel = currentChannel();
  const documents =
    channel === "slop"
      ? slopBudgetsFolder(
          process.env.SUITE_BUDGET_LIBRARY?.trim() || join(app.getPath("home"), "Documents"),
        )
      : stableBudgetsFolder();
  const data = root?.trim() || process.env.SUITE_BUDGET_DATA?.trim() || app.getPath("userData");
  return {
    root: data,
    libraryFile: join(data, "library.json"),
    budgetsDir: documents,
    backupsDir: join(documents, ".backups"),
    recoveredDir: join(data, "recovered"),
    channel,
  };
}
