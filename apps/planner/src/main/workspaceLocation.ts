import { copyFile, mkdir, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { SUITE_PROTOCOL, workspaceTarget } from "@suite/contracts";

import type { DocumentChannel } from "./channel";

/**
 * Where a planner workspace lives on disk.
 *
 * The file goes where a person looks for it, under `Documents/Suite/Planner`, so it can be copied,
 * backed up or put in a folder their own cloud already syncs. Its backup and temporary file sit
 * beside it for the same reason: recovery with a file manager is what the naming promises.
 *
 * Nothing here reads Electron or the environment, so the layout and the migration below are a test
 * rather than something only a running window can demonstrate.
 */
export type WorkspacePaths = {
  dir: string;
  workspace: string;
  backup: string;
  temp: string;
};

/**
 * The paths for one workspace file, or the default file in `documents`.
 *
 * A file can be handed over by the operating system or by the hub, so the layout follows whatever
 * name it arrives with rather than assuming the default one.
 */
export function workspacePathsFrom(documents: string, file?: string | null): WorkspacePaths {
  const chosen = file?.trim();
  const workspace = chosen ? chosen : join(documents, "workspace.planner");
  const dir = dirname(workspace);
  const stem = basename(workspace).replace(/\.planner$/u, "");
  return {
    dir,
    workspace,
    backup: join(dir, `${stem}.backup.planner`),
    temp: `${workspace}.tmp`,
  };
}

/** The folder a pre-release keeps documents in, a sibling of `Documents/Suite`. */
export const SLOP_DOCUMENTS_FOLDER = "Suite Slop";

/** The pre-release folder for this app, given the person's documents root. */
export function slopWorkspaceFolder(documentsRoot: string, app = "Planner"): string {
  return join(documentsRoot, SLOP_DOCUMENTS_FOLDER, app);
}

/** Whether `path` sits inside `directory`, rather than merely sharing a prefix with it. */
export function isInFolder(path: string, directory: string): boolean {
  const remainder = relative(resolve(directory), resolve(path));
  return remainder === "" || (!remainder.startsWith("..") && !isAbsolute(remainder));
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Where a handed-over file is opened, and the folder that decides whether it must be copied. */
export interface ChannelOpen {
  readonly channel: DocumentChannel;
  readonly folder: string;
}

/**
 * The file a build should actually open.
 *
 * A stable build opens what it is given. A pre-release copies any file outside its own folder and
 * opens the copy, so a workspace, its backup and its temporary file in the stable folder are never
 * touched. An existing copy is opened rather than overwritten, because replacing it would discard
 * the work already done in this channel.
 */
export async function adoptChannelWorkspace(source: string, open: ChannelOpen): Promise<string> {
  if (open.channel === "stable") return source;
  if (isInFolder(source, open.folder)) return source;

  await mkdir(open.folder, { recursive: true });
  const target = join(open.folder, basename(source));
  if (await exists(target)) return target;
  await copyFile(source, target);
  return target;
}

/**
 * Copy a workspace kept in the old application directory into the documents folder.
 *
 * Runs once: with the destination already there, nothing happens. The original stays where it was,
 * because a migration that deletes the only copy on a hunch is how a person loses a year of tasks.
 * It answers the paths it copied, which is what a log line and a test need.
 */
export async function adoptLegacyWorkspace(
  destination: WorkspacePaths,
  legacyDir: string,
): Promise<readonly string[]> {
  if (destination.dir === legacyDir) return [];
  if (await exists(destination.workspace)) return [];

  const legacyWorkspace = join(legacyDir, "workspace.planner");
  if (!(await exists(legacyWorkspace))) return [];

  await mkdir(destination.dir, { recursive: true });
  await copyFile(legacyWorkspace, destination.workspace);
  const copied = [destination.workspace];

  const legacyBackup = join(legacyDir, "workspace.backup.planner");
  if ((await exists(legacyBackup)) && !(await exists(destination.backup))) {
    await copyFile(legacyBackup, destination.backup);
    copied.push(destination.backup);
  }
  return copied;
}

/**
 * The workspace a `suite://planner/workspace/<name>` link names, when this machine has it.
 *
 * The hub opens a document by launching this app with a link, so the rule is worth a test: the name
 * must be a `.planner` file, and it must be in the documents folder. Anything else returns null, and
 * the caller opens the default workspace instead of failing a link the person did not type.
 *
 * `exists` is a parameter rather than an import for the same reason the rest of this module takes its
 * paths: so the rule is a test, not something only a running window demonstrates.
 */
export function workspaceFromLink(
  link: string,
  folder: string,
  exists: (path: string) => boolean,
): string | null {
  const name = workspaceTarget(link, "planner");
  if (name === null || !/\.planner$/iu.test(name)) return null;
  const candidate = join(folder, name);
  return exists(candidate) ? candidate : null;
}

/**
 * The workspace a command line names: a path from the desktop, or a link the hub routed here.
 *
 * The link is read first and never falls through to the path test. A link ends in `.planner` too, and
 * treating one as a path is how the app tries to open a file called `suite:` — which is exactly the bug
 * this ordering exists to prevent.
 */
export function workspaceFromArgv(
  argv: readonly string[],
  folder: string,
  exists: (path: string) => boolean,
): string | null {
  for (const argument of argv.slice(1)) {
    if (argument.startsWith("-")) continue;
    if (argument.startsWith(SUITE_PROTOCOL)) {
      const named = workspaceFromLink(argument, folder, exists);
      if (named !== null) return named;
      continue;
    }
    if (/\.planner$/iu.test(argument)) return argument;
  }
  return null;
}
