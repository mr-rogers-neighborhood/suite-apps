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
 * A pack reads the list only after the `recents` capability's first-use consent
 * (S4.2, S4.6). This store keeps that answer with the rows, the same shape the
 * reminder queue uses, because the host has no general consent record yet
 * (S4.3).
 */
export type RecentsPermission = "prompt" | "granted" | "denied";

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

interface PermissionRecord {
  readonly state: Exclude<RecentsPermission, "prompt">;
  readonly askedAt: number;
}

export interface RecentsData {
  readonly version: 1;
  readonly permissions: Readonly<Record<string, PermissionRecord>>;
  readonly rows: readonly RecentRow[];
}

export const RECENTS_VERSION = 1;
/** The host keeps a bounded list; the oldest row falls off first. */
export const MAX_RECENTS = 200;

const MAX_INSTANT = 8_640_000_000_000_000;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this rejects.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

/** The pack asked for the list and the person said no. The sentence is for the person. */
export class RecentsDeniedError extends Error {
  constructor() {
    super("Recent documents are off; this app may not read the host's recent list.");
    this.name = "RecentsDeniedError";
  }
}

function scopeKey(scope: RecentsScope): string {
  return `${scope.containerId}:${scope.publisherId}:${scope.packId}`;
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

function emptyData(): RecentsData {
  return { version: RECENTS_VERSION, permissions: {}, rows: [] };
}

function parseData(value: unknown): RecentsData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("the recent list is not an object");
  }
  const record = value as Record<string, unknown>;
  if (record.version !== RECENTS_VERSION) {
    throw new Error(`the recent list is at version ${String(record.version)}`);
  }

  const permissions: Record<string, PermissionRecord> = {};
  if (typeof record.permissions === "object" && record.permissions !== null) {
    for (const [key, raw] of Object.entries(record.permissions)) {
      if (typeof raw !== "object" || raw === null) continue;
      const entry = raw as Record<string, unknown>;
      if (entry.state !== "granted" && entry.state !== "denied") continue;
      if (
        typeof entry.askedAt !== "number" ||
        !Number.isInteger(entry.askedAt) ||
        entry.askedAt <= 0
      ) {
        continue;
      }
      permissions[key] = { state: entry.state, askedAt: entry.askedAt };
    }
  }

  if (!Array.isArray(record.rows)) throw new Error("the recent list has no rows");
  return {
    version: RECENTS_VERSION,
    permissions,
    rows: record.rows.filter(isRow).slice(0, MAX_RECENTS),
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
  #writing: Promise<void> = Promise.resolve();

  private constructor(file: string, data: RecentsData, now: () => number) {
    this.#file = file;
    this.#data = data;
    this.#now = now;
  }

  static async open(
    file: string,
    options: { readonly now?: () => number } = {},
  ): Promise<RecentsStore> {
    let parsed: RecentsData | null = null;
    try {
      parsed = parseData(JSON.parse(await readFile(file, "utf8")));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        await rename(file, `${file}.corrupt-${Date.now()}`).catch(() => undefined);
        console.warn("[shell] the recent list could not be read; starting empty", error);
      }
    }
    return new RecentsStore(file, parsed ?? emptyData(), options.now ?? Date.now);
  }

  rows(): readonly RecentRow[] {
    return this.#data.rows;
  }

  permissionFor(scope: RecentsScope): RecentsPermission {
    return this.#data.permissions[scopeKey(scope)]?.state ?? "prompt";
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
   * `ask` is the host's one-time question; it is only called while the answer is
   * `prompt`. A denial is recorded and stays denied. The caller's own rows carry
   * a document id; another pack's row carries its pack id and time only, because
   * a pack may not enumerate another pack's documents (S11.1).
   */
  async list(scope: RecentsScope, ask: () => Promise<boolean>): Promise<readonly RecentDocument[]> {
    const key = scopeKey(scope);
    let permission = this.#data.permissions[key];
    if (permission === undefined) {
      const granted = await ask();
      permission = { state: granted ? "granted" : "denied", askedAt: this.#now() };
      this.#data = {
        ...this.#data,
        permissions: { ...this.#data.permissions, [key]: permission },
      };
      await this.#persist();
    }
    if (permission.state === "denied") throw new RecentsDeniedError();

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
