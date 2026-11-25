import { join, sep } from "node:path";
import { SUITE_PROTOCOL, workspaceTarget } from "@suite/contracts";

import type { DocumentChannel } from "./channel";

/**
 * Where budget files live, and where the recovery copies live.
 *
 * The budgets themselves go into `~/Documents/Suite/Budget`, the folder the suite's convention gives
 * them, so a person can copy, back them up or sync the folder they already own. The daily backups sit
 * beside them under `.backups`, which is the promise that a file manager can recover a budget when the
 * app is the thing that broke.
 *
 * The library index and the recovered copies stay in the application directory: they are machine
 * state, and a synced index would describe files another machine does not have.
 *
 * Nothing here reads Electron, so the layout is a test rather than something only a window can show.
 */
export type AppPaths = {
  /** The application directory: the index and recovery copies. */
  root: string;
  libraryFile: string;
  budgetsDir: string;
  backupsDir: string;
  recoveredDir: string;
  /**
   * Which build owns `budgetsDir`. A pre-release copies a stable budget into its own folder rather
   * than opening one in place.
   */
  channel: DocumentChannel;
};

/** The folder a pre-release keeps documents in, a sibling of `Documents/Suite`. */
const SLOP_DOCUMENTS_FOLDER = "Suite Slop";

/** The pre-release folder for this app, given the person's documents root. */
export function slopBudgetsFolder(documentsRoot: string, app = "Budget"): string {
  return join(documentsRoot, SLOP_DOCUMENTS_FOLDER, app);
}

/**
 * The shape of an id that may become one path component.
 *
 * A budget id is also a filename: `<id>.budget` under the budgets folder and a folder of its own
 * under `.backups`. Lower-case letters, digits, `-` and the `_` the id helper uses keep it to one
 * component, with no separators, no leading dot and no empty name. The bound keeps a document from
 * supplying a name no filesystem will accept.
 */
const SAFE_BUDGET_ID = /^[a-z0-9][a-z0-9_-]{0,127}$/u;

/** Whether an id can be used as one path component without escaping its parent. */
export function isSafeBudgetId(id: string): boolean {
  return SAFE_BUDGET_ID.test(id);
}

/** The same rule, for a caller that is about to build a path. */
export function assertSafeBudgetId(id: string): string {
  if (!isSafeBudgetId(id)) {
    throw new Error(`Refusing an unsafe budget id: ${JSON.stringify(id)}`);
  }
  return id;
}

export function budgetPath(paths: Pick<AppPaths, "budgetsDir">, id: string): string {
  return join(paths.budgetsDir, `${assertSafeBudgetId(id)}.budget`);
}

export function backupDir(paths: AppPaths, id: string): string {
  return join(paths.backupsDir, assertSafeBudgetId(id));
}

/** Where budgets lived before they followed the convention, for the one-time move. */
export function legacyBudgetsDir(paths: Pick<AppPaths, "root">): string {
  return join(paths.root, "budgets");
}

/** The part of `path` below `directory`, or null when it is not inside it. */
export function relativeTo(path: string, directory: string): string | null {
  const prefix = directory.endsWith(sep) ? directory : `${directory}${sep}`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

/**
 * The budget a `suite://budget/workspace/<name>` link names, when this machine has it.
 *
 * The hub opens a document by launching this app with a link, so the rule is worth a test: the name
 * must be a `.budget` file, and it must be in the library. Anything else returns null, and the caller
 * opens the library list instead of failing a link the person did not type.
 *
 * `exists` is a parameter for the same reason the rest of this module takes its paths: so the rule is
 * a test, not something only a running window demonstrates.
 */
export function budgetFromLink(
  link: string,
  folder: string,
  exists: (path: string) => boolean,
): string | null {
  const name = workspaceTarget(link, "budget");
  if (name === null || !/\.budget$/iu.test(name)) return null;
  const candidate = join(folder, name);
  return exists(candidate) ? candidate : null;
}

/**
 * The budget a command line names: a path from the desktop, or a link the hub routed here.
 *
 * The link is read first and never falls through to the path test. A link ends in `.budget` too, and
 * treating one as a path is how the app tries to open a file called `suite:` — which is exactly the bug
 * this ordering exists to prevent.
 */
export function budgetFromArgv(
  argv: readonly string[],
  folder: string,
  exists: (path: string) => boolean,
): string | null {
  for (const argument of argv.slice(1)) {
    if (argument.startsWith("-")) continue;
    if (argument.startsWith(SUITE_PROTOCOL)) {
      const named = budgetFromLink(argument, folder, exists);
      if (named !== null) return named;
      continue;
    }
    if (/\.(budget|json)$/iu.test(argument)) return argument;
  }
  return null;
}
