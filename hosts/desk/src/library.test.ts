import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DocumentStore } from "./documents.js";
import { type DirectoryWatch, type LibraryScope, LibraryWatch, revealDocument } from "./library.js";

let root: string;
let store: DocumentStore;
let file: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "suite-desk-library-"));
  store = new DocumentStore(join(root, "documents"), "suite");
  file = join(root, "library.json");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function scope(packId: string, publisherId = "suite"): LibraryScope {
  return { containerId: "default", publisherId, packId };
}

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("reveal", () => {
  it("hands the main process the document's own path and the pack only the summary", async () => {
    await store.create("default", "canvas", "board-a");
    const seen: string[] = [];

    const summary = await revealDocument(
      store,
      { containerId: "default", packId: "canvas" },
      "board-a",
      (path) => seen.push(path),
    );

    expect(seen).toHaveLength(1);
    const path = seen[0];
    if (path === undefined) throw new Error("the host was not asked to reveal");
    expect(path.startsWith(join(root, "documents"))).toBe(true);
    expect(path.endsWith("board-a")).toBe(true);
    expect((await stat(path)).isFile()).toBe(true);

    expect(summary?.id).toBe("board-a");
    // What the pack receives carries no absolute path.
    expect(JSON.stringify(summary)).not.toContain(root);
  });

  it("does not open the file manager for a document that is not there", async () => {
    const seen: string[] = [];
    const summary = await revealDocument(
      store,
      { containerId: "default", packId: "canvas" },
      "missing",
      (path) => seen.push(path),
    );
    expect(summary).toBeNull();
    expect(seen).toEqual([]);
  });

  it("refuses a document name that is a path", async () => {
    const seen: string[] = [];
    await expect(
      revealDocument(
        store,
        { containerId: "default", packId: "canvas" },
        "../other-pack/board-a",
        (path) => seen.push(path),
      ),
    ).rejects.toThrow("invalid document name");
    expect(seen).toEqual([]);
  });
});

describe("the document watch", () => {
  it("takes the first look as a baseline and reports a later change", async () => {
    await store.create("default", "canvas", "board-a");
    const watch = await LibraryWatch.open(file);
    const who = scope("canvas");

    expect(await watch.pending(store, who)).toEqual([]);

    await store.save("default", "canvas", "board-a", bytes("edited"));
    expect(await watch.pending(store, who)).toEqual(["board-a"]);
  });

  it("stops reporting a change once the pack has seen it", async () => {
    await store.create("default", "canvas", "board-a");
    const watch = await LibraryWatch.open(file);
    const who = scope("canvas");
    await watch.pending(store, who);

    const saved = await store.save("default", "canvas", "board-a", bytes("edited"));
    expect(await watch.pending(store, who)).toEqual(["board-a"]);
    await watch.markSeen(store, who, [saved]);
    expect(await watch.pending(store, who)).toEqual([]);
  });

  it("reports a document that appeared and one that was removed", async () => {
    await store.create("default", "canvas", "board-a");
    const watch = await LibraryWatch.open(file);
    const who = scope("canvas");
    await watch.pending(store, who);

    await store.create("default", "canvas", "board-b");
    expect(await watch.pending(store, who)).toEqual(["board-b"]);

    await store.remove("default", "canvas", "board-a");
    expect(await watch.pending(store, who)).toEqual(["board-a", "board-b"]);
  });

  it("keeps two packs' documents apart", async () => {
    await store.create("default", "canvas", "board-a");
    await store.create("default", "planner", "week-1");
    const watch = await LibraryWatch.open(file);

    await watch.pending(store, scope("canvas"));
    await watch.pending(store, scope("planner"));
    await store.save("default", "planner", "week-1", bytes("edited"));

    expect(await watch.pending(store, scope("canvas"))).toEqual([]);
    expect(await watch.pending(store, scope("planner"))).toEqual(["week-1"]);
  });

  it("survives a reopen, so a change made while the host was off is not lost", async () => {
    await store.create("default", "canvas", "board-a");
    const first = await LibraryWatch.open(file);
    await first.pending(store, scope("canvas"));

    await store.save("default", "canvas", "board-a", bytes("edited while closed"));
    const reopened = await LibraryWatch.open(file);
    expect(await reopened.pending(store, scope("canvas"))).toEqual(["board-a"]);
  });

  it("delivers an id to an open tab and nothing while the pack is closed", async () => {
    await store.create("default", "canvas", "board-a");
    const directories: string[] = [];
    let trigger: (() => void) | null = null;
    let closes = 0;
    const watchDirectory: DirectoryWatch = (directory, onChange) => {
      directories.push(directory);
      trigger = onChange;
      return () => {
        closes += 1;
      };
    };

    const watch = await LibraryWatch.open(file, { watch: watchDirectory });
    const who = scope("canvas");
    await watch.pending(store, who);

    // Closed: the change is recorded but nobody is told.
    await store.save("default", "canvas", "board-a", bytes("edited"));
    expect(trigger).toBeNull();

    const delivered: Array<readonly string[]> = [];
    await watch.subscribe(store, who, "tab-1", (ids) => delivered.push(ids));
    expect(directories).toEqual([store.directoryFor("default", "canvas")]);
    const fire = trigger as (() => void) | null;
    if (fire === null) throw new Error("the host installed no watcher");
    fire();
    await watch.settle();

    expect(delivered).toEqual([["board-a"]]);
    // The delivery is a sighting: the next start does not repeat it.
    expect(await watch.pending(store, who)).toEqual([]);

    watch.unsubscribe("tab-1");
    expect(closes).toBe(1);
  });

  it("shares one watcher between tabs and closes it with the last", async () => {
    let closes = 0;
    const watch = await LibraryWatch.open(file, {
      watch: () => () => {
        closes += 1;
      },
    });
    const who = scope("canvas");

    await watch.subscribe(store, who, "tab-1", () => undefined);
    await watch.subscribe(store, who, "tab-2", () => undefined);
    watch.unsubscribe("tab-1");
    expect(closes).toBe(0);
    watch.unsubscribe("tab-2");
    expect(closes).toBe(1);
  });
});
