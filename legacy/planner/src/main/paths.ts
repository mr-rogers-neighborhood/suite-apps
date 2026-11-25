import { join } from "node:path";

import { suitePaths } from "@suite/contracts";
import { app } from "electron";

import { currentChannel, type DocumentChannel } from "./channel";
import { slopWorkspaceFolder, type WorkspacePaths, workspacePathsFrom } from "./workspaceLocation";

export type { WorkspacePaths };

/**
 * The person's documents root. A pre-release appends its own folder below it rather than sharing the
 * stable app folder.
 */
function documentsRoot(): string {
  return process.env.SUITE_PLANNER_LIBRARY?.trim() || join(app.getPath("home"), "Documents");
}

/**
 * Where the suite convention puts planner's documents.
 *
 * `SUITE_PLANNER_LIBRARY` replaces the folder for a test and a portable install; it is never read
 * from a document, so no file can steer a write. A pre-release build gets `Suite Slop/Planner`
 * under that root, so it cannot fall back to the stable folder.
 */
export function workspaceFolder(channel: DocumentChannel = currentChannel()): string {
  if (channel === "slop") return slopWorkspaceFolder(documentsRoot());
  return suitePaths("Planner", {
    platform: process.platform,
    home: app.getPath("home"),
    documentsOverride: process.env.SUITE_PLANNER_LIBRARY,
    xdgDataHome: process.env.XDG_DATA_HOME,
  }).documents;
}

/** The paths for the default workspace, or for the file a caller names. */
export function workspacePaths(file?: string | null): WorkspacePaths {
  return workspacePathsFrom(workspaceFolder(), file);
}
