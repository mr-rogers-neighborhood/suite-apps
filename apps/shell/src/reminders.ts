import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * The host's reminder queue.
 *
 * A pack does not run at 09:00, so it cannot format or deliver a reminder then.
 * It projects display rows while it is open; this module keeps those rows as
 * host data, scoped to the pack that produced them. The scheduler below reads
 * only these rows, so a reminder still arrives with the pack closed.
 *
 * Nothing here imports Electron: the queue, the projection parser and the
 * scheduler are driven by a fake clock and a fake delivery in tests. The OS
 * binding lives in `reminderDelivery.ts` and `main.ts`.
 */

/**
 * What the consent record says about the notification token, in the scheduler's
 * vocabulary. `prompt` means unanswered or expired, so the host may ask; a
 * remembered `denied` is never asked again until the person clears it.
 */
export type ReminderPermission = "prompt" | "granted" | "denied" | "unsupported";

/** A display row a pack projects. The host adds the pack id and capture time. */
export interface ProjectedReminder {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  /** Epoch milliseconds, not a wall-clock string. */
  readonly at: number;
  /** A `suite://<pack-id>/...` link the host routes on click. */
  readonly deepLink: string;
}

/** One row as the host stores it. */
export interface ReminderRow extends ProjectedReminder {
  readonly packId: string;
  /** Epoch milliseconds when the host replaced the pack's rows. */
  readonly capturedAt: number;
}

export interface ReminderQueueData {
  readonly version: typeof REMINDER_QUEUE_VERSION;
  readonly rows: readonly ReminderRow[];
}

/**
 * The one host-wide answer a version-1 file carried. It had no pack, publisher
 * or version, so it cannot become a per-pack grant; `consent.ts` records that
 * fact and the notification capability is asked again at a pack's next use.
 */
export interface LegacyNotificationPermission {
  readonly state: "granted" | "denied";
  readonly askedAt: number;
}

export const REMINDER_QUEUE_VERSION = 2;
export const MAX_REMINDERS_PER_PACK = 200;
const MAX_ID_LENGTH = 128;
const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 500;
const MAX_LINK_LENGTH = 2048;
const MAX_INSTANT = 8_640_000_000_000_000;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this rejects.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

export class ReminderProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReminderProjectionError";
  }
}

function text(value: unknown, name: string, max: number, allowEmpty: boolean): string {
  if (typeof value !== "string") {
    throw new ReminderProjectionError(`a reminder ${name} is text`);
  }
  if (value.length > max) {
    throw new ReminderProjectionError(`a reminder ${name} is longer than ${max} characters`);
  }
  if (CONTROL_CHARACTER.test(value)) {
    throw new ReminderProjectionError(`a reminder ${name} contains a control character`);
  }
  if (!allowEmpty && value.trim().length === 0) {
    throw new ReminderProjectionError(`a reminder ${name} is empty`);
  }
  return value;
}

/** Validate the rows a pack projected. A malformed row refuses the whole refresh. */
export function parseProjectedReminders(value: unknown, packId: string): ProjectedReminder[] {
  if (!Array.isArray(value)) {
    throw new ReminderProjectionError("a reminder projection returns a list of rows");
  }

  const rows: ProjectedReminder[] = [];
  const ids = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new ReminderProjectionError(`reminder ${index} is not an object`);
    }
    const record = item as Record<string, unknown>;

    const id = text(record.id, "id", MAX_ID_LENGTH, false);
    if (ids.has(id)) {
      throw new ReminderProjectionError(`two reminders share the id ${id}`);
    }
    ids.add(id);

    const title = text(record.title, "title", MAX_TITLE_LENGTH, false);
    const body = text(record.body, "body", MAX_BODY_LENGTH, true);

    const at = record.at;
    if (typeof at !== "number" || !Number.isInteger(at) || at <= 0 || at > MAX_INSTANT) {
      throw new ReminderProjectionError(`reminder ${id} has no valid instant`);
    }

    const link = text(record.deepLink, "link", MAX_LINK_LENGTH, false);
    let parsed: URL;
    try {
      parsed = new URL(link);
    } catch {
      throw new ReminderProjectionError(`reminder ${id} has a malformed link`);
    }
    if (
      parsed.protocol !== "suite:" ||
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      parsed.port.length > 0 ||
      parsed.hostname.toLowerCase() !== packId.toLowerCase()
    ) {
      throw new ReminderProjectionError(`reminder ${id} does not link to ${packId}`);
    }

    rows.push({ id, title, body, at, deepLink: parsed.toString() });
  }

  return rows;
}

/** True when the row belongs to an installed pack that still declares notifications. */
export function isReminderRow(value: unknown): value is ReminderRow {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.packId !== "string" || record.packId.length === 0) return false;
  if (
    typeof record.capturedAt !== "number" ||
    !Number.isInteger(record.capturedAt) ||
    record.capturedAt <= 0
  ) {
    return false;
  }
  try {
    parseProjectedReminders([record], record.packId);
  } catch {
    return false;
  }
  return true;
}

/**
 * The queue file, with a serialised writer.
 *
 * A reminder queue is disposable host state: if the file cannot be read it is
 * moved aside and the host starts empty rather than refusing to boot. The rows
 * are refreshed on the next save or open.
 */
export class ReminderQueue {
  readonly #file: string;
  #data: ReminderQueueData;
  #legacy: LegacyNotificationPermission | null;
  #rewrite: boolean;
  #writing: Promise<void> = Promise.resolve();

  private constructor(
    file: string,
    data: ReminderQueueData,
    legacy: LegacyNotificationPermission | null,
    rewrite: boolean,
  ) {
    this.#file = file;
    this.#data = data;
    this.#legacy = legacy;
    this.#rewrite = rewrite;
  }

  static async open(file: string): Promise<ReminderQueue> {
    let parsed: ParsedQueue | null = null;
    try {
      parsed = parseQueueData(JSON.parse(await readFile(file, "utf8")));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        await quarantine(file).catch(() => undefined);
        console.warn("[shell] the reminder queue could not be read; starting empty", error);
      }
    }
    return new ReminderQueue(
      file,
      parsed?.data ?? emptyQueue(),
      parsed?.legacy ?? null,
      parsed?.rewrite ?? false,
    );
  }

  /** The version-1 answer this file carried, for the one-time migration. */
  legacyPermission(): LegacyNotificationPermission | null {
    return this.#legacy;
  }

  /** Write the version-2 shape after the consent record has seen the old answer. */
  async discardLegacyPermission(): Promise<void> {
    if (!this.#rewrite && this.#legacy === null) return;
    this.#legacy = null;
    this.#rewrite = false;
    await this.#persist();
  }

  rows(): readonly ReminderRow[] {
    return this.#data.rows;
  }

  rowsFor(packId: string): readonly ReminderRow[] {
    return this.#data.rows.filter((row) => row.packId === packId);
  }

  /** Replace one pack's rows. The same projection twice leaves the queue unchanged. */
  async replacePack(
    packId: string,
    rows: readonly ProjectedReminder[],
    capturedAt: number,
  ): Promise<void> {
    const kept = this.#data.rows.filter((row) => row.packId !== packId);
    const next = rows
      .map((row) => ({ ...row, packId, capturedAt }))
      .sort((left, right) => left.at - right.at)
      .slice(0, MAX_REMINDERS_PER_PACK);
    this.#data = { ...this.#data, rows: [...kept, ...next] };
    await this.#persist();
  }

  async remove(packId: string, id: string): Promise<void> {
    const rows = this.#data.rows.filter((row) => !(row.packId === packId && row.id === id));
    if (rows.length === this.#data.rows.length) return;
    this.#data = { ...this.#data, rows };
    await this.#persist();
  }

  /** Remove every row a pack owns. A removed pack leaves no reminder behind. */
  async removePack(packId: string): Promise<void> {
    const rows = this.#data.rows.filter((row) => row.packId !== packId);
    if (rows.length === this.#data.rows.length) return;
    this.#data = { ...this.#data, rows };
    await this.#persist();
  }

  /** Drop rows for packs that are no longer installed, or no longer hold the capability. */
  async prune(allowedPackIds: ReadonlySet<string>): Promise<void> {
    const rows = this.#data.rows.filter((row) => allowedPackIds.has(row.packId));
    if (rows.length === this.#data.rows.length) return;
    this.#data = { ...this.#data, rows };
    await this.#persist();
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

function emptyQueue(): ReminderQueueData {
  return { version: REMINDER_QUEUE_VERSION, rows: [] };
}

interface ParsedQueue {
  readonly data: ReminderQueueData;
  readonly legacy: LegacyNotificationPermission | null;
  /** True for a version-1 file, so the first open rewrites it as version 2. */
  readonly rewrite: boolean;
}

function parseQueueData(value: unknown): ParsedQueue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("the reminder queue is not an object");
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1 && record.version !== REMINDER_QUEUE_VERSION) {
    throw new Error(`the reminder queue is at version ${String(record.version)}`);
  }
  if (!Array.isArray(record.rows)) throw new Error("the reminder queue has no row list");

  const rows = record.rows.filter(isReminderRow);
  const data: ReminderQueueData = { version: REMINDER_QUEUE_VERSION, rows };

  if (record.version !== 1) return { data, legacy: null, rewrite: false };

  const askedAt =
    typeof record.askedAt === "number" && Number.isInteger(record.askedAt) && record.askedAt > 0
      ? record.askedAt
      : null;
  const state = record.permission;
  const legacy: LegacyNotificationPermission | null =
    askedAt !== null && (state === "granted" || state === "denied") ? { state, askedAt } : null;
  return { data, legacy, rewrite: true };
}

async function quarantine(file: string): Promise<void> {
  await rename(file, `${file}.corrupt-${Date.now()}`);
}

/** A timer the scheduler can cancel. Absolute instants, so a sleep is not a drift. */
export interface ReminderTimer {
  cancel(): void;
}

export interface ReminderClock {
  now(): number;
  /** Run `fire` at `at`, never before. A fake clock advances and fires in a test. */
  setTimer(at: number, fire: () => void): ReminderTimer;
}

export type ReminderShowResult = "shown" | "denied" | "unsupported" | "failed";

export interface ReminderDelivery {
  show(row: ReminderRow): Promise<ReminderShowResult> | ReminderShowResult;
}

/**
 * The host's consent surface, seen from the scheduler.
 *
 * `state` never opens a dialog; `ensure` asks at the token tier only when the
 * record says unanswered or expired. A remembered denial is returned by both and
 * is never asked again.
 */
export interface ReminderConsent {
  state(packId: string): ReminderPermission;
  ensure(packId: string): Promise<ReminderPermission>;
}

export interface ReminderSchedulerOptions {
  readonly queue: ReminderQueue;
  readonly clock: ReminderClock;
  readonly delivery: ReminderDelivery;
  readonly consent: ReminderConsent;
  /** Called when the permission state changes; `granted` clears a visible denial. */
  readonly onPermission?: (permission: ReminderPermission) => void;
  readonly onDelivered?: (row: ReminderRow) => void;
  readonly onFailed?: (row: ReminderRow, error: unknown) => void;
}

/**
 * The host scheduler.
 *
 * It never asks a pack anything: it reads the queue and arms one timer for the
 * earliest row. A row is removed only after the OS accepted it, so a failed
 * delivery is retried on the next refresh rather than lost.
 */
export class ReminderScheduler {
  readonly #queue: ReminderQueue;
  readonly #clock: ReminderClock;
  readonly #delivery: ReminderDelivery;
  readonly #consent: ReminderConsent;
  readonly #onPermission: ((permission: ReminderPermission) => void) | undefined;
  readonly #onDelivered: ((row: ReminderRow) => void) | undefined;
  readonly #onFailed: ((row: ReminderRow, error: unknown) => void) | undefined;
  #timer: ReminderTimer | null = null;
  #running = false;
  #lastPermission: ReminderPermission | null = null;
  #working: Promise<void> = Promise.resolve();
  /** One permission ask at a time; a second save must not open a second prompt. */
  #ensuring: Promise<void> | null = null;
  /** The packs whose token is granted in this run. A denied pack is never retried by a timer. */
  #granted = new Set<string>();

  constructor(options: ReminderSchedulerOptions) {
    this.#queue = options.queue;
    this.#clock = options.clock;
    this.#delivery = options.delivery;
    this.#consent = options.consent;
    this.#onPermission = options.onPermission;
    this.#onDelivered = options.onDelivered;
    this.#onFailed = options.onFailed;
  }

  async start(): Promise<void> {
    this.#running = true;
    await this.#ensure();
  }

  stop(): void {
    this.#running = false;
    this.#cancel();
  }

  /** Re-read the queue after a save, open, removal or a deliberate re-ask. Never a background poll. */
  async refresh(): Promise<void> {
    if (!this.#running) return;
    await this.#ensure();
  }

  /** Wait for a delivery the clock started. Tests use this instead of a real timer. */
  async settle(): Promise<void> {
    await this.#working;
  }

  async #ensure(): Promise<void> {
    if (this.#ensuring !== null) return this.#ensuring;
    const running = this.#runEnsure();
    this.#ensuring = running;
    try {
      await running;
    } finally {
      if (this.#ensuring === running) this.#ensuring = null;
    }
  }

  async #runEnsure(): Promise<void> {
    this.#cancel();
    this.#granted.clear();
    if (!this.#running) return;

    const rows = this.#queue.rows();
    if (rows.length === 0) return;

    // One ask per refresh at most, for the pack with the earliest row that has
    // no answer yet. A remembered answer costs nothing; a denial stops here,
    // and its rows stay queued for the person's deliberate re-ask.
    let askedOne = false;
    for (const packId of packOrder(rows)) {
      let state = this.#consent.state(packId);
      if (state === "prompt" && !askedOne) {
        state = await this.#consent.ensure(packId);
        askedOne = true;
      }
      if (state === "granted") {
        this.#granted.add(packId);
      } else {
        this.#permissionChanged(state);
      }
    }

    if (this.#granted.size === 0) return;
    this.#permissionChanged("granted");
    this.#arm();
  }

  #arm(): void {
    this.#cancel();
    const next = [...this.#queue.rows()]
      .filter((row) => this.#granted.has(row.packId))
      .sort((left, right) => left.at - right.at)[0];
    if (next === undefined) return;
    const at = Math.max(this.#clock.now(), next.at);
    this.#timer = this.#clock.setTimer(at, () => {
      this.#timer = null;
      this.#serial(() => this.#fire());
    });
  }

  #serial(work: () => Promise<void>): void {
    this.#working = this.#working
      .catch(() => undefined)
      .then(work)
      .catch((error: unknown) => {
        console.warn("[shell] the reminder scheduler failed", error);
      });
  }

  async #fire(): Promise<void> {
    if (!this.#running) return;
    const now = this.#clock.now();
    const due = this.#queue
      .rows()
      .filter((row) => row.at <= now && this.#granted.has(row.packId))
      .sort((left, right) => left.at - right.at);

    for (const row of due) {
      let result: ReminderShowResult;
      try {
        result = await this.#delivery.show(row);
      } catch (error) {
        this.#onFailed?.(row, error);
        await this.#ensure();
        return;
      }

      if (result === "shown") {
        await this.#queue.remove(row.packId, row.id);
        this.#onDelivered?.(row);
        continue;
      }

      if (result === "failed") {
        this.#onFailed?.(row, new Error("the reminder could not be shown"));
        await this.#ensure();
        return;
      }

      // The OS refused after the host had consent. That is not a person's answer,
      // so it is reported but not written into the consent record.
      this.#granted.delete(row.packId);
      this.#permissionChanged(result);
      await this.#ensure();
      return;
    }

    // Re-evaluate so a second pack with no answer is asked after the first
    // pack's due rows are gone, rather than only on the next save.
    await this.#ensure();
  }

  #permissionChanged(permission: ReminderPermission): void {
    if (this.#lastPermission === permission) return;
    this.#lastPermission = permission;
    this.#onPermission?.(permission);
  }

  #cancel(): void {
    this.#timer?.cancel();
    this.#timer = null;
  }
}

/** Pack ids in the order of their earliest live row, so the first prompt is the most urgent. */
function packOrder(rows: readonly ReminderRow[]): readonly string[] {
  const earliest = new Map<string, number>();
  for (const row of rows) {
    const current = earliest.get(row.packId);
    if (current === undefined || row.at < current) earliest.set(row.packId, row.at);
  }
  return [...earliest.entries()]
    .sort((left, right) => left[1] - right[1])
    .map(([packId]) => packId);
}
