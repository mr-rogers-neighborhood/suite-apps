import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Screen, ScreenDocument } from "@suite/screens";
import { afterEach, describe, expect, it } from "vitest";
import {
  isScreenId,
  SCREENS_INDEX_FILENAME,
  ScreenStore,
  type ScreenStoreOptions,
  screenIdFor,
  screenName,
} from "./screenStore.js";

/**
 * The Home Screen file.
 *
 * Each test is a state a real machine can be in: a first launch, the old dashboard, a
 * corrupt or newer file, an unknown widget, a Screen deleted while Home. The rule under
 * all of them is that Start shows something true, says what it could not honour, and
 * never deletes the only copy of a person's layout.
 */

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

interface Workspace {
  readonly root: string;
  readonly options: ScreenStoreOptions;
}

async function workspace(): Promise<Workspace> {
  const root = await mkdtemp(join(tmpdir(), "suite-start-screens-"));
  cleanups.push(root);
  return {
    root,
    options: {
      directory: join(root, "screens"),
      indexFile: join(root, SCREENS_INDEX_FILENAME),
      dashboardFile: join(root, "dashboard.json"),
      now: () => new Date("2026-11-22T10:00:00.000Z"),
    },
  };
}

const storeAt = (options: ScreenStoreOptions) => ScreenStore.at(options);

const dashboard = {
  format: "suite.start.dashboard",
  version: 1,
  widgets: [
    { id: "start.apps", size: "full" },
    { id: "start.recents", size: "2x1" },
    { id: "planner.quick-task", size: "1x1" },
  ],
};

async function writeDashboard(options: ScreenStoreOptions, value: unknown): Promise<string> {
  const text = JSON.stringify(value, null, 2);
  await writeFile(options.dashboardFile, text);
  return text;
}

async function home(options: ScreenStoreOptions) {
  const store = storeAt(options);
  const load = await store.load();
  const screen = await store.open(load.homeId);
  if (screen === null) throw new Error("no Home Screen");
  return { store, load, screen };
}

describe("the first launch", () => {
  it("writes the default Home as a Screen document", async () => {
    const { options, root } = await workspace();
    const { store, load, screen } = await home(options);

    expect(load).toEqual({ homeId: "start-home", note: null });
    expect(screen.widgets).toEqual([{ registryId: "start.apps", size: "full" }]);
    expect(await readFile(join(root, "screens", "start-home.loro"))).toBeInstanceOf(Buffer);
    expect(JSON.parse(await readFile(options.indexFile, "utf8"))).toEqual({
      format: "suite.start.screens",
      version: 1,
      homeId: "start-home",
    });
    expect(await store.summaries()).toEqual([{ id: "start-home", name: "Home", readable: true }]);
  });

  it("opens the Screen document on later launches", async () => {
    const { options } = await workspace();
    await home(options);
    expect(await home(options)).toMatchObject({ load: { homeId: "start-home", note: null } });
  });
});

describe("migrating the old dashboard", () => {
  it("copies every entry in order, including an id this build cannot resolve", async () => {
    const { options, root } = await workspace();
    const text = await writeDashboard(options, dashboard);

    const { store, load, screen } = await home(options);

    expect(load.note).toBeNull();
    expect(screen.widgets).toEqual([
      { registryId: "start.apps", size: "full" },
      { registryId: "start.recents", size: "2x1" },
      { registryId: "planner.quick-task", size: "1x1" },
    ]);
    // The old layout is kept beside itself, under a dated name.
    const backup = join(root, "dashboard.json.migrated-2026-11-22");
    expect(await readFile(backup, "utf8")).toBe(text);
    await expect(readFile(options.dashboardFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await store.open("start-home")).not.toBeNull();
  });

  it("writes the migration backup exactly once", async () => {
    const { options, root } = await workspace();
    await writeDashboard(options, dashboard);
    await home(options);
    await home(options);
    await home(options);

    const backups = (await readdir(root)).filter((name) =>
      name.startsWith("dashboard.json.migrated-"),
    );
    expect(backups).toEqual(["dashboard.json.migrated-2026-11-22"]);
  });

  it("refuses a corrupt dashboard whole and leaves it untouched", async () => {
    const { options, root } = await workspace();
    await writeFile(options.dashboardFile, "{not json");

    const { load, screen } = await home(options);

    expect(load.note).toContain("could not read your dashboard");
    expect(await readFile(options.dashboardFile, "utf8")).toBe("{not json");
    expect(screen.widgets).toEqual([{ registryId: "start.apps", size: "full" }]);
    expect(
      (await readdir(root)).filter((name) => name.startsWith("dashboard.json.migrated-")),
    ).toEqual([]);
  });

  it("refuses a dashboard written by a newer Start", async () => {
    const { options } = await workspace();
    const text = await writeDashboard(options, { ...dashboard, version: 2 });

    const { load } = await home(options);

    expect(load.note).toContain("newer Start");
    expect(await readFile(options.dashboardFile, "utf8")).toBe(text);
  });

  it("refuses an empty dashboard rather than writing an empty Home", async () => {
    const { options } = await workspace();
    await writeDashboard(options, { ...dashboard, widgets: [] });

    const { load, screen } = await home(options);

    expect(load.note).toContain("no widget");
    expect(screen.widgets).toEqual([{ registryId: "start.apps", size: "full" }]);
  });
});

describe("a Screen this build cannot read", () => {
  it("quarantines corrupt bytes and shows the default Home with the sentence", async () => {
    const { options, root } = await workspace();
    const folder = join(root, "screens");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "start-home.loro"), new Uint8Array([1, 2, 3]));

    const { load, screen } = await home(options);

    expect(load.note).not.toBeNull();
    expect(screen.widgets).toEqual([{ registryId: "start.apps", size: "full" }]);
    expect(
      (await readdir(folder)).filter((name) => name.includes(".corrupt-2026-11-22T10-00-00-000Z")),
    ).toHaveLength(1);
  });

  it("quarantines a snapshot written by a newer Suite", async () => {
    const { options, root } = await workspace();
    const folder = join(root, "screens");
    await mkdir(folder, { recursive: true });
    const newer = {
      format: "suite.screen",
      version: 2,
      id: "start-home",
      name: "Home",
      widgets: [{ registryId: "start.apps", size: "full" }],
    } as unknown as Screen;
    await writeFile(join(folder, "start-home.loro"), ScreenDocument.create(newer).export());

    const { load } = await home(options);

    expect(load.note).toContain("newer Suite");
    expect((await readdir(folder)).some((name) => name.includes(".corrupt-"))).toBe(true);
  });
});

describe("order, size and settings", () => {
  it("persists every edit across a reopen", async () => {
    const { options } = await workspace();
    const { store } = await home(options);

    expect(await store.addWidget("start-home", { registryId: "start.recents", size: "2x1" })).toBe(
      true,
    );
    expect(
      await store.addWidget("start-home", {
        registryId: "planner.quick-task",
        size: "1x1",
        settings: { project: "inbox" },
      }),
    ).toBe(true);
    expect(await store.moveWidget("start-home", "planner.quick-task", "earlier")).toBe(true);
    expect(await store.resizeWidget("start-home", "start.apps", "2x1")).toBe(true);
    expect(
      await store.setWidgetSetting("start-home", "planner.quick-task", "project", "work"),
    ).toBe(true);

    const reopened = await storeAt(options).open("start-home");
    expect(reopened?.widgets).toEqual([
      { registryId: "start.apps", size: "2x1" },
      { registryId: "planner.quick-task", size: "1x1", settings: { project: "work" } },
      { registryId: "start.recents", size: "2x1" },
    ]);
  });

  it("keeps an unknown widget and its unknown settings through an edit", async () => {
    const { options } = await workspace();
    const { store } = await home(options);
    await store.addWidget("start-home", {
      registryId: "future.unknown-widget",
      size: "1x1",
      settings: { "future-setting": "kept" },
    });
    await store.resizeWidget("start-home", "start.apps", "full");

    const reopened = await storeAt(options).open("start-home");
    expect(reopened?.widgets.at(-1)).toEqual({
      registryId: "future.unknown-widget",
      size: "1x1",
      settings: { "future-setting": "kept" },
    });
  });

  it("keeps a backup of the previous Screen when it is written again", async () => {
    const { options, root } = await workspace();
    const { store } = await home(options);
    await store.resizeWidget("start-home", "start.apps", "2x1");
    await store.resizeWidget("start-home", "start.apps", "full");

    const backup = join(root, "screens", "start-home.loro.bak");
    const previous = ScreenDocument.open(new Uint8Array(await readFile(backup)));
    expect(previous.ok).toBe(true);
    if (previous.ok) expect(previous.document.state().widgets[0]?.size).toBe("2x1");
  });
});

describe("inline edits", () => {
  it("adds, refuses a duplicate, moves and removes", async () => {
    const { options } = await workspace();
    const { store } = await home(options);

    expect(await store.addWidget("start-home", { registryId: "start.recents", size: "2x1" })).toBe(
      true,
    );
    expect(await store.addWidget("start-home", { registryId: "start.recents", size: "1x1" })).toBe(
      false,
    );
    expect(await store.moveWidget("start-home", "start.apps", "earlier")).toBe(false);
    expect(await store.moveWidget("start-home", "start.recents", "later")).toBe(false);
    expect(await store.moveWidget("start-home", "start.recents", "earlier")).toBe(true);

    const moved = await store.open("start-home");
    expect(moved?.widgets.map((widget) => widget.registryId)).toEqual([
      "start.recents",
      "start.apps",
    ]);

    expect(await store.removeWidget("start-home", "start.recents")).toBe(true);
    const removed = await store.open("start-home");
    expect(removed?.widgets.map((widget) => widget.registryId)).toEqual(["start.apps"]);
    expect(await store.removeWidget("start-home", "start.recents")).toBe(false);
  });

  it("resizes to a size class and clears a setting with an empty value", async () => {
    const { options } = await workspace();
    const { store } = await home(options);
    await store.addWidget("start-home", {
      registryId: "planner.quick-task",
      size: "1x1",
      settings: { project: "inbox" },
    });

    expect(await store.resizeWidget("start-home", "planner.quick-task", "full")).toBe(true);
    expect(await store.setWidgetSetting("start-home", "planner.quick-task", "project", "")).toBe(
      true,
    );

    const screen = await store.open("start-home");
    expect(screen?.widgets[1]).toEqual({ registryId: "planner.quick-task", size: "full" });
    expect(await store.resizeWidget("start-home", "nothing.here", "full")).toBe(false);
  });
});

describe("the Screens manager", () => {
  it("creates, renames, duplicates, sets Home and opens", async () => {
    const { options } = await workspace();
    const { store } = await home(options);

    const created = await store.create("Work");
    expect(created).toBe("work");
    expect((await store.summaries()).map((screen) => screen.name)).toEqual(["Home", "Work"]);

    expect(await store.rename("work", "Deep work")).toBe(true);
    expect((await store.open("work"))?.name).toBe("Deep work");

    const copy = await store.duplicate("work");
    expect(copy).toBe("deep-work-copy");
    expect((await store.open(copy ?? ""))?.widgets).toEqual([]);

    expect(await store.setHome("work")).toBe(true);
    expect((await storeAt(options).load()).homeId).toBe("work");
    expect(await store.setHome("nothing.here")).toBe(false);
  });

  it("refuses to delete the last Screen", async () => {
    const { options, root } = await workspace();
    const { store } = await home(options);

    const removal = await store.remove("start-home");
    expect(removal).toMatchObject({ ok: false, reason: "last" });
    expect(await readdir(join(root, "screens"))).toContain("start-home.loro");
  });

  it("asks for a replacement before deleting Home, then deletes it", async () => {
    const { options, root } = await workspace();
    const { store } = await home(options);
    await store.create("Work");

    const refused = await store.remove("start-home");
    expect(refused).toMatchObject({ ok: false, reason: "replacement" });
    if (!refused.ok) expect(refused.choices.map((screen) => screen.id)).toEqual(["work"]);

    const removed = await store.remove("start-home", "work");
    expect(removed).toEqual({ ok: true, homeId: "work" });
    expect(await readdir(join(root, "screens"))).not.toContain("start-home.loro");
    expect((await storeAt(options).load()).homeId).toBe("work");
  });
});

describe("screen ids and names", () => {
  it("derives a kebab-case id and makes it unique", () => {
    expect(screenIdFor("Deep Work", new Set())).toBe("deep-work");
    expect(screenIdFor("Deep Work", new Set(["deep-work"]))).toBe("deep-work-2");
    expect(screenIdFor("  ", new Set())).toBe("screen");
    expect(isScreenId(screenIdFor("...", new Set()))).toBe(true);
  });

  it("trims a name and never stores an empty one", () => {
    expect(screenName("  Deep   work  ")).toBe("Deep work");
    expect(screenName("   ")).toBe("Untitled Screen");
    expect(screenName("x".repeat(200))).toHaveLength(120);
  });
});
