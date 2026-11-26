import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isScreenRow, type ScreenEntry, screenEntryRegistryIds } from "@suite/screens";
import { LoroDoc } from "loro-crdt";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DESK_APPS_WIDGET, HOME_SCREEN_ID, HOME_SCREEN_NAME, migrateHome } from "./home.js";
import { SCREENS_INDEX_FILENAME, ScreenSet, ScreenStore } from "./screens.js";

let root: string;
let path: string;

function entryIds(widgets: readonly ScreenEntry[]): string[] {
  return widgets.flatMap(screenEntryRegistryIds);
}

function entryId(entry: ScreenEntry | undefined): string | undefined {
  return entry === undefined || isScreenRow(entry) ? undefined : entry.registryId;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "suite-desk-screens-"));
  path = join(root, "screens", `${HOME_SCREEN_ID}.loro`);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("the Home screen", () => {
  it("starts as an empty Home", async () => {
    const store = await ScreenStore.open(path);

    expect(store.state()).toEqual({
      format: "suite.screen",
      version: 2,
      id: HOME_SCREEN_ID,
      name: HOME_SCREEN_NAME,
      widgets: [],
    });
  });

  it("migrates the old host app grid out of Home", async () => {
    const set = await ScreenSet.open({
      directory: join(root, "screens"),
      indexFile: join(root, SCREENS_INDEX_FILENAME),
    });
    await set.store(HOME_SCREEN_ID)?.add({ registryId: DESK_APPS_WIDGET, size: "full" });

    await migrateHome(set);

    expect(set.screen(HOME_SCREEN_ID)?.widgets).toEqual([]);
  });

  it("does not write until something changes", async () => {
    await ScreenStore.open(path);
    expect(existsSync(path)).toBe(false);
  });

  it("saves a change and restores it", async () => {
    const first = await ScreenStore.open(path);
    await first.add({ registryId: "welcome.notes", size: "2x1" });
    await first.resize("welcome.notes", "1x1");

    const second = await ScreenStore.open(path);
    expect(second.state().widgets).toEqual([{ registryId: "welcome.notes", size: "1x1" }]);
  });

  it("keeps a backup of the previous snapshot beside the document", async () => {
    const store = await ScreenStore.open(path);
    await store.add({ registryId: "welcome.notes", size: "2x1" });
    await store.resize("welcome.notes", "1x1");

    const files = await readdir(join(root, "screens"));
    expect(files).toContain(`${HOME_SCREEN_ID}.loro`);
    expect(files).toContain(`${HOME_SCREEN_ID}.loro.bak`);
    expect((await readFile(`${path}.bak`)).byteLength).toBeGreaterThan(0);
  });

  it("quarantines an unreadable document and starts a fresh Home", async () => {
    await mkdir(join(root, "screens"), { recursive: true });
    await writeFile(path, "not a loro snapshot");

    const store = await ScreenStore.open(path);
    expect(store.state().id).toBe(HOME_SCREEN_ID);
    const files = await readdir(join(root, "screens"));
    expect(files.some((name) => name.startsWith(`${HOME_SCREEN_ID}.loro.corrupt-`))).toBe(true);
  });

  it("refuses an oversized document before reading it", async () => {
    await mkdir(join(root, "screens"), { recursive: true });
    await writeFile(path, Buffer.alloc(4 * 1024 * 1024 + 1));

    const store = await ScreenStore.open(path);
    expect(store.state().id).toBe(HOME_SCREEN_ID);
    const files = await readdir(join(root, "screens"));
    expect(files.some((name) => name.startsWith(`${HOME_SCREEN_ID}.loro.corrupt-`))).toBe(true);
  });

  it("refuses a newer screen version instead of guessing", async () => {
    const doc = new LoroDoc();
    const header = doc.getMap("screen");
    header.set("format", "suite.screen");
    header.set("version", 3);
    header.set("id", HOME_SCREEN_ID);
    header.set("name", HOME_SCREEN_NAME);
    doc.getList("order").push(DESK_APPS_WIDGET);
    doc.getMap("widgets").ensureMergeableMap(DESK_APPS_WIDGET).set("size", "full");
    doc.commit();
    await mkdir(join(root, "screens"), { recursive: true });
    await writeFile(path, doc.export({ mode: "snapshot" }));

    const store = await ScreenStore.open(path);
    expect(store.state()).toMatchObject({ id: HOME_SCREEN_ID, name: HOME_SCREEN_NAME });
    const files = await readdir(join(root, "screens"));
    expect(files.some((name) => name.startsWith(`${HOME_SCREEN_ID}.loro.corrupt-`))).toBe(true);
  });
});

describe("editing a Screen", () => {
  it("adds, moves, resizes and removes placements", async () => {
    const store = await ScreenStore.open(path);
    await expect(store.add({ registryId: "welcome.notes", size: "2x1" })).resolves.toBe(true);
    await expect(store.add({ registryId: "welcome.notes", size: "2x1" })).resolves.toBe(false);
    await store.add({ registryId: "scratch.board", size: "1x1" });

    expect(entryIds(store.state().widgets)).toEqual(["welcome.notes", "scratch.board"]);

    await expect(store.moveBy("scratch.board", "earlier")).resolves.toBe(true);
    expect(entryIds(store.state().widgets)).toEqual(["scratch.board", "welcome.notes"]);

    await expect(store.moveBy("missing.widget", "earlier")).resolves.toBe(false);
    await expect(store.moveBy("scratch.board", "later")).resolves.toBe(true);
    expect(entryId(store.state().widgets.at(-1))).toBe("scratch.board");

    await expect(store.resize("welcome.notes", "full")).resolves.toBe(true);
    expect(
      store
        .state()
        .widgets.find((entry) => !isScreenRow(entry) && entry.registryId === "welcome.notes")?.size,
    ).toBe("full");

    await expect(store.remove("scratch.board")).resolves.toBe(true);
    expect(entryIds(store.state().widgets)).toEqual(["welcome.notes"]);
  });

  it("moves a placement with the keyboard's earlier and later actions", async () => {
    const store = await ScreenStore.open(path);
    await store.add({ registryId: "welcome.notes", size: "2x1" });
    await store.add({ registryId: "scratch.board", size: "1x1" });

    await store.moveBy("welcome.notes", "later");
    expect(entryIds(store.state().widgets)).toEqual(["scratch.board", "welcome.notes"]);

    await store.moveBy("welcome.notes", "earlier");
    expect(entryIds(store.state().widgets)).toEqual(["welcome.notes", "scratch.board"]);
  });

  it("keeps an unknown widget and its unknown settings across a save", async () => {
    const store = await ScreenStore.open(path);
    await store.add({
      registryId: "ghost.notes",
      size: "2x1",
      settings: { project: "inbox" },
    });
    await store.moveBy("ghost.notes", "earlier");

    const reopened = await ScreenStore.open(path);
    expect(reopened.state().widgets[0]).toEqual({
      registryId: "ghost.notes",
      size: "2x1",
      settings: { project: "inbox" },
    });
  });
});

describe("the Screens set", () => {
  async function screenSet(): Promise<ScreenSet> {
    return ScreenSet.open({
      directory: join(root, "screens"),
      indexFile: join(root, SCREENS_INDEX_FILENAME),
    });
  }

  it("starts with Home and writes nothing until a Screen is created or edited", async () => {
    const set = await screenSet();

    expect(set.homeId).toBe(HOME_SCREEN_ID);
    expect(set.summaries()).toEqual([
      { id: HOME_SCREEN_ID, name: HOME_SCREEN_NAME, readable: true },
    ]);
    expect(existsSync(join(root, "screens", `${HOME_SCREEN_ID}.loro`))).toBe(false);
    expect(existsSync(join(root, SCREENS_INDEX_FILENAME))).toBe(false);
  });

  it("creates a blank Screen, renames and duplicates it", async () => {
    const set = await screenSet();
    const work = await set.create("Work");
    expect(set.screen(work)?.widgets).toEqual([]);

    await expect(set.rename(work, "Deep work")).resolves.toBe(true);
    expect(set.screen(work)?.name).toBe("Deep work");

    await set.store(work)?.add({ registryId: "welcome.notes", size: "2x1" });
    const copy = await set.duplicate(work);
    expect(copy).not.toBeNull();
    expect(set.screen(copy ?? "")?.name).toBe("Deep work copy");
    expect(set.screen(copy ?? "")?.widgets).toEqual([{ registryId: "welcome.notes", size: "2x1" }]);
    expect(
      set
        .summaries()
        .map((screen) => screen.id)
        .sort(),
    ).toEqual([HOME_SCREEN_ID, work, copy ?? ""].sort());
  });

  it("persists the Home role across a reopen", async () => {
    const set = await screenSet();
    const work = await set.create("Work");
    await expect(set.setHome(work)).resolves.toBe(true);

    const reopened = await screenSet();
    expect(reopened.homeId).toBe(work);
    expect(reopened.summaries()[0]?.id).toBe(work);
  });

  it("keeps the last Screen and asks for a replacement before deleting Home", async () => {
    const set = await screenSet();
    const kept = await set.remove(HOME_SCREEN_ID);
    expect(kept).toMatchObject({ ok: false, reason: "last" });

    const work = await set.create("Work");
    const refused = await set.remove(HOME_SCREEN_ID);
    expect(refused).toMatchObject({ ok: false, reason: "replacement" });
    if (!refused.ok) {
      expect(refused.choices.map((screen) => screen.id)).toEqual([work]);
    }

    const removed = await set.remove(HOME_SCREEN_ID, work);
    expect(removed).toEqual({ ok: true, homeId: work });
    expect(set.summaries().map((screen) => screen.id)).toEqual([work]);
    expect(existsSync(join(root, "screens", `${HOME_SCREEN_ID}.loro`))).toBe(false);
  });

  it("deletes a non-Home Screen without changing Home", async () => {
    const set = await screenSet();
    const work = await set.create("Work");
    const removed = await set.remove(work, null);
    expect(removed).toEqual({ ok: true, homeId: HOME_SCREEN_ID });
    expect(set.screen(work)).toBeNull();
  });

  it("writers never escape the screens directory or change another Screen", async () => {
    const set = await screenSet();
    const work = await set.create("Work");
    await set.store(work)?.add({ registryId: "welcome.notes", size: "2x1" });
    expect(set.screen(HOME_SCREEN_ID)?.widgets).toEqual([]);
  });
});

describe("the portable .screen file", () => {
  async function setAt(directory: string): Promise<ScreenSet> {
    return ScreenSet.open({
      directory: join(directory, "screens"),
      indexFile: join(directory, SCREENS_INDEX_FILENAME),
    });
  }

  function withHeaderVersion(bytes: Uint8Array, version: number): Uint8Array {
    const magicLength = 12;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const headerLength = view.getUint32(magicLength + 2);
    const headerStart = magicLength + 6;
    const headerEnd = headerStart + headerLength;
    const header = JSON.parse(
      new TextDecoder().decode(bytes.subarray(headerStart, headerEnd)),
    ) as Record<string, unknown>;
    header.version = version;
    const body = new TextEncoder().encode(JSON.stringify(header));
    const payload = bytes.subarray(headerEnd);
    const out = new Uint8Array(headerStart + body.byteLength + payload.byteLength);
    out.set(bytes.subarray(0, magicLength), 0);
    const next = new DataView(out.buffer);
    next.setUint16(magicLength, 1);
    next.setUint32(magicLength + 2, body.byteLength);
    out.set(body, headerStart);
    out.set(payload, headerStart + body.byteLength);
    return out;
  }

  it("restores order, size, settings, a row, an unknown widget and Home on a clean host", async () => {
    const source = await setAt(join(root, "source"));
    const work = await source.create("Work");
    const store = source.store(work);
    expect(store).not.toBeNull();
    if (store === null) return;

    await store.add({ registryId: "welcome.notes", size: "2x1", settings: { project: "inbox" } });
    await store.add({ registryId: "ghost.notes", size: "1x1", settings: { future: "kept" } });
    await store.addRow({
      kind: "row",
      size: "full",
      layout: "row",
      items: [
        { registryId: "planner.quick-task", weight: 2, settings: { project: "work" } },
        { registryId: "budget.saved-views", weight: 1 },
      ],
    });
    await source.setHome(work);

    const bytes = source.exportScreen(work);
    expect(bytes).not.toBeNull();
    if (bytes === null) return;

    const target = await setAt(join(root, "clean"));
    const imported = await target.importScreen(bytes);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;

    expect(imported.name).toBe("Work");
    expect(imported.home).toBe(true);
    expect(target.homeId).toBe(imported.id);
    expect(target.screen(imported.id)).toEqual(source.screen(work));
    expect(target.screen(imported.id)?.widgets).toHaveLength(3);
    expect(target.screen(imported.id)?.widgets[1]).toEqual({
      registryId: "ghost.notes",
      size: "1x1",
      settings: { future: "kept" },
    });
  });

  it("imports a colliding id as a new Screen and leaves the existing one alone", async () => {
    const target = await setAt(join(root, "collision"));
    const original = await target.create("Work");
    await target.store(original)?.add({ registryId: "welcome.notes", size: "2x1" });
    const before = target.screen(original);

    const source = await setAt(join(root, "collision-source"));
    const other = await source.create("Work");
    await source.store(other)?.add({ registryId: "ghost.notes", size: "1x1" });
    const bytes = source.exportScreen(other);
    expect(bytes).not.toBeNull();
    if (bytes === null) return;

    const imported = await target.importScreen(bytes);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.id).not.toBe(original);
    expect(target.screen(original)).toEqual(before);
    expect(target.screen(imported.id)?.widgets).toEqual([
      { registryId: "ghost.notes", size: "1x1" },
    ]);
  });

  it("refuses a newer version and leaves every Screen and Home untouched", async () => {
    const set = await setAt(join(root, "refusal"));
    const work = await set.create("Work");
    await set.store(work)?.add({ registryId: "welcome.notes", size: "2x1" });
    await set.setHome(work);

    const bytes = set.exportScreen(work);
    expect(bytes).not.toBeNull();
    if (bytes === null) return;

    const beforeSummaries = set.summaries();
    const beforeScreen = set.screen(work);
    const refused = await set.importScreen(withHeaderVersion(bytes, 99));
    expect(refused.ok).toBe(false);
    if (refused.ok) return;

    expect(refused.reason).toBe("newer");
    expect(refused.message).toContain("Update Suite Desk");
    expect(set.homeId).toBe(work);
    expect(set.summaries()).toEqual(beforeSummaries);
    expect(set.screen(work)).toEqual(beforeScreen);
  });

  it("refuses a malformed file and leaves the set untouched", async () => {
    const set = await setAt(join(root, "malformed"));
    const before = set.summaries();

    const refused = await set.importScreen(new Uint8Array([1, 2, 3]));
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.message).toContain("not a Suite screen file");
    expect(set.summaries()).toEqual(before);
  });
});
