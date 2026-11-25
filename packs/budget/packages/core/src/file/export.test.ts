import { describe, expect, it } from "vitest";

import {
  BudgetDocument,
  type CsvMapping,
  parseCsv,
  parseQif,
  READY_TO_ASSIGN,
  READY_TO_ASSIGN_NAME,
  reservedCategoryId,
  transactionsToCsv,
  transactionsToQif,
  transferDirection,
} from "../index";

const NOW = new Date("2026-01-01T12:00:00.000Z");

const csvMapping: CsvMapping = {
  delimiter: ",",
  hasHeader: true,
  skipRows: 0,
  dateColumn: 0,
  dateFormat: "iso",
  payeeColumn: 2,
  memoColumn: 4,
  amountColumn: 5,
  inflowColumn: null,
  outflowColumn: null,
  categoryColumn: 3,
  negate: false,
};

/**
 * One budget that exercises every transaction shape an export has to carry: income to Ready to
 * Assign, a categorized outflow with quoting in its payee and memo, a split, and a transfer.
 */
function sample() {
  const doc = BudgetDocument.create({ name: "Export", currency: "USD", now: NOW });
  const group = doc.createCategoryGroup({ name: "Living" }, NOW);
  const food = doc.createCategory({ groupId: group.id, name: "Food" }, NOW);
  const rent = doc.createCategory({ groupId: group.id, name: "Rent" }, NOW);
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
    { name: "Savings", type: "savings", startingBalanceMinor: 0, startingDate: "2026-01-01" },
    NOW,
  );

  doc.createTransaction(
    {
      accountId: checking.id,
      date: "2026-01-02",
      amountMinor: 300_000,
      categoryId: READY_TO_ASSIGN,
      payeeName: "Employer",
      imported: {
        source: "qif",
        externalId: "REF-42",
        importedAt: NOW.toISOString(),
        originalPayee: "EMPLOYER PAYROLL",
      },
    },
    NOW,
  );
  doc.createTransaction(
    {
      accountId: checking.id,
      date: "2026-01-03",
      amountMinor: -1_234,
      categoryId: food.id,
      payeeName: 'Shop, "Inc"',
      memo: "Lunch\nwith team",
      cleared: "cleared",
    },
    NOW,
  );
  doc.createSplit(
    {
      accountId: checking.id,
      date: "2026-01-04",
      payeeName: "Supermarket",
      splits: [
        { categoryId: food.id, amountMinor: -1_000, memo: "Produce" },
        { categoryId: rent.id, amountMinor: -2_000, memo: "Household" },
      ],
    },
    NOW,
  );
  doc.createTransfer(
    {
      fromAccount: checking,
      toAccount: savings,
      date: "2026-01-05",
      amountMinor: 5_000,
      cleared: "cleared",
    },
    NOW,
  );

  return { doc, snapshot: doc.getSnapshot(), checking, savings, food, rent };
}

describe("CSV export and import", () => {
  it("should read back dates, payees, memos and amounts from its own file", () => {
    const { snapshot } = sample();
    const csv = transactionsToCsv(snapshot);
    const parsed = parseCsv(csv, csvMapping, "USD", 2);
    if (parsed.isErr()) throw parsed.error;

    expect(parsed.value.errors).toEqual([]);
    const shop = parsed.value.rows.find((row) => row.payeeName === 'Shop, "Inc"');
    expect(shop).toMatchObject({
      date: "2026-01-03",
      amountMinor: -1_234,
      memo: "Lunch\nwith team",
      categoryName: "Food",
    });

    const income = parsed.value.rows.find((row) => row.payeeName === "Employer");
    expect(income?.amountMinor).toBe(300_000);
    expect(income?.categoryName).toBe(READY_TO_ASSIGN_NAME);
    expect(reservedCategoryId(income?.categoryName ?? null)).toBe(READY_TO_ASSIGN);
  });

  it("should write a split's lines rather than the grouping parent", () => {
    const { snapshot } = sample();
    const parsed = parseCsv(transactionsToCsv(snapshot), csvMapping, "USD", 2);
    if (parsed.isErr()) throw parsed.error;

    const children = parsed.value.rows.filter((row) => row.payeeName === "Supermarket");
    expect(children.map((row) => row.amountMinor).sort((a, b) => a - b)).toEqual([-2_000, -1_000]);
    expect(children.map((row) => row.categoryName).sort()).toEqual(["Food", "Rent"]);
    expect(parsed.value.rows.some((row) => row.amountMinor === -3_000)).toBe(false);
  });
});

describe("QIF export and import", () => {
  it("should round-trip the transaction shapes QIF can carry", () => {
    const { snapshot } = sample();
    const qif = transactionsToQif(snapshot);
    const parsed = parseQif(qif, "USD", 2, { dateFormat: "us" });
    if (parsed.isErr()) throw parsed.error;

    const income = parsed.value.rows.find((row) => row.payeeName === "Employer");
    expect(income).toMatchObject({
      date: "2026-01-02",
      amountMinor: 300_000,
      categoryName: READY_TO_ASSIGN_NAME,
      externalId: "REF-42",
    });

    const shop = parsed.value.rows.find((row) => row.payeeName === 'Shop, "Inc"');
    expect(shop).toMatchObject({
      amountMinor: -1_234,
      memo: "Lunch with team",
      cleared: "cleared",
      categoryName: "Food",
    });

    const split = parsed.value.rows.find((row) => row.payeeName === "Supermarket");
    expect(split?.amountMinor).toBe(-3_000);
    expect(split?.splits.map((line) => line.amountMinor).sort((a, b) => a - b)).toEqual([
      -2_000, -1_000,
    ]);
    expect(split?.splits.map((line) => line.categoryName).sort()).toEqual(["Food", "Rent"]);
  });

  it("should keep a transfer's direction for whichever register imports it", () => {
    const { snapshot } = sample();
    const parsed = parseQif(transactionsToQif(snapshot), "USD", 2, { dateFormat: "us" });
    if (parsed.isErr()) throw parsed.error;

    const legs = parsed.value.rows.filter((row) => row.transferAccountName !== null);
    const checkingLeg = legs.find((row) => row.transferAccountName === "Savings");
    const savingsLeg = legs.find((row) => row.transferAccountName === "Checking");
    if (!checkingLeg || !savingsLeg) throw new Error("export did not write both transfer legs");

    // Each account's own register imports its own leg and drops the other side.
    expect(transferDirection(checkingLeg, "Checking")).toBe("outbound");
    expect(transferDirection(savingsLeg, "Checking")).toBe("other-leg");
    expect(transferDirection(savingsLeg, "Savings")).toBe("inbound");
    expect(transferDirection(checkingLeg, "Savings")).toBe("other-leg");
    expect(checkingLeg.amountMinor).toBe(-5_000);
    expect(savingsLeg.amountMinor).toBe(5_000);
  });
});

describe("currency scales", () => {
  it("should round-trip amounts in zero-, two- and three-decimal currencies", () => {
    for (const [currency, scale, amount] of [
      ["JPY", 0, -1234],
      ["USD", 2, -1234],
      ["KWD", 3, -1234],
    ] as const) {
      const doc = BudgetDocument.create({ name: currency, currency, now: NOW });
      const account = doc.createAccount({ name: "Cash", type: "cash" }, NOW);
      doc.createTransaction(
        { accountId: account.id, date: "2026-01-02", amountMinor: amount, payeeName: "Shop" },
        NOW,
      );

      const parsed = parseCsv(transactionsToCsv(doc.getSnapshot()), csvMapping, currency, scale);
      if (parsed.isErr()) throw parsed.error;
      expect(parsed.value.rows[0]?.amountMinor).toBe(amount);
    }
  });
});
