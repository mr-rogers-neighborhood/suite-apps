import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type AppPaths, legacyBudgetsDir } from "./budgetLocation";
import type { DocumentChannel } from "./channel";
import { adoptLegacyBudgets, createBudget, listEntries, openBudget, openFromPath } from "./library";

const cleanups: string[] = [];

async function sandbox(channel: DocumentChannel = "stable"): Promise<AppPaths> {
  const root = await mkdtemp(join(tmpdir(), "suite-budget-library-"));
  cleanups.push(root);
  const documents = join(root, "documents");
  const budgetsDir = channel === "slop" ? join(documents, "Suite Slop", "Budget") : documents;
  return {
    root,
    libraryFile: join(root, "library.json"),
    budgetsDir,
    backupsDir: join(budgetsDir, ".backups"),
    recoveredDir: join(root, "recovered"),
    channel,
  };
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function writeLibraryFile(paths: AppPaths, path: string): Promise<void> {
  const entry = {
    id: "b1",
    name: "Legacy budget",
    path,
    currency: "USD",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastOpenedAt: "2026-01-01T00:00:00.000Z",
  };
  await writeFile(paths.libraryFile, JSON.stringify({ version: 1, entries: [entry] }), "utf8");
}

describe("adoptLegacyBudgets", () => {
  it("should copy budgets into the folder and rewrite their stored paths", async () => {
    const paths = await sandbox();
    const legacy = legacyBudgetsDir(paths);
    await mkdir(legacy, { recursive: true });
    await writeFile(join(legacy, "b1.budget"), "budget bytes", "utf8");
    await writeLibraryFile(paths, join(legacy, "b1.budget"));

    expect(await adoptLegacyBudgets(paths)).toBe(1);

    expect(await readFile(join(paths.budgetsDir, "b1.budget"), "utf8")).toBe("budget bytes");
    // The original stays: a migration that deletes the only copy is how records disappear.
    expect((await stat(join(legacy, "b1.budget"))).isFile()).toBe(true);

    const entries = await listEntries(paths);
    expect(entries[0]?.path).toBe(join(paths.budgetsDir, "b1.budget"));
  });

  it("should be idempotent, and leave a budget already in the folder alone", async () => {
    const paths = await sandbox();
    const legacy = legacyBudgetsDir(paths);
    await mkdir(legacy, { recursive: true });
    await writeFile(join(legacy, "b1.budget"), "old", "utf8");
    await mkdir(paths.budgetsDir, { recursive: true });
    await writeFile(join(paths.budgetsDir, "b1.budget"), "current", "utf8");
    await writeLibraryFile(paths, join(legacy, "b1.budget"));

    expect(await adoptLegacyBudgets(paths)).toBe(0);
    expect(await adoptLegacyBudgets(paths)).toBe(0);
    expect(await readFile(join(paths.budgetsDir, "b1.budget"), "utf8")).toBe("current");
    // The path is still rewritten, because the file it names now lives in the folder.
    expect((await listEntries(paths))[0]?.path).toBe(join(paths.budgetsDir, "b1.budget"));
  });

  it("should do nothing when there is no legacy folder", async () => {
    const paths = await sandbox();
    expect(await adoptLegacyBudgets(paths)).toBe(0);
    expect(await readdir(paths.root)).toEqual([]);
  });
});

describe("openFromPath", () => {
  it("should open a budget that is already in the folder without importing a copy", async () => {
    const paths = await sandbox();
    const created = await createBudget(paths, {
      name: "Household",
      currency: "USD",
      template: "blank",
    });

    const opened = await openFromPath(paths, created.entry.path);

    expect(opened.entry.id).toBe(created.entry.id);
    expect(await listEntries(paths)).toHaveLength(1);
  });

  it("should import a budget handed over from somewhere else", async () => {
    const paths = await sandbox();
    const created = await createBudget(paths, {
      name: "Household",
      currency: "USD",
      template: "blank",
    });

    const elsewhere = join(paths.root, "elsewhere.budget");
    await writeFile(elsewhere, await readFile(created.entry.path, "utf8"), "utf8");

    const opened = await openFromPath(paths, elsewhere);

    expect(opened.entry.path.startsWith(`${paths.budgetsDir}/`)).toBe(true);
    const budgets = (await readdir(paths.budgetsDir)).filter((name) => name.endsWith(".budget"));
    expect(budgets).toHaveLength(2);
  });
});

describe("pre-release isolation", () => {
  it("should create a new budget in the pre-release folder", async () => {
    const slop = await sandbox("slop");

    const created = await createBudget(slop, {
      name: "Household",
      currency: "USD",
      template: "blank",
    });

    expect(created.entry.path).toBe(join(slop.budgetsDir, `${created.entry.id}.budget`));
    expect((await stat(created.entry.path)).isFile()).toBe(true);
  });

  it("should copy a stable budget before opening it and leave the original alone", async () => {
    const stable = await sandbox("stable");
    const created = await createBudget(stable, {
      name: "Household",
      currency: "USD",
      template: "blank",
    });
    const original = await readFile(created.entry.path, "utf8");
    const before = await stat(created.entry.path);

    const slop = await sandbox("slop");
    const opened = await openFromPath(slop, created.entry.path);

    expect(opened.entry.path).toBe(join(slop.budgetsDir, `${created.entry.id}.budget`));
    expect(opened.entry.path.startsWith(`${slop.budgetsDir}/`)).toBe(true);
    // Bytes and mtime together: opening a copy may not reach the stable file.
    expect(await readFile(created.entry.path, "utf8")).toBe(original);
    expect((await stat(created.entry.path)).mtimeMs).toBe(before.mtimeMs);

    // The second open finds the copy by its document id instead of leaving two budgets.
    const again = await openFromPath(slop, created.entry.path);
    expect(again.entry.id).toBe(opened.entry.id);
    expect(await listEntries(slop)).toHaveLength(1);
  });

  it("should adopt a library entry whose stored path is still a stable file", async () => {
    const stable = await sandbox("stable");
    const created = await createBudget(stable, {
      name: "Household",
      currency: "USD",
      template: "blank",
    });
    const original = await readFile(created.entry.path, "utf8");

    const slop = await sandbox("slop");
    await writeFile(
      slop.libraryFile,
      JSON.stringify({ version: 1, entries: [{ ...created.entry }] }),
      "utf8",
    );

    const opened = await openBudget(slop, created.entry.id);

    expect(opened.entry.path).toBe(join(slop.budgetsDir, `${created.entry.id}.budget`));
    expect(await readFile(created.entry.path, "utf8")).toBe(original);
  });
});
