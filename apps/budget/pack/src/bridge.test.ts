import {
  BudgetDocument,
  type CreateBudgetInput,
  decodeBudgetFile,
  encodeRecords,
} from "@suite/budget-core";
import { afterEach, describe, expect, it } from "vitest";
import { type BudgetPack, type BudgetPackHost, createBudgetPack } from "./bridge";
import {
  type MemoryDocuments,
  type MemoryFiles,
  memoryDocuments,
  memoryFiles,
  textOf,
} from "./test/fakeHost";

const baseInput: CreateBudgetInput = {
  name: "Household",
  currency: "USD",
  template: "blank",
};

function fixedClock(): Date {
  return new Date("2026-02-03T04:05:06.000Z");
}

function setup(host: Partial<BudgetPackHost> = {}): {
  pack: BudgetPack;
  documents: MemoryDocuments;
  files: MemoryFiles;
} {
  const documents = memoryDocuments();
  const files = memoryFiles();
  const pack = createBudgetPack({
    host: {
      documents,
      files,
      info: async () => ({ platform: "linux" }),
      ...host,
    },
    now: fixedClock,
  });
  return { pack, documents, files };
}

/** A real CRDT update, made by Budget's own document layer from the open state. */
function updateChangingCurrency(snapshot: Uint8Array, currency: string): Uint8Array {
  const source = BudgetDocument.fromSnapshot(snapshot);
  source.updateSettings({ currency });
  return source.loro.export({ mode: "update" });
}

let active: BudgetPack | null = null;

afterEach(() => {
  active?.dispose();
  active = null;
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
});

describe("the budget library", () => {
  it("creates a schema-initialised snapshot and lists every entry field", async () => {
    const { pack, documents } = setup();
    active = pack;

    const opened = await pack.bridge.createBudget(baseInput);
    const stored = documents.files.get(opened.entry.id);
    expect(stored).toBeDefined();
    expect(stored?.byteLength).toBeGreaterThan(0);

    const document = BudgetDocument.fromSnapshot(stored as Uint8Array);
    expect(document.getMeta().name).toBe("Household");
    expect(document.getSettings().currency).toBe("USD");
    expect(document.listCategoryGroups()).toEqual([]);

    const entries = await pack.bridge.listBudgets();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: opened.entry.id,
      name: "Household",
      path: opened.entry.id,
      currency: "USD",
      createdAt: "2026-02-03T04:05:06.000Z",
    });
    expect(Number.isNaN(Date.parse(entries[0]?.lastOpenedAt ?? ""))).toBe(false);
    // The launcher's recency comes from the host's own summary.
    expect(entries[0]?.lastOpenedAt).toBe(new Date(1_002).toISOString());
  });

  it("creates a starter template and starting account when asked", async () => {
    const { pack } = setup();
    active = pack;

    const opened = await pack.bridge.createBudget({
      ...baseInput,
      template: "essentials",
      startingAccount: {
        name: "Checking",
        type: "checking",
        startingBalanceMinor: 25_000,
      },
    });

    const document = BudgetDocument.fromSnapshot(opened.snapshot);
    expect(document.listCategoryGroups().length).toBeGreaterThan(0);
    expect(document.listAccounts()).toHaveLength(1);
    expect(document.listAccounts()[0]?.name).toBe("Checking");
  });

  it("opens, closes and reopens a stored budget without losing its name", async () => {
    const { pack, documents } = setup();
    active = pack;

    const first = await pack.bridge.createBudget({ ...baseInput, name: "First" });
    await pack.bridge.createBudget({ ...baseInput, name: "Second" });
    await pack.bridge.closeBudget();

    const reopened = await pack.bridge.openBudget(first.entry.id);
    expect(reopened.entry.name).toBe("First");
    expect(BudgetDocument.fromSnapshot(reopened.snapshot).getMeta().name).toBe("First");
    expect(pack.documentId()).toBe(first.entry.id);
    // Opening writes the touch so the launcher's recency moves.
    expect(documents.saves.some((save) => save.id === first.entry.id)).toBe(true);
  });

  it("renames the document and refuses to remove the one that is open", async () => {
    const { pack } = setup();
    active = pack;

    const first = await pack.bridge.createBudget({ ...baseInput, name: "Old name" });
    const renamed = await pack.bridge.renameBudget(first.entry.id, "  New name  ");
    expect(renamed.name).toBe("New name");

    const entries = await pack.bridge.listBudgets();
    expect(entries[0]?.name).toBe("New name");

    await expect(pack.bridge.removeBudget(first.entry.id)).rejects.toThrow(
      /Close the budget before removing it/u,
    );
    await pack.bridge.closeBudget();

    const second = await pack.bridge.createBudget({ ...baseInput, name: "Other" });
    await pack.bridge.removeBudget(first.entry.id);
    await expect(pack.bridge.openBudget(first.entry.id)).rejects.toThrow(/no longer/u);
    expect((await pack.bridge.listBudgets()).map((entry) => entry.id)).toEqual([second.entry.id]);
  });

  it("keeps one unreadable document from blanking the rest of the library", async () => {
    const { pack, documents } = setup();
    active = pack;

    const good = await pack.bridge.createBudget(baseInput);
    documents.files.set("empty.budget", new Uint8Array());
    documents.files.set("broken.budget", new Uint8Array([1, 2, 3]));

    const entries = await pack.bridge.listBudgets();
    expect(entries.map((entry) => entry.id)).toEqual([good.entry.id]);
    expect(pack.notices().join(" ")).toMatch(/left out of the library/u);
  });
});

describe("snapshots and durability", () => {
  it("loads the open snapshot, applies an update and writes only at a boundary", async () => {
    const { pack, documents } = setup();
    active = pack;

    await pack.bridge.createBudget(baseInput);
    const update = updateChangingCurrency(await pack.bridge.loadSnapshot(), "EUR");

    await pack.bridge.commit(update);
    const inMemory = BudgetDocument.fromSnapshot(await pack.bridge.loadSnapshot());
    expect(inMemory.getSettings().currency).toBe("EUR");

    // A commit is not a save: the file still holds the currency created with.
    const stored = documents.files.get(pack.documentId() as string) as Uint8Array;
    expect(BudgetDocument.fromSnapshot(stored).getSettings().currency).toBe("USD");
    const savesBefore = documents.saves.length;

    await pack.flush();
    expect(documents.saves.length).toBe(savesBefore + 1);
    const flushed = documents.files.get(pack.documentId() as string) as Uint8Array;
    expect(BudgetDocument.fromSnapshot(flushed).getSettings().currency).toBe("EUR");
  });

  it("persists at pagehide and visibility boundaries", async () => {
    const { pack, documents } = setup();
    active = pack;
    await pack.bridge.createBudget(baseInput);

    await pack.bridge.commit(updateChangingCurrency(await pack.bridge.loadSnapshot(), "CAD"));
    const beforeHide = documents.saves.length;
    window.dispatchEvent(new Event("pagehide"));
    await pack.settled();
    expect(documents.saves.length).toBe(beforeHide + 1);

    await pack.bridge.commit(updateChangingCurrency(await pack.bridge.loadSnapshot(), "GBP"));
    const beforeVisibility = documents.saves.length;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await pack.settled();
    expect(documents.saves.length).toBe(beforeVisibility + 1);

    const stored = documents.files.get(pack.documentId() as string) as Uint8Array;
    expect(BudgetDocument.fromSnapshot(stored).getSettings().currency).toBe("GBP");
  });

  it("reports a failed save through info and retries at the next boundary", async () => {
    const { pack, documents } = setup();
    active = pack;
    await pack.bridge.createBudget(baseInput);
    await pack.bridge.commit(updateChangingCurrency(await pack.bridge.loadSnapshot(), "JPY"));

    const original = documents.save.bind(documents);
    let failures = 1;
    documents.save = async (id, bytes) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error("disk is full");
      }
      return original(id, bytes);
    };

    await expect(pack.flush()).rejects.toThrow(/disk is full/u);
    expect((await pack.bridge.info()).saveError).toMatch(/disk is full/u);

    await pack.flush();
    expect((await pack.bridge.info()).saveError).toBeNull();
  });
});

describe("external files", () => {
  it("exports a .budget through pickSave and imports it as a new document", async () => {
    const { pack, documents, files } = setup();
    active = pack;

    const created = await pack.bridge.createBudget({ ...baseInput, name: "Carry me" });
    const replaced: Uint8Array[] = [];
    const openedNames: string[] = [];
    pack.bridge.onBudgetReplaced((snapshot) => replaced.push(snapshot));
    pack.bridge.onBudgetOpened((info) => openedNames.push(info.entry.name));

    const exported = await pack.bridge.exportBudget();
    expect(exported.canceled).toBe(false);
    expect(exported.path).toMatch(/^Carry-me-\d{4}-\d{2}-\d{2}\.budget$/u);
    const written = files.saved.at(-1);
    expect(written).toBeDefined();
    expect(written?.closed).toBe(true);
    expect(decodeBudgetFile(textOf(written?.bytes as Uint8Array)).isOk()).toBe(true);

    files.openQueue.push(written?.bytes as Uint8Array);
    const imported = await pack.bridge.importBudget();
    expect(imported.canceled).toBe(false);
    expect(imported.opened?.entry.name).toBe("Carry me");
    expect(imported.opened?.entry.id).not.toBe(created.entry.id);
    expect(documents.files.size).toBe(2);
    expect(replaced).toHaveLength(1);
    expect(openedNames).toEqual(["Carry me"]);
  });

  it("treats a cancelled save and a cancelled open as values", async () => {
    const { pack, files } = setup();
    active = pack;
    await pack.bridge.createBudget(baseInput);

    files.cancelSave = true;
    expect((await pack.bridge.exportBudget()).canceled).toBe(true);
    expect(files.saved).toHaveLength(0);

    // An empty queue is the picker's cancellation.
    expect((await pack.bridge.importBudget()).canceled).toBe(true);
    expect((await pack.bridge.openBudgetFile()).canceled).toBe(true);
    expect((await pack.bridge.readImportSource()).canceled).toBe(true);
  });

  it("imports a records export and returns its text for CSV and QIF sources", async () => {
    const { pack, files } = setup();
    active = pack;
    const created = await pack.bridge.createBudget(baseInput);
    const snapshot = BudgetDocument.fromSnapshot(await pack.bridge.loadSnapshot()).getSnapshot();

    files.openQueue.push(new TextEncoder().encode(encodeRecords(snapshot)));
    const imported = await pack.bridge.importBudget();
    expect(imported.canceled).toBe(false);
    expect(imported.opened?.entry.name).toBe("Household");
    expect(imported.opened?.entry.id).not.toBe(created.entry.id);

    files.openQueue.push(new TextEncoder().encode("Date,Amount\n2026-01-01,10.00\n"));
    const source = await pack.bridge.readImportSource();
    expect(source.canceled).toBe(false);
    expect(source.name).toBe("picker-input");
    expect(source.text).toContain("Date,Amount");
  });

  it("writes JSON, CSV and QIF records through pickSave", async () => {
    const { pack, files } = setup();
    active = pack;
    await pack.bridge.createBudget(baseInput);

    for (const format of ["json", "csv", "qif"] as const) {
      const result = await pack.bridge.exportRecords(format);
      expect(result.canceled).toBe(false);
      expect(result.path).toMatch(new RegExp(`-transactions\\.${format}$`, "u"));
    }

    expect(textOf(files.saved[0]?.bytes as Uint8Array)).toContain(
      '"format": "suite.budget.records"',
    );
    expect(textOf(files.saved[1]?.bytes as Uint8Array)).toContain("Date,Account,Payee");
    expect(textOf(files.saved[2]?.bytes as Uint8Array)).toContain("!Type:Bank");
  });

  it("turns an absent files service into sentences, not exceptions", async () => {
    const pack = createBudgetPack({
      host: { documents: memoryDocuments(), info: async () => ({ platform: "linux" }) },
      now: fixedClock,
    });
    active = pack;
    await pack.bridge.createBudget(baseInput);

    await expect(pack.bridge.exportBudget()).resolves.toEqual({ canceled: true });
    await expect(pack.bridge.exportRecords("csv")).resolves.toEqual({ canceled: true });
    await expect(pack.bridge.importBudget()).resolves.toEqual({ canceled: true });
    await expect(pack.bridge.readImportSource()).resolves.toEqual({ canceled: true });

    const sentences = pack.notices().join(" ");
    expect(sentences).toMatch(/no file picker/u);
    expect(sentences).toMatch(/could not be exported/u);
  });

  it("turns a failing picker into a notice and a cancellation", async () => {
    const { pack, files } = setup();
    active = pack;
    await pack.bridge.createBudget(baseInput);

    files.failSave = new Error("no portal");
    await expect(pack.bridge.exportBudget()).resolves.toEqual({ canceled: true });
    expect(pack.notices().join(" ")).toMatch(/no portal/u);

    files.failOpen = new Error("no portal");
    await expect(pack.bridge.importBudget()).resolves.toEqual({ canceled: true });
    expect(pack.notices().join(" ")).toMatch(/no portal/u);
  });
});

describe("the remaining bridge surface", () => {
  it("reports the platform from window.suite.info()", async () => {
    const { pack } = setup({ info: async () => ({ platform: "darwin" }) });
    active = pack;
    await expect(pack.bridge.platform()).resolves.toBe("darwin");

    const { pack: withoutPlatform } = setup({ info: async () => ({}) });
    withoutPlatform.dispose();
    const unknown = createBudgetPack({ host: {}, now: fixedClock });
    await expect(unknown.bridge.platform()).resolves.toBe("unknown");
    unknown.dispose();
  });

  it("makes reveal a notice and onCommand a no-op subscription", async () => {
    const { pack } = setup();
    active = pack;

    await expect(pack.bridge.revealBudget("budget-1.budget")).resolves.toBeUndefined();
    expect(pack.notices().join(" ")).toMatch(/cannot show it in a folder/u);

    const off = pack.bridge.onCommand(() => {
      throw new Error("no contributions should reach this listener");
    });
    expect(typeof off).toBe("function");
    expect(() => off()).not.toThrow();
  });
});
