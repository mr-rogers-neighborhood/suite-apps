import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RecentDocument } from "@suite/pack-runtime";
import { isSafeDocumentId } from "./documents.js";
import { isSafePackId } from "./packs.js";

/**
 * The host's recent documents.
 *
 * The host is the only party that knows a document was opened, so it keeps the
 * record: one list spanning every pack, written under the profile as host state.
 * A pack reads metadata only — never content, never a path — and its own rows
 * are the only ones it may resolve. "Forget" removes a row and means it; it does
 * not delete the document.
 *
 * The record deliberately outlives a pack removal. It is the person's history,
 * not the pack's data, so uninstalling an app does not erase where they have
 * been; the row keeps the publisher id so a later install by another publisher
 * under the same id is a different app. The person removes a row with forget.
 *
 * The `recents` consent answer is *not* here. Version 2 keeps rows only; the
 * answer moved to `consent.ts` (S4.2, S4.3). Version 1 files are read once so
 * `ConsentRecord.migrateLegacy` can move a grant or a denial, then rewritten
 * without the old `permissions` map.
 */

export const RECENTS_VERSION = 2;
/** The host keeps a bounded list; the oldest row falls off first. */
export const MAX_RECENTS = 200;

const MAX_INSTANT = 8_640_000_000_000_000;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this rejects.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

/** Which pack is asking. Derived by the host from the sender, never by the pack. */
export interface RecentsScope {
  readonly containerId: string;
  readonly publisherId: string;
  readonly packId: string;
}

/** One open the host recorded. `publisherId` keeps a reused pack id separate (S2.2). */
export interface RecentRow {
  readonly containerId: string;
  readonly publisherId: string;
  readonly packId: string;
  readonly documentId: string;
  /** Epoch milliseconds when the host saw the open. */
  readonly openedAt: number;
}

/**
 * One answer from a version-1 file, before the consent record owned it. The old
 * shape had a container, publisher and pack but no version; the migration
 * attaches it to the installed version or re-asks.
 */
export interface LegacyRecentsPermission {
  readonly containerId: string;
  readonly publisherId: string;
  readonly packId: string;
  readonly state: "granted" | "denied";
  readonly askedAt: number;
}

export interface RecentsData {
  readonly version: typeof RECENTS_VERSION;
  readonly rows: readonly RecentRow[];
}

function isContainerId(value: string): boolean {
  return value.length > 0 && value.length <= 64 && !CONTROL_CHARACTER.test(value);
}

function isRow(value: unknown): value is RecentRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.containerId !== "string" || !isContainerId(row.containerId)) return false;
  if (typeof row.publisherId !== "string" || row.publisherId.length === 0) return false;
  if (typeof row.packId !== "string" || !isSafePackId(row.packId)) return false;
  if (typeof row.documentId !== "string" || !isSafeDocumentId(row.documentId)) return false;
  return (
    typeof row.openedAt === "number" &&
    Number.isInteger(row.openedAt) &&
    row.openedAt > 0 &&
    row.openedAt <= MAX_INSTANT
  );
}

function parseRows(value: unknown): readonly RecentRow[] {
  if (!Array.isArray(value)) throw new Error("the recent list has no rows");
  return value.filter(isRow).slice(0, MAX_RECENTS);
}

/** The version-1 permission map, keyed as `container:publisher:pack`. */
function parseLegacyPermissions(value: unknown): readonly LegacyRecentsPermission[] {
  if (typeof value !== "object" || value === null) return [];
  const permissions: LegacyRecentsPermission[] = [];
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    if (entry.state !== "granted" && entry.state !== "denied") continue;
    if (
      typeof entry.askedAt !== "number" ||
      !Number.isInteger(entry.askedAt) ||
      entry.askedAt <= 0 ||
      entry.askedAt > MAX_INSTANT
    ) {
      continue;
    }
    const [containerId, publisherId, packId] = key.split(":");
    if (containerId === undefined || publisherId === undefined || packId === undefined) continue;
    if (!isContainerId(containerId) || publisherId.length === 0 || !isSafePackId(packId)) continue;
    permissions.push({
      containerId,
      publisherId,
      packId,
      state: entry.state,
      askedAt: entry.askedAt,
    });
  }
  return permissions;
}

function emptyData(): RecentsData {
  return { version: RECENTS_VERSION, rows: [] };
}

interface ParsedRecents {
  readonly data: RecentsData;
  readonly legacy: readonly LegacyRecentsPermission[];
  /** True for a version-1 file, so the first open rewrites it as version 2. */
  readonly rewrite: boolean;
}

function parseData(value: unknown): ParsedRecents {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("the recent list is not an object");
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1 && record.version !== RECENTS_VERSION) {
    throw new Error(`the recent list is at version ${String(record.version)}`);
  }

  return {
    data: { version: RECENTS_VERSION, rows: parseRows(record.rows) },
    legacy: record.version === 1 ? parseLegacyPermissions(record.permissions) : [],
    rewrite: record.version === 1,
  };
}

/**
 * The recent list on disk, with a serialised writer.
 *
 * It is disposable host state: a file that does not parse is moved aside and the
 * host starts empty rather than refusing to boot. Losing it costs the person a
 * list, not a document.
 */
export class RecentsStore {
  readonly #file: string;
  readonly #now: () => number;
  #data: RecentsData;
  #legacy: readonly LegacyRecentsPermission[];
  #rewrite: boolean;
  #writing: Promise<void> = Promise.resolve();

  private constructor(
    file: string,
    data: RecentsData,
    legacy: readonly LegacyRecentsPermission[],
    rewrite: boolean,
    now: () => number,
  ) {
    this.#file = file;
    this.#data = data;
    this.#legacy = legacy;
    this.#rewrite = rewrite;
    this.#now = now;
  }

  static async open(
    file: string,
    options: { readonly now?: () => number } = {},
  ): Promise<RecentsStore> {
    let parsed: ParsedRecents | null = null;
    try {
      parsed = parseData(JSON.parse(await readFile(file, "utf8")));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        await rename(file, `${file}.corrupt-${Date.now()}`).catch(() => undefined);
        console.warn("[desk] the recent list could not be read; starting empty", error);
      }
    }
    return new RecentsStore(
      file,
      parsed?.data ?? emptyData(),
      parsed?.legacy ?? [],
      parsed?.rewrite ?? false,
      options.now ?? Date.now,
    );
  }

  /** The version-1 answers this file carried, for the one-time migration. */
  legacyPermissions(): readonly LegacyRecentsPermission[] {
    return this.#legacy;
  }

  /**
   * Write the version-2 shape and forget the old permission map.
   *
   * Called after the consent record has taken what it can map. It is a no-op on a
   * file that was already version 2.
   */
  async discardLegacyPermissions(): Promise<void> {
    if (!this.#rewrite && this.#legacy.length === 0) return;
    this.#legacy = [];
    this.#rewrite = false;
    await this.#persist();
  }

  rows(): readonly RecentRow[] {
    return this.#data.rows;
  }

  /** Record one open. The newest open of a document is the row that stays. */
  async record(scope: RecentsScope, documentId: string, at = this.#now()): Promise<void> {
    if (!isSafeDocumentId(documentId)) throw new Error("invalid document name");
    if (!Number.isInteger(at) || at <= 0 || at > MAX_INSTANT) throw new Error("invalid time");

    if (!isContainerId(scope.containerId) || !isSafePackId(scope.packId)) {
      throw new Error("invalid recent scope");
    }
    if (scope.publisherId.length === 0) throw new Error("invalid recent scope");

    const row: RecentRow = {
      containerId: scope.containerId,
      publisherId: scope.publisherId,
      packId: scope.packId,
      documentId,
      openedAt: at,
    };
    const rows = this.#data.rows.filter((entry) => !sameRow(entry, row));
    rows.push(row);
    rows.sort((left, right) => right.openedAt - left.openedAt);
    this.#data = { ...this.#data, rows: rows.slice(0, MAX_RECENTS) };
    await this.#persist();
  }

  /** Remove this pack's row. A row another pack owns is never touched. */
  async forget(scope: RecentsScope, documentId: string): Promise<void> {
    if (!isSafeDocumentId(documentId)) throw new Error("invalid document name");
    const rows = this.#data.rows.filter(
      (row) =>
        !(
          row.containerId === scope.containerId &&
          row.publisherId === scope.publisherId &&
          row.packId === scope.packId &&
          row.documentId === documentId
        ),
    );
    if (rows.length === this.#data.rows.length) return;
    this.#data = { ...this.#data, rows };
    await this.#persist();
  }

  /**
   * The list a pack may read.
   *
   * The caller has already checked the `recents` consent through the host's one
   * consent surface. A denial is answered with a sentence there, not an empty
   * list here. The caller's own rows carry a document id; another pack's row
   * carries its pack id and time only, because a pack may not enumerate another
   * pack's documents (S11.1).
   */
  list(scope: RecentsScope): readonly RecentDocument[] {
    return this.#data.rows
      .filter((row) => row.containerId === scope.containerId)
      .map((row): RecentDocument => {
        const owned = row.publisherId === scope.publisherId && row.packId === scope.packId;
        return {
          packId: row.packId,
          documentId: owned ? row.documentId : null,
          name: owned ? row.documentId : null,
          openedAt: row.openedAt,
        };
      });
  }

  #persist(): Promise<void> {
    const contents = `${JSON.stringify(this.#data, null, 2)}\n`;
    const write = this.#writing
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(this.#file), { recursive: true });
        const temporary = `${this.#file}.tmp-${process.pid}`;
        await writeFile(temporary, contents, "utf8");
        await rename(temporary, this.#file);
      });
    this.#writing = write.catch(() => undefined);
    return write;
  }
}

function sameRow(left: RecentRow, right: RecentRow): boolean {
  return (
    left.containerId === right.containerId &&
    left.publisherId === right.publisherId &&
    left.packId === right.packId &&
    left.documentId === right.documentId
  );
}
