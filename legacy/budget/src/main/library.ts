import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  BudgetDocument,
  type BudgetSnapshot,
  type CreateBudgetInput,
  createId,
  decodeBudgetFile,
  decodeRecords,
  type ExportFormat,
  encodeBudgetFile,
  encodeRecords,
  type LibraryEntry,
  type OpenBudgetInfo,
  transactionsToCsv,
  transactionsToQif,
} from "@suite/budget-core";
import { z } from "zod";

import {
  type AppPaths,
  assertSafeBudgetId,
  backupDir,
  budgetPath,
  isSafeBudgetId,
  legacyBudgetsDir,
  relativeTo,
} from "./budgetLocation";
import { recoverFile } from "./recovery";

const entrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  currency: z.string().min(1),
  createdAt: z.string().min(1),
  lastOpenedAt: z.string().min(1),
});

const libraryFileSchema = z.object({
  version: z.literal(1),
  entries: z.array(entrySchema),
});

type LibraryFile = z.infer<typeof libraryFileSchema>;

class LibraryError extends Error {
  constructor(
    readonly code: "corrupt-library" | "missing" | "unreadable" | "in-use",
    message: string,
    readonly recoveredPath?: string,
  ) {
    super(message);
    this.name = "LibraryError";
  }
}

export async function ensureDirs(paths: AppPaths): Promise<void> {
  await mkdir(paths.root, { recursive: true });
  await mkdir(paths.budgetsDir, { recursive: true });
  await mkdir(paths.backupsDir, { recursive: true });
  await mkdir(paths.recoveredDir, { recursive: true });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function insideBudgets(paths: AppPaths, path: string): boolean {
  return relativeTo(path, paths.budgetsDir) !== null;
}

/**
 * A pre-release entry always points inside its own folder.
 *
 * The library is machine state, but an older or copied index can still name a stable file. Copying
 * it here keeps the write path inside the channel; the stable file, its backups and its temporary
 * file stay untouched.
 */
async function adoptEntry(paths: AppPaths, entry: LibraryEntry): Promise<LibraryEntry> {
  if (paths.channel === "stable" || insideBudgets(paths, entry.path)) return entry;

  const target = budgetPath(paths, entry.id);
  await mkdir(paths.budgetsDir, { recursive: true });
  if (!(await fileExists(target))) await copyFile(entry.path, target);
  return { ...entry, path: target };
}

/** The document id a handed-over file names, or null when this build cannot read it yet. */
async function sourceDocumentId(sourcePath: string): Promise<string | null> {
  try {
    const decoded = decodeBudgetFile(await readFile(sourcePath, "utf8"));
    return decoded.isOk() ? BudgetDocument.fromSnapshot(decoded.value).getMeta().budgetId : null;
  } catch {
    return null;
  }
}

/**
 * Copy budgets written before the documents convention into its folder.
 *
 * Runs once: a budget already there is left alone, and an entry whose stored path pointed into the old
 * directory is rewritten to the new one. The old directory stays where it is, because a migration that
 * deletes the only copy on a hunch is how a person loses a year of records.
 */
export async function adoptLegacyBudgets(paths: AppPaths): Promise<number> {
  const legacy = legacyBudgetsDir(paths);
  if (legacy === paths.budgetsDir) return 0;

  const names = await readdir(legacy).catch((): string[] => []);
  let copied = 0;
  for (const name of names) {
    if (!name.endsWith(".budget")) continue;
    const target = join(paths.budgetsDir, name);
    if (await fileExists(target)) continue;
    await mkdir(paths.budgetsDir, { recursive: true });
    await copyFile(join(legacy, name), target);
    copied += 1;
  }

  const library = await readLibrary(paths);
  let changed = false;
  const entries = library.entries.map((entry) => {
    const below = relativeTo(entry.path, legacy);
    if (below === null) return entry;
    changed = true;
    return { ...entry, path: join(paths.budgetsDir, below) };
  });
  if (changed) await writeLibrary(paths, { ...library, entries });
  return copied;
}

async function readLibrary(paths: AppPaths): Promise<LibraryFile> {
  try {
    const raw = await readFile(paths.libraryFile, "utf8");
    const parsed = libraryFileSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new LibraryError(
        "corrupt-library",
        `The budget library index is not readable. It has not been overwritten: ${paths.libraryFile}`,
      );
    }
    return parsed.data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, entries: [] };
    }
    if (error instanceof LibraryError) throw error;
    throw new LibraryError(
      "corrupt-library",
      `The budget library index is not readable. It has not been overwritten: ${paths.libraryFile}`,
    );
  }
}

async function writeLibrary(paths: AppPaths, file: LibraryFile): Promise<void> {
  await ensureDirs(paths);
  const temp = `${paths.libraryFile}.tmp`;
  await writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  await rename(temp, paths.libraryFile);
}

export async function listEntries(paths: AppPaths): Promise<LibraryEntry[]> {
  const file = await readLibrary(paths);
  return [...file.entries].sort((left, right) =>
    right.lastOpenedAt.localeCompare(left.lastOpenedAt),
  );
}

async function putEntry(paths: AppPaths, entry: LibraryEntry): Promise<LibraryEntry> {
  const file = await readLibrary(paths);
  const entries = file.entries.filter((candidate) => candidate.id !== entry.id);
  entries.push(entry);
  await writeLibrary(paths, { version: 1, entries });
  return entry;
}

export async function createBudget(
  paths: AppPaths,
  input: CreateBudgetInput,
  now: Date = new Date(),
): Promise<{ entry: LibraryEntry; doc: BudgetDocument }> {
  await ensureDirs(paths);
  const doc = BudgetDocument.create({
    name: input.name,
    currency: input.currency,
    currencyScale: input.currencyScale,
    firstDayOfWeek: input.firstDayOfWeek,
    now,
  });
  doc.applyStarterTemplate(input.template, now);
  if (input.startingAccount) {
    doc.createAccount(
      {
        name: input.startingAccount.name,
        type: input.startingAccount.type,
        onBudget: input.startingAccount.onBudget,
        startingBalanceMinor: input.startingAccount.startingBalanceMinor,
        startingDate: now.toISOString().slice(0, 10),
      },
      now,
    );
  }

  const id = doc.getMeta().budgetId;
  const path = budgetPath(paths, id);
  await writeBudgetDocument(path, doc);

  const entry = entryFor(id, path, doc, now);
  await putEntry(paths, entry);
  return { entry, doc };
}

export async function openBudget(
  paths: AppPaths,
  id: string,
  now: Date = new Date(),
): Promise<{ entry: LibraryEntry; doc: BudgetDocument; usedBackup?: string }> {
  const file = await readLibrary(paths);
  const found = file.entries.find((candidate) => candidate.id === id);
  if (!found) throw new LibraryError("missing", "That budget is no longer in the library");

  // The index is machine state and can be older or copied. An id that is not one path component
  // stays refused rather than being rewritten into a move nobody asked for.
  assertSafeBudgetId(found.id);
  const entry = await adoptEntry(paths, found);
  const loaded = await loadWithFallback(paths, entry);
  const next = { ...entry, lastOpenedAt: now.toISOString() };
  await putEntry(paths, next);
  return loaded.usedBackup
    ? { entry: next, doc: loaded.doc, usedBackup: loaded.usedBackup }
    : { entry: next, doc: loaded.doc };
}

export async function importFromPath(
  paths: AppPaths,
  sourcePath: string,
  now: Date = new Date(),
): Promise<{ entry: LibraryEntry; doc: BudgetDocument }> {
  await ensureDirs(paths);
  const raw = await readFile(sourcePath, "utf8");

  let doc: BudgetDocument;
  let sourceText = raw;
  const budgetFile = decodeBudgetFile(raw);
  if (budgetFile.isOk()) {
    const restored = BudgetDocument.fromSnapshot(budgetFile.value);
    const validation = restored.validate();
    if (validation.isErr()) {
      throw new LibraryError("unreadable", "That budget file failed validation");
    }
    doc = restored;
  } else if (
    budgetFile.error.code === "unsupported-version" ||
    budgetFile.error.code === "unsupported-schema"
  ) {
    // A newer file is not a records file and not a damaged one. Say which version is needed
    // instead of trying the other shape, which would report "not a Suite Budget file".
    throw new LibraryError("unreadable", budgetFile.error.message);
  } else {
    const records = decodeRecords(raw);
    if (records.isErr()) {
      throw new LibraryError(
        "unreadable",
        `That file is not a Suite Budget file (${budgetFile.error.code}; ${records.error.code})`,
      );
    }
    const restored = BudgetDocument.fromRecords(records.value);
    const validation = restored.validate();
    if (validation.isErr()) {
      throw new LibraryError("unreadable", "That records file failed validation");
    }
    doc = restored;
    sourceText = encodeBudgetFile(doc, now);
  }

  const library = await readLibrary(paths);
  const metaId = doc.getMeta().budgetId;
  // A document supplies its own id, and that id becomes a filename. An unsafe one gets a fresh
  // id; so does one this library already holds, which keeps the import from replacing a budget.
  const id =
    isSafeBudgetId(metaId) && !library.entries.some((entry) => entry.id === metaId)
      ? metaId
      : createId("budget");
  const path = budgetPath(paths, id);
  await mkdir(paths.budgetsDir, { recursive: true });
  await writeTextAtomic(path, sourceText);

  const entry = entryFor(id, path, doc, now);
  await putEntry(paths, entry);
  return { entry, doc };
}

export async function renameBudget(
  paths: AppPaths,
  id: string,
  name: string,
): Promise<LibraryEntry> {
  const file = await readLibrary(paths);
  const entry = file.entries.find((candidate) => candidate.id === id);
  if (!entry) throw new LibraryError("missing", "That budget is no longer in the library");
  const opened = await openBudget(paths, id);
  opened.doc.rename(name.trim());
  await writeBudgetDocument(opened.entry.path, opened.doc);
  const next = { ...opened.entry, name: name.trim() };
  await putEntry(paths, next);
  return next;
}

export async function removeBudget(paths: AppPaths, id: string): Promise<void> {
  const file = await readLibrary(paths);
  const entries = file.entries.filter((entry) => entry.id !== id);
  if (entries.length === file.entries.length) {
    throw new LibraryError("missing", "That budget is no longer in the library");
  }
  await writeLibrary(paths, { version: 1, entries });
}

/**
 * Open a file a person or the hub handed over.
 *
 * A budget that is already in the folder is opened where it is; anything else is imported, which copies
 * it in. Without the first branch, opening the same file twice would leave two budgets with one name.
 */
export async function openFromPath(
  paths: AppPaths,
  sourcePath: string,
  now: Date = new Date(),
): Promise<{ entry: LibraryEntry; doc: BudgetDocument; usedBackup?: string }> {
  const library = await readLibrary(paths);
  const existing = library.entries.find((entry) => entry.path === sourcePath);
  if (existing && (paths.channel === "stable" || insideBudgets(paths, sourcePath))) {
    return openBudget(paths, existing.id, now);
  }

  if (paths.channel === "slop") {
    // Opening the same stable file twice must land on the copy made the first time, not leave two
    // budgets with one name. The document id survives the copy, so it is the identity to match.
    const id = await sourceDocumentId(sourcePath);
    const copy = library.entries.find(
      (entry) => entry.id === id && insideBudgets(paths, entry.path),
    );
    if (copy) return openBudget(paths, copy.id, now);
  }
  return importFromPath(paths, sourcePath, now);
}

export function toOpenInfo(entry: LibraryEntry, doc: BudgetDocument): OpenBudgetInfo {
  return { entry, snapshot: doc.snapshot() };
}

async function writeBudgetDocument(
  path: string,
  doc: BudgetDocument,
  now: Date = new Date(),
): Promise<void> {
  await writeTextAtomic(path, encodeBudgetFile(doc, now));
}

export async function backupCurrent(paths: AppPaths, id: string, path: string): Promise<void> {
  const directory = backupDir(paths, id);
  await mkdir(directory, { recursive: true });
  const daily = join(directory, `${new Date().toISOString().slice(0, 10)}.budget`);
  const previous = join(directory, "previous.budget");
  try {
    await stat(path);
  } catch {
    return;
  }
  await copyFile(path, previous);
  try {
    await stat(daily);
  } catch {
    await copyFile(path, daily);
  }
  const files = await readdir(directory).catch(() => []);
  const dailies = files
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.budget$/.test(name))
    .sort()
    .reverse();
  for (const name of dailies.slice(7)) {
    await unlink(join(directory, name)).catch(() => undefined);
  }
}

export async function exportRecordsText(
  snapshot: BudgetSnapshot,
  format: ExportFormat,
): Promise<string> {
  if (format === "json") return encodeRecords(snapshot);
  if (format === "csv") return transactionsToCsv(snapshot);
  return transactionsToQif(snapshot);
}

function entryFor(id: string, path: string, doc: BudgetDocument, now: Date): LibraryEntry {
  const meta = doc.getMeta();
  return {
    id,
    name: meta.name,
    path,
    currency: doc.getSettings().currency,
    createdAt: meta.createdAt,
    lastOpenedAt: now.toISOString(),
  };
}

async function loadWithFallback(
  paths: AppPaths,
  entry: LibraryEntry,
): Promise<{ doc: BudgetDocument; usedBackup?: string }> {
  const main = await tryLoad(entry.path);
  if (main) return { doc: main };

  const backups = await backupsFor(paths, entry.id);
  for (const candidate of backups) {
    const doc = await tryLoad(candidate);
    if (doc) return { doc, usedBackup: candidate };
  }

  try {
    await stat(entry.path);
  } catch {
    throw new LibraryError(
      "missing",
      `The budget file is missing and no backup could be read: ${entry.path}`,
    );
  }
  const recovered = await recoverFile(paths, entry.id, entry.path);
  throw new LibraryError(
    "unreadable",
    `The budget file could not be read. A copy was kept at ${recovered}`,
    recovered,
  );
}

async function backupsFor(paths: AppPaths, id: string): Promise<string[]> {
  const directory = backupDir(paths, id);
  const names = await readdir(directory).catch(() => []);
  const candidates = await Promise.all(
    names
      .filter((name) => name.endsWith(".budget"))
      .map(async (name) => {
        const path = join(directory, name);
        const info = await stat(path).catch(() => null);
        return { path, modified: info?.mtimeMs ?? 0 };
      }),
  );
  return candidates.sort((left, right) => right.modified - left.modified).map((item) => item.path);
}

async function tryLoad(path: string): Promise<BudgetDocument | null> {
  try {
    const raw = await readFile(path, "utf8");
    const decoded = decodeBudgetFile(raw);
    if (decoded.isErr()) {
      // A newer file must not become a recovery copy: the copy would be this build's older
      // schema, and the person would be told their file was unreadable rather than too new.
      if (
        decoded.error.code === "unsupported-version" ||
        decoded.error.code === "unsupported-schema"
      ) {
        throw new LibraryError("unreadable", decoded.error.message);
      }
      return null;
    }
    const doc = BudgetDocument.fromSnapshot(decoded.value);
    return doc.validate().isOk() ? doc : null;
  } catch (error) {
    if (error instanceof LibraryError) throw error;
    return null;
  }
}

async function writeTextAtomic(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, contents, "utf8");
  await rename(temp, path);
}
