import { describe, expect, it } from "vitest";

import { applyRules, BudgetDocument, PayeeError, type RuleDraft } from "../index";

const NOW = new Date("2026-01-15T12:00:00.000Z");

function setup() {
  const doc = BudgetDocument.create({ name: "Test", currency: "USD", now: NOW });
  const group = doc.createCategoryGroup({ name: "Everyday" }, NOW);
  const food = doc.createCategory({ groupId: group.id, name: "Food" }, NOW);
  const fun = doc.createCategory({ groupId: group.id, name: "Fun" }, NOW);
  const account = doc.createAccount({ name: "Checking", type: "checking" }, NOW);
  return { doc, group, food, fun, account };
}

function draftOf(
  doc: BudgetDocument,
  transactionId: string,
  categoryNames: ReadonlyMap<string, string>,
): RuleDraft {
  const transaction = doc.getTransaction(transactionId);
  if (!transaction) throw new Error("Expected a transaction");
  const account = doc.getAccount(transaction.accountId);
  return {
    accountId: transaction.accountId,
    accountName: account?.name ?? "",
    payeeName: transaction.payeeName,
    importedPayee: transaction.imported?.originalPayee ?? "",
    categoryId: transaction.categoryId,
    categoryName: categoryNames.get(transaction.categoryId ?? "") ?? "",
    date: transaction.date,
    memo: transaction.memo,
    amountMinor: transaction.amountMinor,
    cleared: transaction.cleared,
    flag: transaction.flag,
  };
}

function categoryPass(doc: BudgetDocument): Map<string, string | null> {
  const categoryNames = new Map(doc.listCategories().map((row) => [row.id, row.name]));
  const result = new Map<string, string | null>();
  for (const transaction of doc.listTransactions()) {
    if (transaction.parentId !== null) continue;
    const draft = draftOf(doc, transaction.id, categoryNames);
    result.set(
      transaction.id,
      applyRules(draft, doc.listRules(), {
        currency: "USD",
        currencyScale: 2,
        categoryNames,
      }).draft.categoryId,
    );
  }
  return result;
}

describe("payee rename", () => {
  it("should rename the payee and its history without touching categories", () => {
    const { doc, food, fun, account } = setup();
    const shop = doc.createTransaction(
      {
        accountId: account.id,
        date: "2026-01-02",
        amountMinor: -1_000,
        categoryId: food.id,
        payeeName: "Shop",
      },
      NOW,
    );
    const other = doc.createTransaction(
      {
        accountId: account.id,
        date: "2026-01-03",
        amountMinor: -2_000,
        categoryId: food.id,
        payeeName: "Shop",
      },
      NOW,
    );
    doc.updateTransaction(shop.id, { categoryId: fun.id }, NOW);
    const payee = doc.listPayees().find((row) => row.name === "Shop");
    if (!payee) throw new Error("Expected a payee");

    doc.renamePayee(payee.id, "Market", NOW);

    expect(doc.listPayees().find((row) => row.id === payee.id)?.name).toBe("Market");
    expect(doc.getTransaction(shop.id)).toMatchObject({ payeeName: "Market", categoryId: fun.id });
    expect(doc.getTransaction(other.id)).toMatchObject({
      payeeName: "Market",
      categoryId: food.id,
    });
  });

  it("should retarget the learned category rule and keep the import mapping", () => {
    const { doc, food, fun, account } = setup();
    const transaction = doc.createTransaction(
      {
        accountId: account.id,
        date: "2026-01-02",
        amountMinor: -1_000,
        categoryId: food.id,
        payeeName: "Shop",
      },
      NOW,
    );
    doc.updateTransaction(transaction.id, { categoryId: fun.id }, NOW);
    const payee = doc.listPayees().find((row) => row.name === "Shop");
    if (!payee) throw new Error("Expected a payee");

    doc.renamePayee(payee.id, "Market", NOW);

    const learned = doc.listRules().filter((rule) => rule.source === "learned");
    expect(learned).toHaveLength(2);
    const categoryRule = learned.find((rule) => rule.conditions[0]?.field === "payee");
    expect(categoryRule?.conditions).toEqual([{ field: "payee", op: "is", value: "Market" }]);
    expect(categoryRule?.actions).toEqual([{ field: "setCategory", value: fun.id }]);
    const renameRule = learned.find((rule) => rule.conditions[0]?.field === "importedPayee");
    expect(renameRule?.conditions).toEqual([
      { field: "importedPayee", op: "contains", value: "Shop" },
    ]);
    expect(renameRule?.actions).toEqual([{ field: "setPayee", value: "Market" }]);
  });

  it("should be category-neutral for a rules pass", () => {
    const { doc, food, fun, account } = setup();
    const first = doc.createTransaction(
      {
        accountId: account.id,
        date: "2026-01-02",
        amountMinor: -1_000,
        categoryId: food.id,
        payeeName: "Shop",
      },
      NOW,
    );
    const second = doc.createTransaction(
      {
        accountId: account.id,
        date: "2026-01-03",
        amountMinor: -2_000,
        categoryId: null,
        payeeName: "Cafe",
      },
      NOW,
    );
    doc.updateTransaction(first.id, { categoryId: fun.id }, NOW);
    doc.createRule(
      {
        conditions: [{ field: "payee", op: "is", value: "Cafe" }],
        actions: [{ field: "setCategory", value: food.id }],
      },
      NOW,
    );
    const payee = doc.listPayees().find((row) => row.name === "Shop");
    if (!payee) throw new Error("Expected a payee");

    const before = categoryPass(doc);
    doc.renamePayee(payee.id, "Market", NOW);
    const after = categoryPass(doc);

    expect(after.get(first.id)).toBe(before.get(first.id));
    expect(after.get(second.id)).toBe(before.get(second.id));
    expect(after.get(first.id)).toBe(fun.id);
    expect(after.get(second.id)).toBe(food.id);
  });

  it("should refuse a name another payee already holds", () => {
    const { doc, account } = setup();
    doc.createPayee({ name: "Market" }, NOW);
    const shop = doc.createPayee({ name: "Shop" }, NOW);
    doc.createTransaction(
      {
        accountId: account.id,
        date: "2026-01-02",
        amountMinor: -1_000,
        payeeId: shop.id,
        categoryId: null,
      },
      NOW,
    );

    expect(() => doc.renamePayee(shop.id, "market", NOW)).toThrow(PayeeError);
    expect(doc.listPayees().find((row) => row.id === shop.id)?.name).toBe("Shop");
    expect(doc.listPayees().filter((row) => row.name.toLowerCase() === "market")).toHaveLength(1);
  });
});
