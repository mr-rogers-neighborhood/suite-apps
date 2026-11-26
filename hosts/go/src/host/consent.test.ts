import type { PackCapability } from "@suite/go";
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_DENIALS,
  CAPABILITY_TIERS,
  ConsentDeniedError,
  ConsentRecord,
  type ConsentRequest,
  type ConsentStorage,
  consentTierFor,
  TOKEN_LIFETIME_MS,
} from "./consent.js";

/**
 * The consent record (S4.2, S4.3).
 *
 * These assertions are deliberately the desktop's rules in Go's shape: an answer
 * is keyed by version, a denial is an entry, an update pauses on a fresh
 * question, a pack sees only its own answers, and a removal clears them.
 */

function memoryStorage(initial: string | null = null): ConsentStorage & {
  text: string | null;
  quarantined: boolean;
} {
  const storage = {
    text: initial,
    quarantined: false,
    async read() {
      return storage.text;
    },
    async write(contents: string) {
      storage.text = contents;
    },
    async quarantine() {
      storage.quarantined = true;
      storage.text = null;
    },
  };
  return storage;
}

function request(overrides: Partial<ConsentRequest> = {}): ConsentRequest {
  return {
    publisherId: "suite",
    packId: "planner",
    version: "1.0.0",
    capability: "recents",
    reason: "read the host's recent-files list",
    ...overrides,
  };
}

const YES = async () => true;
const NO = async () => false;

// spec: S4.2
describe("the tier table", () => {
  it("names every capability this host serves at the spec's tier", () => {
    expect(CAPABILITY_TIERS.documents).toBe("install");
    expect(CAPABILITY_TIERS.files).toBe("install");
    expect(CAPABILITY_TIERS.network).toBe("install");
    expect(CAPABILITY_TIERS["identity.pack"]).toBe("install");
    expect(CAPABILITY_TIERS.recents).toBe("first-use");
    expect(CAPABILITY_TIERS.notifications).toBe("token");
    expect(consentTierFor("unknown-capability")).toBe("first-use");
  });
});

// spec: S4.2
describe("asking at a tier", () => {
  it("asks a first-use capability once and remembers the answer", async () => {
    const record = await ConsentRecord.open(memoryStorage());
    let asked = 0;
    const ask = async () => {
      asked += 1;
      return true;
    };

    expect(await record.ensure(request(), ask)).toBe(true);
    expect(await record.ensure(request(), ask)).toBe(true);
    expect(asked).toBe(1);
    expect(record.state(request())).toBe("granted");
  });

  it("remembers a denial as an entry and never asks again", async () => {
    const record = await ConsentRecord.open(memoryStorage());
    let asked = 0;
    const ask = async () => {
      asked += 1;
      return false;
    };

    expect(await record.ensure(request(), ask)).toBe(false);
    expect(await record.ensure(request(), ask)).toBe(false);
    expect(asked).toBe(1);
    expect(record.state(request())).toBe("denied");
    expect(record.entryFor(request())).toMatchObject({ answer: "denied", tier: "first-use" });
  });

  it("does not write an install-tier row from ensure, and a denial cannot be made there", async () => {
    const record = await ConsentRecord.open(memoryStorage());
    let asked = 0;
    const ask = async () => {
      asked += 1;
      return false;
    };

    expect(await record.ensure(request({ capability: "documents" }), ask)).toBe(true);
    expect(asked).toBe(0);
    expect(record.entryFor(request({ capability: "documents" }))).toBeNull();
  });

  it("records install-tier capabilities from the install confirmation and leaves the rest unasked", async () => {
    const record = await ConsentRecord.open(memoryStorage());
    await record.recordInstall({
      pack: { publisherId: "suite", packId: "planner", version: "1.0.0" },
      capabilities: ["documents", "identity.pack", "recents"],
      at: 1_000,
    });

    expect(record.entryFor(request({ capability: "documents" }))).toMatchObject({
      answer: "granted",
      tier: "install",
      source: "install",
      answeredAt: 1_000,
    });
    expect(record.entryFor(request({ capability: "identity.pack" }))).toMatchObject({
      answer: "granted",
      tier: "install",
    });
    // `recents` is first-use, so the install confirmation is not its answer.
    expect(record.entryFor(request())).toBeNull();
  });

  it("asks every use and records the latest answer", async () => {
    let now = 1_000;
    const record = await ConsentRecord.open(memoryStorage(), { now: () => now });
    let call = 0;
    const ask = async () => {
      call += 1;
      return call === 1;
    };
    // The media family is in the tier table but not yet in the closed
    // vocabulary, so this reaches the every-use rule deliberately.
    const everyUse = request({ capability: "media.camera" as PackCapability });

    expect(await record.ensure(everyUse, ask)).toBe(true);
    now = 2_000;
    expect(await record.ensure(everyUse, ask)).toBe(false);
    expect(record.state(everyUse)).toBe("denied");
    expect(record.entryFor(everyUse)).toMatchObject({ answeredAt: 2_000 });
  });

  it("expires a token grant and asks again at the next use", async () => {
    let now = 1_000;
    const record = await ConsentRecord.open(memoryStorage(), { now: () => now });
    let asked = 0;
    const ask = async () => {
      asked += 1;
      return true;
    };
    const notification = request({ capability: "notifications" });

    expect(await record.ensure(notification, ask)).toBe(true);
    expect(record.entryFor(notification)?.expiresAt).toBe(1_000 + TOKEN_LIFETIME_MS);

    now = 1_000 + TOKEN_LIFETIME_MS;
    expect(record.state(notification)).toBe("expired");
    expect(await record.ensure(notification, ask)).toBe(true);
    expect(asked).toBe(2);
  });

  it("throws the refusal sentence a pack can show", async () => {
    const record = await ConsentRecord.open(memoryStorage());
    await expect(record.require(request(), NO)).rejects.toBeInstanceOf(ConsentDeniedError);
    await expect(record.require(request(), NO)).rejects.toThrow(
      CAPABILITY_DENIALS.recents as string,
    );
  });
});

// spec: S4.3
describe("the record's key and scope", () => {
  it("keys the answer by version, so an update pauses on a fresh question", async () => {
    const record = await ConsentRecord.open(memoryStorage());
    await record.ensure(request({ version: "1.0.0" }), YES);

    expect(record.state(request({ version: "1.0.0" }))).toBe("granted");
    expect(record.state(request({ version: "2.0.0" }))).toBe("unanswered");
    let asked = 0;
    await record.ensure(request({ version: "2.0.0" }), async () => {
      asked += 1;
      return true;
    });
    expect(asked).toBe(1);
  });

  it("gives a pack its own answers only, never another pack's or publisher's", async () => {
    const record = await ConsentRecord.open(memoryStorage());
    await record.ensure(request(), YES);
    await record.ensure(request({ publisherId: "acme", packId: "canvas" }), YES);

    expect(record.answersFor({ publisherId: "suite", packId: "planner" })).toHaveLength(1);
    expect(record.answersFor({ publisherId: "acme", packId: "planner" })).toEqual([]);
    expect(record.answersFor({ publisherId: "suite", packId: "canvas" })).toEqual([]);
  });

  it("forgets one answer only when the person deliberately asks again", async () => {
    const record = await ConsentRecord.open(memoryStorage());
    await record.ensure(request(), NO);
    expect(record.state(request())).toBe("denied");

    await record.forget(request());
    expect(record.state(request())).toBe("unanswered");
    let asked = 0;
    expect(
      await record.ensure(request(), async () => {
        asked += 1;
        return true;
      }),
    ).toBe(true);
    expect(asked).toBe(1);
  });

  it("clears a pack's grants and refusals when the pack is removed", async () => {
    const record = await ConsentRecord.open(memoryStorage());
    await record.ensure(request(), YES);
    await record.ensure(request({ packId: "canvas" }), YES);

    await record.clearForPack("planner");

    expect(record.answersFor({ publisherId: "suite", packId: "planner" })).toEqual([]);
    expect(record.answersFor({ publisherId: "suite", packId: "canvas" })).toHaveLength(1);
  });
});

// spec: S4.3
describe("migrating pre-consent answers", () => {
  it("attaches a recents answer to the installed version and re-asks an unknown pack", async () => {
    const record = await ConsentRecord.open(memoryStorage());
    const result = await record.migrateLegacy({
      recents: [
        {
          containerId: "local",
          publisherId: "suite",
          packId: "planner",
          state: "granted",
          askedAt: 1_000,
        },
        {
          containerId: "local",
          publisherId: "suite",
          packId: "gone",
          state: "denied",
          askedAt: 1_000,
        },
      ],
      notifications: null,
      installed: [{ publisherId: "suite", packId: "planner", version: "2.0.0" }],
    });

    expect(result).toEqual({ recentsMapped: 1, recentsReasked: 1, notifications: "none" });
    expect(record.entryFor(request({ version: "2.0.0" }))).toMatchObject({
      answer: "granted",
      source: "recents-v1",
    });
    expect(record.entryFor(request({ packId: "gone", version: "1.0.0" }))).toBeNull();
  });

  it("does not copy the host-wide reminder answer onto a pack and re-asks instead", async () => {
    const record = await ConsentRecord.open(memoryStorage());
    const result = await record.migrateLegacy({
      recents: [],
      notifications: { state: "granted", askedAt: 1_000 },
      installed: [],
    });

    expect(result.notifications).toBe("reasked");
    expect(record.entryFor(request({ capability: "notifications" }))).toBeNull();
    expect(await record.ensure(request({ capability: "notifications" }), async () => false)).toBe(
      false,
    );
  });

  it("migrates once, even when the legacy list is offered again", async () => {
    const storage = memoryStorage();
    const first = await ConsentRecord.open(storage);
    await first.migrateLegacy({
      recents: [],
      notifications: null,
      installed: [],
    });

    const reopened = await ConsentRecord.open(storage);
    const result = await reopened.migrateLegacy({
      recents: [],
      notifications: { state: "denied", askedAt: 1_000 },
      installed: [],
    });
    expect(result.notifications).toBe("none");
  });
});

describe("a malformed record", () => {
  it("is moved aside and every capability is asked again", async () => {
    const storage = memoryStorage("{not json");
    const record = await ConsentRecord.open(storage);

    expect(storage.quarantined).toBe(true);
    expect(record.entries()).toEqual([]);
    expect(await record.ensure(request({ capability: "documents" }), async () => false)).toBe(true);
  });
});
