import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PackCapability } from "@suite/pack/capabilities";
import type { ConsentTier } from "./shared.js";

/**
 * The host's consent record (S4.2, S4.3).
 *
 * One file beside the publisher trust store, not one answer per feature. Every
 * capability the host serves asks through `ensure`; the record is the only place
 * an answer lives. It is keyed by `(publisher, pack, version, capability)` so an
 * update that adds a capability has no answer and pauses on a fresh question,
 * while a removed capability stops being read at all.
 *
 * A refusal is an entry, not a missing row: `denied` survives a restart and is
 * shown on the pack's card. Only the person clears it, by asking again on that
 * card; a pack cannot prompt itself a second time. A token's expiry is derived
 * from `answeredAt`, never stored as a mutable clock.
 *
 * This module imports no Electron. The dialog lives in `main.ts`; the file and
 * the tier rules live here, so the rule is tested without a window.
 */

export const CONSENT_FILE = "consent.json";
export const CONSENT_VERSION = 1;

/**
 * A token grant lasts thirty days. Long enough that a person is not asked every
 * morning, short enough that a notification grant is not forever; the spec calls
 * the tier "short-lived" and leaves the number to the host.
 */
export const TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

const MAX_INSTANT = 8_640_000_000_000_000;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this rejects.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

/**
 * The tier each capability this host serves is asked at (S4.2, S4.6).
 *
 * - `install` — `documents`, `files`, `network`, `identity.pack`. The install
 *   confirmation already shows the publisher, pack, version and capability list
 *   (S2.5); these are the standing bridge the person installed, and asking again
 *   on every document read would train someone to click yes.
 * - `first-use` — `recents`. Reading the host's recent list is one decision per
 *   pack version. A denial is remembered, not repeated.
 * - `token` — `notifications`. A reminder is delivered while the pack is closed,
 *   so the grant has to outlive the tab; a bounded token is re-asked when it
 *   expires rather than standing forever.
 *
 * The media capabilities are `every-use` per the spec table, but this host does
 * not serve them (S4.1 refuses a pack that requires one), so no request reaches
 * the tier today. It is implemented and tested so serving one later needs no new
 * dialog and no second record.
 */
export const CAPABILITY_TIERS: Readonly<Record<string, ConsentTier>> = {
  documents: "install",
  storage: "install",
  files: "install",
  recents: "first-use",
  notifications: "token",
  network: "install",
  relay: "install",
  commands: "install",
  "identity.pack": "install",
  sync: "first-use",
  "widget.code": "install",
  "media.map": "first-use",
  "media.camera": "every-use",
  "media.model3d": "first-use",
  "media.ar": "every-use",
  "media.vision": "every-use",
};

/** What the pack is asking for, in the sentence the person sees and the record keeps. */
export const CAPABILITY_REASONS: Readonly<Partial<Record<PackCapability, string>>> = {
  documents: "create and edit its own documents in the suite document layer",
  files: "read and write files inside its own pack folder",
  network: "reach the origins its manifest allows",
  relay: "connect to this host's sync relay",
  "identity.pack": "use the identity derived for this pack",
  recents: "read the host's recent-files list",
  notifications: "show reminders after the app is closed",
};

/** A short name for a dialog title. */
export const CAPABILITY_TITLES: Readonly<Partial<Record<PackCapability, string>>> = {
  documents: "Allow documents?",
  files: "Allow pack files?",
  network: "Allow network access?",
  relay: "Allow sync relay access?",
  "identity.pack": "Allow this pack's identity?",
  recents: "Allow recent files?",
  notifications: "Allow reminders?",
};

/** The sentence a refused capability answers with. */
export const CAPABILITY_DENIALS: Readonly<Partial<Record<PackCapability, string>>> = {
  recents: "Recent documents are off; this app may not read the host's recent list.",
  notifications: "Reminders are off: this app is not allowed to show notifications.",
};

/** The tier a capability is asked at. An unknown capability defaults to the weakest ask. */
export function consentTierFor(capability: string): ConsentTier {
  return CAPABILITY_TIERS[capability] ?? "first-use";
}

/** What a capability's grant reads as when it is not granted. */
export type ConsentState = "granted" | "denied" | "expired" | "unanswered";

/**
 * One question. `reason` is the pack's stated reason — the host sentence shown
 * for that capability, recorded verbatim so the file says what the person saw.
 */
export interface ConsentRequest {
  readonly publisherId: string;
  readonly packId: string;
  readonly version: string;
  readonly capability: PackCapability;
  readonly reason: string;
}

/** The identity of a pack, without a capability. */
export interface ConsentPack {
  readonly publisherId: string;
  readonly packId: string;
}

/** The identity of one installed version. */
export interface ConsentPackVersion extends ConsentPack {
  readonly version: string;
}

/** Where an entry came from. `recents-v1` is a migrated ad-hoc answer. */
export type ConsentSource = "asked" | "install" | "recents-v1";

/** One recorded answer, as the file stores it. */
export interface ConsentEntry extends ConsentPackVersion {
  readonly capability: PackCapability;
  readonly tier: ConsentTier;
  /** What the person was shown. */
  readonly reason: string;
  readonly answer: "granted" | "denied";
  readonly shownAt: number;
  readonly answeredAt: number;
  /** Token grants expire; every other tier keeps `null`. */
  readonly expiresAt: number | null;
  readonly source: ConsentSource;
}

/**
 * What the host migrated, and what it refused to guess.
 *
 * The notification answer was one host-wide permission with no pack identity, so
 * it cannot become a per-pack entry honestly. It is marked here and re-asked at
 * the pack's next use; the old shape is not copied onto a pack.
 */
export interface ConsentMigrations {
  readonly recents: boolean;
  readonly notifications: boolean;
}

export interface ConsentData {
  readonly version: typeof CONSENT_VERSION;
  readonly migrations: ConsentMigrations;
  readonly entries: readonly ConsentEntry[];
}

/** What the chrome sees for one pack's card. */
export interface ConsentView {
  readonly capability: PackCapability;
  readonly tier: ConsentTier;
  readonly answer: "granted" | "denied" | "expired";
  readonly reason: string;
  readonly answeredAt: number;
}

/** One answer from the old `recents.json` (version 1). */
export interface LegacyRecentsPermission {
  readonly containerId: string;
  readonly publisherId: string;
  readonly packId: string;
  readonly state: "granted" | "denied";
  readonly askedAt: number;
}

/** The old `reminders.json` answer. It had no pack, publisher or version. */
export interface LegacyNotificationPermission {
  readonly state: "granted" | "denied";
  readonly askedAt: number;
}

export interface LegacyConsentInput {
  readonly recents: readonly LegacyRecentsPermission[];
  readonly notifications: LegacyNotificationPermission | null;
  /** The versions the loader serves now, one per pack id. */
  readonly installed: readonly ConsentPackVersion[];
}

export interface LegacyConsentResult {
  readonly recentsMapped: number;
  /** Old recents answers with no installed version to attach to; re-asked on next use. */
  readonly recentsReasked: number;
  readonly notifications: "reasked" | "none";
}

/** The pack asked again, and the person is not being asked; the sentence is theirs to read. */
export class ConsentDeniedError extends Error {
  constructor(sentence: string) {
    super(sentence);
    this.name = "ConsentDeniedError";
  }
}

function emptyData(): ConsentData {
  return {
    version: CONSENT_VERSION,
    migrations: { recents: false, notifications: false },
    entries: [],
  };
}

function isContainerId(value: string): boolean {
  return value.length > 0 && value.length <= 64 && !CONTROL_CHARACTER.test(value);
}

function isInstant(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_INSTANT;
}

function keyFor(entry: ConsentPackVersion & { readonly capability: PackCapability }): string {
  return [entry.publisherId, entry.packId, entry.version, entry.capability].join("\u0000");
}

function isEntry(value: unknown): value is ConsentEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  if (typeof entry.publisherId !== "string" || entry.publisherId.length === 0) return false;
  if (typeof entry.packId !== "string" || entry.packId.length === 0) return false;
  if (typeof entry.version !== "string" || entry.version.length === 0) return false;
  if (typeof entry.capability !== "string") return false;
  if (entry.tier !== "install" && entry.tier !== "first-use") {
    if (entry.tier !== "every-use" && entry.tier !== "token") return false;
  }
  if (typeof entry.reason !== "string") return false;
  if (entry.answer !== "granted" && entry.answer !== "denied") return false;
  if (!isInstant(entry.shownAt) || !isInstant(entry.answeredAt)) return false;
  if (entry.expiresAt !== null && !isInstant(entry.expiresAt)) return false;
  if (entry.source !== "asked" && entry.source !== "install" && entry.source !== "recents-v1") {
    return false;
  }
  return true;
}

function parseData(value: unknown): ConsentData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("the consent record is not an object");
  }
  const record = value as Record<string, unknown>;
  if (record.version !== CONSENT_VERSION) {
    throw new Error(`the consent record is at version ${String(record.version)}`);
  }

  const migrations = record.migrations;
  const migrated =
    typeof migrations === "object" && migrations !== null
      ? (migrations as Record<string, unknown>)
      : {};
  if (!Array.isArray(record.entries)) throw new Error("the consent record has no entries");

  const entries: ConsentEntry[] = [];
  const seen = new Set<string>();
  for (const candidate of record.entries) {
    if (!isEntry(candidate)) continue;
    const key = keyFor(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(candidate);
  }

  return {
    version: CONSENT_VERSION,
    migrations: {
      recents: migrated.recents === true,
      notifications: migrated.notifications === true,
    },
    entries,
  };
}

/**
 * The consent record on disk, with a serialised writer.
 *
 * Like the trust store, a malformed file is not a reason to boot into a half
 * state: it is moved aside and the host starts with no answers, so every
 * capability is asked again. Losing answers costs a question, not a document.
 */
export class ConsentRecord {
  readonly #file: string;
  readonly #now: () => number;
  readonly #tokenLifetime: number;
  #data: ConsentData;
  #writing: Promise<void> = Promise.resolve();

  private constructor(file: string, data: ConsentData, now: () => number, tokenLifetime: number) {
    this.#file = file;
    this.#data = data;
    this.#now = now;
    this.#tokenLifetime = tokenLifetime;
  }

  static async open(
    file: string,
    options: { readonly now?: () => number; readonly tokenLifetime?: number } = {},
  ): Promise<ConsentRecord> {
    let parsed: ConsentData | null = null;
    try {
      parsed = parseData(JSON.parse(await readFile(file, "utf8")));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        await rename(file, `${file}.corrupt-${Date.now()}`).catch(() => undefined);
        console.warn(
          "[desk] the consent record could not be read; every capability is re-asked",
          error,
        );
      }
    }
    const lifetime = options.tokenLifetime ?? TOKEN_LIFETIME_MS;
    if (!Number.isInteger(lifetime) || lifetime <= 0) {
      throw new Error("invalid token lifetime");
    }
    return new ConsentRecord(file, parsed ?? emptyData(), options.now ?? Date.now, lifetime);
  }

  /**
   * What this record holds. Only the host calls this; a pack-facing read is
   * `answersFor` below, scoped to one pack.
   */
  entries(): readonly ConsentEntry[] {
    return this.#data.entries;
  }

  /** The entry for this exact version and capability, or null. */
  entryFor(request: ConsentRequest): ConsentEntry | null {
    const key = keyFor(request);
    return this.#data.entries.find((entry) => keyFor(entry) === key) ?? null;
  }

  /**
   * A pack's own answers, across the versions it has on disk.
   *
   * The publisher is part of the scope, so a reused pack id from a different
   * publisher sees none of the previous owner's grants (S2.2). There is no
   * method here that returns another pack's entries.
   */
  answersFor(pack: ConsentPack): readonly ConsentEntry[] {
    return this.#data.entries.filter(
      (entry) => entry.publisherId === pack.publisherId && entry.packId === pack.packId,
    );
  }

  /** The current answer for one version and capability. */
  state(request: ConsentRequest): ConsentState {
    const entry = this.entryFor(request);
    if (entry === null) return "unanswered";
    if (entry.answer === "denied") return "denied";
    if (entry.tier === "token" && entry.expiresAt !== null && this.#now() >= entry.expiresAt) {
      return "expired";
    }
    return "granted";
  }

  /** What the chrome's pack card shows for one installed version. */
  viewsFor(pack: ConsentPackVersion): readonly ConsentView[] {
    return this.#data.entries
      .filter(
        (entry) =>
          entry.publisherId === pack.publisherId &&
          entry.packId === pack.packId &&
          entry.version === pack.version,
      )
      .map((entry) => ({
        capability: entry.capability,
        tier: entry.tier,
        answer:
          entry.answer === "denied"
            ? "denied"
            : this.state({ ...pack, capability: entry.capability, reason: entry.reason }) ===
                "expired"
              ? "expired"
              : "granted",
        reason: entry.reason,
        answeredAt: entry.answeredAt,
      }));
  }

  /**
   * Ask at the tier's rule and record the answer.
   *
   * `ask` is only called when the tier says a person must answer: no entry
   * (`first-use` and `token`), an expired token, or every single `every-use`
   * call. A remembered denial is returned without calling `ask`, which is what
   * stops a pack from nagging.
   */
  async ensure(request: ConsentRequest, ask: () => Promise<boolean>): Promise<boolean> {
    const tier = consentTierFor(request.capability);

    if (tier === "install") {
      // Shown once, in the install confirmation (S2.5). A later read is not a
      // new question; a refusal cannot be created through this call.
      return this.state(request) !== "denied";
    }

    if (tier === "every-use") return this.#ask(request, tier, ask);

    const state = this.state(request);
    if (state === "granted" || state === "denied") return state === "granted";
    return this.#ask(request, tier, ask);
  }

  /**
   * Record the install-time answer.
   *
   * The person saw these capabilities in the install confirmation. Only the
   * `install` tier is written here; a first-use or token capability stays
   * unanswered until it is actually used.
   */
  async recordInstall(input: {
    readonly pack: ConsentPackVersion;
    readonly capabilities: readonly PackCapability[];
    readonly at?: number;
  }): Promise<void> {
    const at = input.at ?? this.#now();
    if (!isInstant(at)) throw new Error("invalid consent time");
    const entries = [...this.#data.entries];
    let changed = false;

    for (const capability of input.capabilities) {
      if (consentTierFor(capability) !== "install") continue;
      const reason = CAPABILITY_REASONS[capability] ?? capability;
      const entry: ConsentEntry = {
        publisherId: input.pack.publisherId,
        packId: input.pack.packId,
        version: input.pack.version,
        capability,
        tier: "install",
        reason,
        answer: "granted",
        shownAt: at,
        answeredAt: at,
        expiresAt: null,
        source: "install",
      };
      replaceEntry(entries, entry);
      changed = true;
    }

    if (!changed) return;
    this.#data = { ...this.#data, entries };
    await this.#persist();
  }

  /** Forget one answer, so the next `ensure` asks again. The person's deliberate re-ask. */
  async forget(request: ConsentRequest): Promise<void> {
    const key = keyFor(request);
    const entries = this.#data.entries.filter((entry) => keyFor(entry) !== key);
    if (entries.length === this.#data.entries.length) return;
    this.#data = { ...this.#data, entries };
    await this.#persist();
  }

  /** Clear every grant and refusal for a pack id. A removed pack leaves no consent behind. */
  async clearForPack(packId: string): Promise<void> {
    const entries = this.#data.entries.filter((entry) => entry.packId !== packId);
    if (entries.length === this.#data.entries.length) return;
    this.#data = { ...this.#data, entries };
    await this.#persist();
  }

  /**
   * Move the two ad-hoc answers into this record, once.
   *
   * A recents answer carries `(container, publisher, pack)` but no version; it is
   * attached to the version the loader serves for that publisher and pack today,
   * and the entry keeps `source: "recents-v1"`. A pack with no installed version
   * has nothing to attach the answer to, so it is counted as re-asked rather than
   * invented.
   *
   * The reminder answer is one host-wide permission with no pack at all. It
   * cannot become a per-pack grant without silently re-granting to every pack,
   * so nothing is copied: the notification capability is re-asked at the next
   * pack that uses it, and the record says the migration was unmappable.
   */
  async migrateLegacy(input: LegacyConsentInput): Promise<LegacyConsentResult> {
    let recentsMapped = 0;
    let recentsReasked = 0;
    const entries = [...this.#data.entries];
    const recentsDone = this.#data.migrations.recents;
    const notificationsDone = this.#data.migrations.notifications;

    if (!recentsDone) {
      for (const legacy of input.recents) {
        if (!isContainerId(legacy.containerId)) {
          recentsReasked += 1;
          continue;
        }
        if (!isInstant(legacy.askedAt)) {
          recentsReasked += 1;
          continue;
        }
        const installed = input.installed.filter(
          (pack) => pack.publisherId === legacy.publisherId && pack.packId === legacy.packId,
        );
        if (installed.length !== 1) {
          recentsReasked += 1;
          continue;
        }
        const pack = installed[0];
        if (pack === undefined) {
          recentsReasked += 1;
          continue;
        }
        const entry: ConsentEntry = {
          publisherId: legacy.publisherId,
          packId: legacy.packId,
          version: pack.version,
          capability: "recents",
          tier: "first-use",
          reason: CAPABILITY_REASONS.recents ?? "recents",
          answer: legacy.state,
          shownAt: legacy.askedAt,
          answeredAt: legacy.askedAt,
          expiresAt: null,
          source: "recents-v1",
        };
        replaceEntry(entries, entry);
        recentsMapped += 1;
      }
    }

    const notifications = !notificationsDone && input.notifications !== null ? "reasked" : "none";

    this.#data = {
      ...this.#data,
      migrations: {
        recents: true,
        notifications: true,
      },
      entries,
    };
    await this.#persist();

    return { recentsMapped, recentsReasked, notifications };
  }

  async #ask(
    request: ConsentRequest,
    tier: ConsentTier,
    ask: () => Promise<boolean>,
  ): Promise<boolean> {
    const shownAt = this.#now();
    if (!isInstant(shownAt)) return false;
    const granted = await ask();
    const answeredAt = this.#now();
    if (!isInstant(answeredAt)) return false;

    const entry: ConsentEntry = {
      publisherId: request.publisherId,
      packId: request.packId,
      version: request.version,
      capability: request.capability,
      tier,
      reason: request.reason,
      answer: granted ? "granted" : "denied",
      shownAt,
      answeredAt,
      expiresAt: tier === "token" && granted ? answeredAt + this.#tokenLifetime : null,
      source: "asked",
    };
    const entries = [...this.#data.entries];
    replaceEntry(entries, entry);
    this.#data = { ...this.#data, entries };
    await this.#persist();
    return granted;
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

function replaceEntry(entries: ConsentEntry[], entry: ConsentEntry): void {
  const key = keyFor(entry);
  const index = entries.findIndex((candidate) => keyFor(candidate) === key);
  if (index === -1) entries.push(entry);
  else entries[index] = entry;
}
