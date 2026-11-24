import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PackCapability } from "@suite/pack/capabilities";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CAPABILITY_TIERS,
  ConsentRecord,
  type ConsentRequest,
  consentTierFor,
  TOKEN_LIFETIME_MS,
} from "./consent.js";

let root: string;
let file: string;
let now: number;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "suite-shell-consent-"));
  file = join(root, "consent.json");
  now = 1_000;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function request(overrides: Partial<ConsentRequest> = {}): ConsentRequest {
  return {
    publisherId: "suite",
    packId: "canvas",
    version: "1.0.0",
    capability: "recents",
    reason: "read the host's recent-files list",
    ...overrides,
  };
}

async function record(): Promise<ConsentRecord> {
  return ConsentRecord.open(file, { now: () => now });
}

function answers(values: readonly boolean[]): () => Promise<boolean> {
  let index = 0;
  return async () => {
    const value = values[index] ?? values[values.length - 1] ?? false;
    index += 1;
    return value;
  };
}

describe("the consent tiers", () => {
  // spec: S4.2
  it("asks each capability this host serves at the tier the spec names", () => {
    expect(consentTierFor("recents")).toBe("first-use");
    expect(consentTierFor("notifications")).toBe("token");
    expect(consentTierFor("documents")).toBe("install");
    expect(consentTierFor("files")).toBe("install");
    expect(consentTierFor("network")).toBe("install");
    expect(consentTierFor("identity.pack")).toBe("install");
    // The media rows are in the spec table; this host refuses a pack that
    // requires one, so the tier is implemented but not reachable today.
    expect(CAPABILITY_TIERS["media.camera"]).toBe("every-use");
  });
});

describe("the consent record", () => {
  // spec: S4.2
  it("records install-tier capabilities from the install confirmation and leaves the others unasked", async () => {
    const store = await record();
    await store.recordInstall({
      pack: { publisherId: "suite", packId: "canvas", version: "1.0.0" },
      capabilities: ["documents", "files", "recents", "notifications"],
      at: 900,
    });

    expect(store.state(request({ capability: "documents" }))).toBe("granted");
    expect(store.entryFor(request({ capability: "documents" }))?.source).toBe("install");
    // A first-use capability is not answered by installing; it is asked where used.
    expect(store.state(request())).toBe("unanswered");
    expect(store.state(request({ capability: "notifications" }))).toBe("unanswered");
  });

  // spec: S4.2
  it("records the same install-tier row from a file install and a catalogue install", async () => {
    const store = await record();
    const pack = { publisherId: "suite", packId: "canvas", version: "1.0.0" };
    const capabilities: readonly PackCapability[] = ["documents", "recents", "notifications"];

    await store.recordInstall({ pack, capabilities, at: 900 });
    const fileInstall = store.entries();
    await store.clearForPack("canvas");
    await store.recordInstall({ pack, capabilities, at: 900 });

    expect(store.entries()).toEqual(fileInstall);
    // Only the install-tier capability is answered; the other two wait for use.
    expect(fileInstall).toHaveLength(1);
    expect(fileInstall[0]?.capability).toBe("documents");

    // Both install paths in the main process must call the same recorder; the
    // catalogue path once skipped it, which left a catalogue install unanswered.
    const source = await readFile(new URL("./main.ts", import.meta.url), "utf8");
    const filePath = source.slice(
      source.indexOf("async function installPackFromFile"),
      source.indexOf("async function installPackFromCatalogue"),
    );
    const cataloguePath = source.slice(
      source.indexOf("async function installPackFromCatalogue"),
      source.indexOf("function catalogueActionFor"),
    );
    expect(filePath).toContain("recordInstallConsent(installed)");
    expect(cataloguePath).toContain("recordInstallConsent(installed)");
  });

  // spec: S4.3
  it("records what was shown, the answer and when, and survives a reopen", async () => {
    const store = await record();
    const ask = answers([true]);

    expect(await store.ensure(request(), ask)).toBe(true);

    const written = JSON.parse(await readFile(file, "utf8")) as {
      version: number;
      entries: readonly Record<string, unknown>[];
    };
    expect(written.version).toBe(1);
    expect(written.entries).toHaveLength(1);
    expect(written.entries[0]).toMatchObject({
      publisherId: "suite",
      packId: "canvas",
      version: "1.0.0",
      capability: "recents",
      tier: "first-use",
      reason: "read the host's recent-files list",
      answer: "granted",
      shownAt: 1_000,
      answeredAt: 1_000,
      expiresAt: null,
      source: "asked",
    });

    const reopened = await record();
    let askedAgain = false;
    const secondAsk = async (): Promise<boolean> => {
      askedAgain = true;
      return true;
    };
    expect(await reopened.ensure(request(), secondAsk)).toBe(true);
    expect(askedAgain).toBe(false);
  });

  // spec: S4.2
  it("remembers a first-use denial as an entry and never asks again", async () => {
    const store = await record();
    const ask = answers([false]);

    expect(await store.ensure(request(), ask)).toBe(false);
    expect(store.state(request())).toBe("denied");

    const reopened = await record();
    let asked = 0;
    const second = async (): Promise<boolean> => {
      asked += 1;
      return true;
    };
    expect(await reopened.ensure(request(), second)).toBe(false);
    expect(asked).toBe(0);
    expect(reopened.entryFor(request())?.answer).toBe("denied");
  });

  // spec: S4.2
  it("asks every use and records the latest answer", async () => {
    const store = await record();
    const ask = answers([true, false]);
    const camera = request({ capability: "media.camera" as PackCapability });

    expect(await store.ensure(camera, ask)).toBe(true);
    expect(await store.ensure(camera, ask)).toBe(false);
    expect(store.entryFor(camera)?.tier).toBe("every-use");
    expect(store.entryFor(camera)?.answer).toBe("denied");
    expect(store.entries()).toHaveLength(1);
  });

  // spec: S4.2
  it("expires a token grant and asks again at the next use", async () => {
    const store = await record();
    const notifications = request({ capability: "notifications" });
    const ask = answers([true, true]);

    expect(await store.ensure(notifications, ask)).toBe(true);
    const entry = store.entryFor(notifications);
    expect(entry?.tier).toBe("token");
    expect(entry?.expiresAt).toBe(1_000 + TOKEN_LIFETIME_MS);

    now = 1_000 + TOKEN_LIFETIME_MS - 1;
    expect(store.state(notifications)).toBe("granted");

    now = 1_000 + TOKEN_LIFETIME_MS;
    expect(store.state(notifications)).toBe("expired");
    expect(await store.ensure(notifications, ask)).toBe(true);
    expect(store.entryFor(notifications)?.answeredAt).toBe(now);
  });

  // spec: S4.3
  it("keys the answer by version, so an update pauses on a fresh question", async () => {
    const store = await record();
    const ask = answers([true, true]);

    expect(await store.ensure(request(), ask)).toBe(true);
    const updated = request({ version: "1.1.0" });
    expect(store.state(updated)).toBe("unanswered");
    expect(await store.ensure(updated, ask)).toBe(true);
    expect(store.answersFor({ publisherId: "suite", packId: "canvas" })).toHaveLength(2);
  });

  // spec: S4.3
  it("gives a pack its own answers only, never another pack's or publisher's", async () => {
    const store = await record();
    const ask = answers([true]);
    await store.ensure(request(), ask);
    await store.ensure(request({ packId: "planner" }), ask);
    await store.ensure(request({ publisherId: "other" }), ask);

    expect(
      store.answersFor({ publisherId: "suite", packId: "canvas" }).map((entry) => entry.packId),
    ).toEqual(["canvas"]);
    expect(
      store
        .answersFor({ publisherId: "other", packId: "canvas" })
        .map((entry) => entry.publisherId),
    ).toEqual(["other"]);
  });

  // spec: S4.3
  it("clears a pack's grants and refusals when the pack is removed", async () => {
    const store = await record();
    const ask = answers([true, false]);
    await store.ensure(request(), ask);
    await store.ensure(request({ capability: "notifications" }), ask);
    await store.ensure(request({ packId: "planner" }), ask);

    await store.clearForPack("canvas");

    expect(store.answersFor({ publisherId: "suite", packId: "canvas" })).toEqual([]);
    expect(store.answersFor({ publisherId: "suite", packId: "planner" })).toHaveLength(1);
  });

  // spec: S4.2
  it("forgets one answer only when the person deliberately asks again", async () => {
    const store = await record();
    const ask = answers([false]);
    await store.ensure(request(), ask);

    await store.forget(request());

    expect(store.state(request())).toBe("unanswered");
    expect(store.entryFor(request())).toBeNull();
  });

  // spec: S4.3
  it("shows a denial and an expired token on the pack's card", async () => {
    const store = await record();
    const ask = answers([false, true]);
    await store.ensure(request({ capability: "notifications" }), ask);
    expect(store.viewsFor({ publisherId: "suite", packId: "canvas", version: "1.0.0" })).toEqual([
      expect.objectContaining({ capability: "notifications", answer: "denied", tier: "token" }),
    ]);

    await store.forget(request({ capability: "notifications" }));
    await store.ensure(request({ capability: "notifications" }), ask);
    now += TOKEN_LIFETIME_MS;
    expect(store.viewsFor({ publisherId: "suite", packId: "canvas", version: "1.0.0" })).toEqual([
      expect.objectContaining({ capability: "notifications", answer: "expired" }),
    ]);
  });
});

describe("the legacy consent migration", () => {
  // spec: S4.3
  it("attaches a recents answer to the installed version and re-asks an unknown pack", async () => {
    const store = await record();
    const result = await store.migrateLegacy({
      recents: [
        {
          containerId: "default",
          publisherId: "suite",
          packId: "canvas",
          state: "granted",
          askedAt: 900,
        },
        {
          containerId: "default",
          publisherId: "suite",
          packId: "missing",
          state: "denied",
          askedAt: 900,
        },
      ],
      notifications: null,
      installed: [{ publisherId: "suite", packId: "canvas", version: "1.0.0" }],
    });

    expect(result).toEqual({ recentsMapped: 1, recentsReasked: 1, notifications: "none" });
    const entry = store.entryFor(request());
    expect(entry).toMatchObject({
      capability: "recents",
      tier: "first-use",
      answer: "granted",
      source: "recents-v1",
      shownAt: 900,
    });
    expect(store.state(request())).toBe("granted");
  });

  // spec: S4.3
  it("does not copy the host-wide reminder answer onto a pack and re-asks instead", async () => {
    const store = await record();
    const result = await store.migrateLegacy({
      recents: [],
      notifications: { state: "granted", askedAt: 900 },
      installed: [{ publisherId: "suite", packId: "canvas", version: "1.0.0" }],
    });

    expect(result.notifications).toBe("reasked");
    // Nothing was granted: the old answer named no pack, so guessing one would
    // silently re-grant every pack. The next use asks through the one surface.
    expect(store.entries()).toEqual([]);
    expect(store.state(request({ capability: "notifications" }))).toBe("unanswered");

    let asked = 0;
    const ask = async (): Promise<boolean> => {
      asked += 1;
      return true;
    };
    expect(await store.ensure(request({ capability: "notifications" }), ask)).toBe(true);
    expect(asked).toBe(1);
  });

  // spec: S4.3
  it("runs once, so a later deliberate denial is not overwritten by the old file", async () => {
    const store = await record();
    await store.migrateLegacy({
      recents: [
        {
          containerId: "default",
          publisherId: "suite",
          packId: "canvas",
          state: "granted",
          askedAt: 900,
        },
      ],
      notifications: null,
      installed: [{ publisherId: "suite", packId: "canvas", version: "1.0.0" }],
    });
    await store.forget(request());

    await store.migrateLegacy({
      recents: [
        {
          containerId: "default",
          publisherId: "suite",
          packId: "canvas",
          state: "granted",
          askedAt: 900,
        },
      ],
      notifications: { state: "granted", askedAt: 900 },
      installed: [{ publisherId: "suite", packId: "canvas", version: "1.0.0" }],
    });

    expect(store.state(request())).toBe("unanswered");
    expect(store.entries()).toEqual([]);
  });
});
