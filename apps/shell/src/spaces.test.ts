import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpaceStore } from "./spaces.js";

let root: string;
let path: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "suite-shell-spaces-"));
  path = join(root, "spaces.loro");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("the space document", () => {
  it("starts empty", async () => {
    const store = await SpaceStore.open(path);
    expect(store.state()).toEqual({ tabs: [], activeTabId: null });
  });

  it("opens a tab and makes it active", async () => {
    const store = await SpaceStore.open(path);
    const tab = await store.openTab({
      packId: "welcome",
      title: "Welcome",
      entry: "index.html",
    });

    expect(store.state()).toEqual({
      tabs: [{ id: tab.id, packId: "welcome", title: "Welcome", entry: "index.html" }],
      activeTabId: tab.id,
    });
  });

  it("keeps multiple sessions of one pack", async () => {
    const store = await SpaceStore.open(path);
    const first = await store.openTab({
      packId: "welcome",
      title: "Welcome",
      entry: "index.html",
    });
    const second = await store.openTab({
      packId: "welcome",
      title: "Welcome",
      entry: "index.html",
    });

    expect(store.state().tabs.map((tab) => tab.id)).toEqual([first.id, second.id]);
    expect(store.state().activeTabId).toBe(second.id);
  });

  it("renames a tab without touching the others", async () => {
    const store = await SpaceStore.open(path);
    const first = await store.openTab({
      packId: "welcome",
      title: "Welcome",
      entry: "index.html",
    });
    await store.openTab({ packId: "scratch", title: "Scratch", entry: "index.html" });

    await store.setTitle(first.id, "Welcome — Notes");
    expect(store.state().tabs[0]?.title).toBe("Welcome — Notes");
  });

  it("closes the active tab and selects a neighbour", async () => {
    const store = await SpaceStore.open(path);
    const first = await store.openTab({
      packId: "welcome",
      title: "Welcome",
      entry: "index.html",
    });
    const second = await store.openTab({
      packId: "scratch",
      title: "Scratch",
      entry: "index.html",
    });

    await expect(store.closeTab(second.id)).resolves.toBe(first.id);
    expect(store.state().tabs.map((tab) => tab.id)).toEqual([first.id]);
    expect(store.state().activeTabId).toBe(first.id);
  });

  it("returns to the launcher when the last tab closes", async () => {
    const store = await SpaceStore.open(path);
    const tab = await store.openTab({
      packId: "welcome",
      title: "Welcome",
      entry: "index.html",
    });

    await expect(store.closeTab(tab.id)).resolves.toBeNull();
    expect(store.state()).toEqual({ tabs: [], activeTabId: null });
  });

  it("restores the same tabs after reopening the file", async () => {
    const first = await SpaceStore.open(path);
    const tab = await first.openTab({ packId: "welcome", title: "Welcome", entry: "index.html" });
    await first.setTitle(tab.id, "Restored");
    await first.flush();

    const second = await SpaceStore.open(path);
    expect(second.state()).toEqual({
      tabs: [{ id: tab.id, packId: "welcome", title: "Restored", entry: "index.html" }],
      activeTabId: tab.id,
    });
  });

  it("treats an unknown active tab as the launcher", async () => {
    const store = await SpaceStore.open(path);
    await store.activateTab("missing");
    expect(store.state().activeTabId).toBeNull();
  });

  it("treats activating the active tab as a no-op", async () => {
    const store = await SpaceStore.open(path);
    const tab = await store.openTab({
      packId: "welcome",
      title: "Welcome",
      entry: "index.html",
    });

    await store.activateTab(tab.id);
    expect(store.state().activeTabId).toBe(tab.id);
  });

  it("keeps an unreadable space document instead of deleting the only copy", async () => {
    await writeFile(path, "not a loro snapshot");
    const store = await SpaceStore.open(path);

    expect(store.state()).toEqual({ tabs: [], activeTabId: null });
    const files = await readdir(root);
    expect(files.some((name) => name.startsWith("spaces.loro.corrupt-"))).toBe(true);
  });

  it("refuses an oversized space document before reading it", async () => {
    await writeFile(path, Buffer.alloc(8 * 1024 * 1024 + 1));
    const store = await SpaceStore.open(path);

    expect(store.state()).toEqual({ tabs: [], activeTabId: null });
    const files = await readdir(root);
    expect(files.some((name) => name.startsWith("spaces.loro.corrupt-"))).toBe(true);
  });
});
