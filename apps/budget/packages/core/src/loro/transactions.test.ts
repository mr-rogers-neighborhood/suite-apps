import { describe, expect, it } from "vitest";

import { BudgetDocument, TransactionError } from "../index";

const NOW = new Date("2026-01-15T12:00:00.000Z");

function setup() {
  const doc = BudgetDocument.create({ name: "Test", currency: "USD", now: NOW });
  const checking = doc.createAccount(
    {
      name: "Checking",
      type: "checking",
      startingBalanceMinor: 100_000,
      startingDate: "2026-01-01",
    },
    NOW,
  );
  const savings = doc.createAccount(
    {
      name: "Savings",
      type: "savings",
      startingBalanceMinor: 0,
      startingDate: "2026-01-01",
    },
    NOW,
  );
  const group = doc.createCategoryGroup({ name: "Everyday" }, NOW);
  const food = doc.createCategory({ groupId: group.id, name: "Food" }, NOW);
  const fun = doc.createCategory({ groupId: group.id, name: "Fun" }, NOW);
  return { doc, checking, savings, food, fun };
}

describe("transfers", () => {
  it("should conserve the total and mirror both legs", () => {
    const { doc, checking, savings } = setup();
    const [from, to] = doc.createTransfer(
      { fromAccount: checking, toAccount: savings, date: "2026-01-10", amountMinor: 10_000 },
      NOW,
    );

    const total = (): number =>
      doc
        .listTransactions()
        .filter((transaction) => transaction.transferId)
        .reduce((sum, transaction) => sum + transaction.amountMinor, 0);
    expect(total()).toBe(0);
    expect(from.amountMinor).toBe(-10_000);
    expect(to.amountMinor).toBe(10_000);
    expect(doc.accountBalance(checking.id)).toBe(90_000);
    expect(doc.accountBalance(savings.id)).toBe(10_000);

    doc.updateTransaction(from.id, { amountMinor: -12_500 }, NOW);
    expect(total()).toBe(0);
    expect(doc.getTransaction(from.id)?.amountMinor).toBe(-12_500);
    expect(doc.getTransaction(to.id)?.amountMinor).toBe(12_500);

    doc.updateTransaction(to.id, { date: "2026-01-11", cleared: "cleared" }, NOW);
    expect(doc.getTransaction(from.id)?.date).toBe("2026-01-11");
    expect(doc.getTransaction(from.id)?.cleared).toBe("cleared");
    expect(total()).toBe(0);
  });

  it("should remove both legs together", () => {
    const { doc, checking, savings } = setup();
    const [from, to] = doc.createTransfer(
      { fromAccount: checking, toAccount: savings, date: "2026-01-10", amountMinor: 10_000 },
      NOW,
    );

    doc.deleteTransaction(to.id);
    expect(doc.listTransactions().filter((transaction) => transaction.transferId)).toEqual([]);
    expect(doc.accountBalance(checking.id)).toBe(100_000);
    expect(doc.accountBalance(savings.id)).toBe(0);
    expect(doc.getTransaction(from.id)).toBeUndefined();
  });

  it("should refuse a zero, negative or fractional amount", () => {
    const { doc, checking, savings } = setup();
    for (const amountMinor of [0, -1, 12.5]) {
      expect(() =>
        doc.createTransfer(
          { fromAccount: checking, toAccount: savings, date: "2026-01-10", amountMinor },
          NOW,
        ),
      ).toThrow(TransactionError);
    }
    expect(doc.listTransactions().filter((transaction) => transaction.transferId)).toEqual([]);
  });

  it("should refuse to edit or delete the pair through an unlocked leg", () => {
    const { doc, checking, savings } = setup();
    const [, to] = doc.createTransfer(
      {
        fromAccount: checking,
        toAccount: savings,
        date: "2026-01-10",
        amountMinor: 10_000,
        cleared: "cleared",
      },
      NOW,
    );
    doc.reconcileAccount(
      { accountId: checking.id, statementDate: "2026-01-31", statementBalanceMinor: 90_000 },
      NOW,
    );
    const reconciled = doc.listTransactions().find((row) => row.accountId === checking.id);
    expect(reconciled?.cleared).toBe("reconciled");

    expect(() => doc.updateTransaction(to.id, { amountMinor: 20_000 }, NOW)).toThrow(
      /Unlock the reconciliation/,
    );
    expect(() => doc.deleteTransaction(to.id)).toThrow(/Unlock the reconciliation/);
    expect(doc.getTransaction(to.id)?.amountMinor).toBe(10_000);
    expect(doc.listTransactions().filter((row) => row.transferId)).toHaveLength(2);
  });
});

describe("allocation guards", () => {
  it("should keep assignments in integer minor units", () => {
    const { doc, food } = setup();
    expect(() => doc.setAssigned("2026-01", food.id, 10.5)).toThrow(/integer minor units/);
    expect(() => doc.applyAssignments("2026-01", new Map([[food.id, 0.5]]))).toThrow(
      /integer minor units/,
    );
    expect(doc.assignedFor("2026-01", food.id)).toBe(0);
  });
});

describe("splits", () => {
  it("should keep the parent total in step with a child edit", () => {
    const { doc, checking, food, fun } = setup();
    const parent = doc.createSplit(
      {
        accountId: checking.id,
        date: "2026-01-12",
        payeeName: "Shop",
        splits: [
          { categoryId: food.id, amountMinor: -6_000 },
          { categoryId: fun.id, amountMinor: -4_000 },
        ],
      },
      NOW,
    );
    expect(parent.amountMinor).toBe(-10_000);

    const child = doc
      .listTransactions()
      .find((row) => row.parentId === parent.id && row.amountMinor === -6_000);
    if (!child) throw new Error("Expected a split child");
    doc.updateTransaction(child.id, { amountMinor: -5_000 }, NOW);

    expect(doc.getTransaction(parent.id)?.amountMinor).toBe(-9_000);
    expect(doc.accountBalance(checking.id)).toBe(91_000);
  });

  it("should refuse a split line of zero or a zero total", () => {
    const { doc, checking, food, fun } = setup();
    expect(() =>
      doc.createSplit(
        {
          accountId: checking.id,
          date: "2026-01-12",
          splits: [
            { categoryId: food.id, amountMinor: -6_000 },
            { categoryId: fun.id, amountMinor: 0 },
          ],
        },
        NOW,
      ),
    ).toThrow(TransactionError);
    expect(() =>
      doc.createSplit(
        {
          accountId: checking.id,
          date: "2026-01-12",
          splits: [
            { categoryId: food.id, amountMinor: -600 },
            { categoryId: fun.id, amountMinor: 600 },
          ],
        },
        NOW,
      ),
    ).toThrow(/total zero/);
  });
});
