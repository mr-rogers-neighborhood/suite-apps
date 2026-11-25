import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BudgetDocument, encodeBudgetFile, type LibraryEntry } from "@suite/budget-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppPaths } from "./budgetLocation";
import { BudgetStore } from "./budgetStore";

const NOW = new Date("2026-01-01T12:00:00.000Z");
const cleanups: string[] = [];

async function sandbox(): Promise<AppPaths> {
  const root = await mkdtemp(join(tmpdir(), "suite-budget-store-"));
  cleanups.push(root);
  const budgetsDir = join(root, "documents");
  return {
    root,
    libraryFile: join(root, "library.json"),
    budgetsDir,
    backupsDir: join(budgetsDir, ".backups"),
    recoveredDir: join(root, "recovered"),
    channel: "stable",
  };
}

function entryFor(path: string): LibraryEntry {
  return {
    id: "b1",
    name: "Sample",
    path,
    currency: "USD",
    createdAt: NOW.toISOString(),
    lastOpenedAt: NOW.toISOString(),
  };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("BudgetStore", () => {
  it("should write the same document state to the same bytes on every save", async () => {
    const paths = await sandbox();
    const entry = entryFor(join(paths.budgetsDir, "b1.budget"));
    const doc = BudgetDocument.create({ name: "Sample", currency: "USD", now: NOW });
    vi.useFakeTimers({ now: NOW });

    const store = BudgetStore.fromDocument(paths, entry, doc);
    const expected = encodeBudgetFile(doc, NOW);

    await store.flush();
    const first = await readFile(entry.path, "utf8");
    await store.flush();
    const second = await readFile(entry.path, "utf8");

    expect(first).toBe(expected);
    expect(second).toBe(first);
    expect(store.saveError).toBeNull();
  });

  it("should keep the previous file and a daily backup before writing the rename", async () => {
    const paths = await sandbox();
    const entry = entryFor(join(paths.budgetsDir, "b1.budget"));
    const doc = BudgetDocument.create({ name: "Sample", currency: "USD", now: NOW });
    vi.useFakeTimers({ now: NOW });

    const store = BudgetStore.fromDocument(paths, entry, doc);
    const first = encodeBudgetFile(doc, NOW);
    await store.flush();

    doc.rename("Renamed");
    const renamed = encodeBudgetFile(doc, NOW);
    await store.flush();

    const backupDir = join(paths.backupsDir, "b1");
    expect(await readFile(entry.path, "utf8")).toBe(renamed);
    expect(await readFile(join(backupDir, "previous.budget"), "utf8")).toBe(first);
    expect(await readFile(join(backupDir, "2026-01-01.budget"), "utf8")).toBe(first);
  });
});
