import { describe, expect, it } from "vitest";

import {
  BudgetDocument,
  decodeBudgetFile,
  decodeRecords,
  encodeBudgetFile,
  encodeRecords,
} from "../index";

function sample() {
  const doc = BudgetDocument.create({
    name: "Sample",
    currency: "USD",
    now: new Date("2026-01-01T12:00:00.000Z"),
  });
  const group = doc.createCategoryGroup({ name: "Group" });
  const category = doc.createCategory({ groupId: group.id, name: "Food" });
  const account = doc.createAccount({
    name: "Checking",
    type: "checking",
    startingBalanceMinor: 100_000,
    startingDate: "2026-01-01",
  });
  doc.createTransaction({
    accountId: account.id,
    date: "2026-01-02",
    amountMinor: -1_234,
    categoryId: category.id,
    payeeName: "Shop",
  });
  doc.setAssigned("2026-01", category.id, 5_000);
  return { doc, account, category };
}

describe("the .budget envelope", () => {
  it("should round-trip a document", () => {
    const { doc } = sample();
    const encoded = encodeBudgetFile(doc);
    const decoded = decodeBudgetFile(encoded);
    if (decoded.isErr()) throw decoded.error;
    const restored = BudgetDocument.fromSnapshot(decoded.value);
    expect(restored.getSnapshot()).toEqual(doc.getSnapshot());
  });

  it("should reject another app's JSON", () => {
    expect(decodeBudgetFile('{"format":"other"}').isErr()).toBe(true);
    expect(decodeBudgetFile("not json").isErr()).toBe(true);
  });

  it("should refuse a newer schema and name the versions", () => {
    const { doc } = sample();
    const envelope = JSON.parse(encodeBudgetFile(doc)) as Record<string, unknown>;
    const decoded = decodeBudgetFile(JSON.stringify({ ...envelope, schemaVersion: 9 }));

    expect(decoded.isErr()).toBe(true);
    if (decoded.isOk()) return;
    expect(decoded.error.code).toBe("unsupported-schema");
    expect(decoded.error.message).toContain("Suite Budget schema 9");
    expect(decoded.error.message).toContain("up to 1");
  });

  it("should refuse a newer file format and name the app", () => {
    const { doc } = sample();
    const envelope = JSON.parse(encodeBudgetFile(doc)) as Record<string, unknown>;
    const decoded = decodeBudgetFile(JSON.stringify({ ...envelope, formatVersion: 4 }));

    expect(decoded.isErr()).toBe(true);
    if (decoded.isOk()) return;
    expect(decoded.error.code).toBe("unsupported-version");
    expect(decoded.error.message).toContain("newer Suite Budget");
    expect(decoded.error.message).toContain("file version 4");
  });
});

describe("the records envelope", () => {
  it("should round-trip every record", () => {
    const { doc } = sample();
    const encoded = encodeRecords(doc.getSnapshot());
    const decoded = decodeRecords(encoded);
    if (decoded.isErr()) throw decoded.error;
    const restored = BudgetDocument.fromRecords(decoded.value);
    expect(restored.getSnapshot()).toEqual(doc.getSnapshot());
  });

  it("should keep a zero-decimal currency and its scale", () => {
    const doc = BudgetDocument.create({
      name: "Yen",
      currency: "JPY",
      now: new Date("2026-01-01T12:00:00.000Z"),
    });
    const decoded = decodeRecords(encodeRecords(doc.getSnapshot()));
    if (decoded.isErr()) throw decoded.error;

    expect(decoded.value.settings.currency).toBe("JPY");
    expect(decoded.value.settings.currencyScale).toBe(0);
    expect(BudgetDocument.fromRecords(decoded.value).getSnapshot().settings.currencyScale).toBe(0);
  });

  it("should reject a records file with a broken reference", () => {
    const { doc } = sample();
    const snapshot = doc.getSnapshot();
    const broken = {
      ...snapshot,
      transactions: snapshot.transactions.map((transaction) => ({
        ...transaction,
        categoryId: "missing",
      })),
    };
    const encoded = encodeRecords(broken);
    const decoded = decodeRecords(encoded);
    expect(decoded.isErr()).toBe(true);
  });
});
