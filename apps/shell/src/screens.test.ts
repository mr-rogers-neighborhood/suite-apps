import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoroDoc } from "loro-crdt";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HOME_SCREEN_ID, HOME_SCREEN_NAME, SHELL_APPS_WIDGET } from "./home.js";
import { ScreenStore } from "./screens.js";

let root: string;
let path: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "suite-shell-screens-"));
  path = join(root, "screens", `${HOME_SCREEN_ID}.loro`);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("the Home screen", () => {
  it("starts as Home with the host app grid", async () => {
    const store = await ScreenStore.open(path);

    expect(store.state()).toEqual({
      format: "suite.screen",
      version: 1,
      id: HOME_SCREEN_ID,
      name: HOME_SCREEN_NAME,
      widgets: [{ registryId: SHELL_APPS_WIDGET, size: "full" }],
    });
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
    expect(second.state().widgets).toEqual([
      { registryId: SHELL_APPS_WIDGET, size: "full" },
      { registryId: "welcome.notes", size: "1x1" },
    ]);
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
    header.set("version", 2);
    header.set("id", HOME_SCREEN_ID);
    header.set("name", HOME_SCREEN_NAME);
    doc.getList("order").push(SHELL_APPS_WIDGET);
    doc.getMap("widgets").ensureMergeableMap(SHELL_APPS_WIDGET).set("size", "full");
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

    expect(store.state().widgets.map((widget) => widget.registryId)).toEqual([
      SHELL_APPS_WIDGET,
      "welcome.notes",
      "scratch.board",
    ]);

    await expect(store.moveBy("scratch.board", "earlier")).resolves.toBe(true);
    expect(store.state().widgets.map((widget) => widget.registryId)).toEqual([
      SHELL_APPS_WIDGET,
      "scratch.board",
      "welcome.notes",
    ]);

    await expect(store.moveBy(SHELL_APPS_WIDGET, "earlier")).resolves.toBe(false);
    await expect(store.moveBy("scratch.board", "later")).resolves.toBe(true);
    expect(store.state().widgets.at(-1)?.registryId).toBe("scratch.board");

    await expect(store.resize("welcome.notes", "full")).resolves.toBe(true);
    expect(store.state().widgets.find((w) => w.registryId === "welcome.notes")?.size).toBe("full");

    await expect(store.remove("scratch.board")).resolves.toBe(true);
    expect(store.state().widgets.map((widget) => widget.registryId)).toEqual([
      SHELL_APPS_WIDGET,
      "welcome.notes",
    ]);
  });

  it("moves a placement with the keyboard's earlier and later actions", async () => {
    const store = await ScreenStore.open(path);
    await store.add({ registryId: "welcome.notes", size: "2x1" });
    await store.add({ registryId: "scratch.board", size: "1x1" });

    await store.moveBy("welcome.notes", "later");
    expect(store.state().widgets.map((widget) => widget.registryId)).toEqual([
      SHELL_APPS_WIDGET,
      "scratch.board",
      "welcome.notes",
    ]);

    await store.moveBy("welcome.notes", "earlier");
    expect(store.state().widgets.map((widget) => widget.registryId)).toEqual([
      SHELL_APPS_WIDGET,
      "welcome.notes",
      "scratch.board",
    ]);
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
