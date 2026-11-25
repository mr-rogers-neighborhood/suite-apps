import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_RECENTS, type RecentsScope, RecentsStore } from "./recents.js";

let root: string;
let file: string;
let clock: number;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "suite-desk-recents-"));
  file = join(root, "recents.json");
  clock = 1_000;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function scope(packId: string, publisherId = "suite"): RecentsScope {
  return { containerId: "default", publisherId, packId };
}

function at(): number {
  clock += 1_000;
  return clock;
}

describe("the recent list", () => {
  it("records opens per pack and returns the caller's rows with an id", async () => {
    const store = await RecentsStore.open(file);
    await store.record(scope("canvas"), "board-a", at());
    await store.record(scope("canvas"), "board-b", at());

    const rows = await store.list(scope("canvas"));
    expect(rows).toEqual([
      {
        packId: "canvas",
        documentId: "board-b",
        name: "board-b",
        openedAt: expect.any(Number),
      },
      {
        packId: "canvas",
        documentId: "board-a",
        name: "board-a",
        openedAt: expect.any(Number),
      },
    ]);
  });

  it("keeps a cross-pack record but gives another pack no document id", async () => {
    const store = await RecentsStore.open(file);
    await store.record(scope("canvas"), "board-a", at());
    await store.record(scope("planner"), "week-1", at());

    const rows = await store.list(scope("canvas"));
    const foreign = rows.find((row) => row.packId === "planner");
    expect(foreign).toEqual({
      packId: "planner",
      documentId: null,
      name: null,
      openedAt: expect.any(Number),
    });
    // The host keeps the whole row, so its own launcher can still explain it.
    expect(
      store.rows().some((row) => row.packId === "planner" && row.documentId === "week-1"),
    ).toBe(true);
  });

  it("removes a forgotten row for good and leaves the document alone", async () => {
    const store = await RecentsStore.open(file);
    await store.record(scope("canvas"), "board-a", at());
    await store.record(scope("canvas"), "board-b", at());

    await store.forget(scope("canvas"), "board-a");
    const rows = await store.list(scope("canvas"));
    expect(rows.map((row) => row.documentId)).toEqual(["board-b"]);

    // Reopening the store does not bring the forgotten row back: forget is a
    // removal, not a tombstone the next write can undo.
    const reopened = await RecentsStore.open(file);
    expect((await reopened.list(scope("canvas"))).map((row) => row.documentId)).toEqual([
      "board-b",
    ]);
  });

  it("does not let one pack forget another pack's row", async () => {
    const store = await RecentsStore.open(file);
    await store.record(scope("canvas"), "board-a", at());

    await store.forget(scope("planner"), "board-a");
    expect(store.rows()).toHaveLength(1);
  });

  it("keys a row by publisher, so a reused pack id is a different app", async () => {
    const store = await RecentsStore.open(file);
    await store.record(scope("canvas", "publisher-a"), "board-a", at());

    const rows = await store.list(scope("canvas", "publisher-b"));
    expect(rows.map((row) => row.documentId)).toEqual([null]);
  });

  it("keeps the newest opens and drops the oldest past the bound", async () => {
    const store = await RecentsStore.open(file);
    for (let index = 0; index <= MAX_RECENTS; index += 1) {
      await store.record(scope("canvas"), `board-${index}`, at());
    }

    expect(store.rows()).toHaveLength(MAX_RECENTS);
    expect(store.rows()[0]?.documentId).toBe(`board-${MAX_RECENTS}`);
  });

  it("records a newer open of the same document once", async () => {
    const store = await RecentsStore.open(file);
    await store.record(scope("canvas"), "board-a", at());
    await store.record(scope("canvas"), "board-a", at());

    expect(store.rows()).toHaveLength(1);
  });

  // spec: S4.3
  it("reads a version-1 permission for the one-time migration and then rewrites rows only", async () => {
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        permissions: {
          "default:suite:canvas": { state: "granted", askedAt: 1_000 },
        },
        rows: [
          {
            containerId: "default",
            publisherId: "suite",
            packId: "canvas",
            documentId: "board-a",
            openedAt: 2_000,
          },
        ],
      }),
      "utf8",
    );

    const store = await RecentsStore.open(file);
    expect(store.legacyPermissions()).toEqual([
      {
        containerId: "default",
        publisherId: "suite",
        packId: "canvas",
        state: "granted",
        askedAt: 1_000,
      },
    ]);
    expect(store.rows()).toHaveLength(1);

    await store.discardLegacyPermissions();

    const written = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    expect(written.version).toBe(2);
    expect(written.permissions).toBeUndefined();
    // The answer is no longer read again: the consent record owns it now.
    expect((await RecentsStore.open(file)).legacyPermissions()).toEqual([]);
  });
});
