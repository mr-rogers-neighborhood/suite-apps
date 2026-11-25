import { describe, expect, it } from "vitest";

import {
  ageOfMoney,
  BudgetDocument,
  budgetVsActual,
  cashFlowSeries,
  incomeExpenseSeries,
  monthsForRange,
  netWorthSeries,
  spendingByCategory,
} from "../index";

const NOW = new Date(2026, 2, 15, 12, 0, 0, 0);
const MONTHS = ["2026-01", "2026-02", "2026-03"] as const;

/**
 * Three months of one budget: two income months, a refund, one uncategorized row, an internal
 * transfer between on-budget accounts, and a transfer out of the budget with a category.
 */
function setup() {
  const doc = BudgetDocument.create({ name: "Reports", currency: "USD", now: NOW });
  const checking = doc.createAccount({
    name: "Checking",
    type: "checking",
    startingBalanceMinor: 0,
    startingDate: "2026-01-01",
  });
  const savings = doc.createAccount({
    name: "Savings",
    type: "savings",
    startingBalanceMinor: 0,
    startingDate: "2026-01-01",
  });
  const loan = doc.createAccount({
    name: "Loan",
    type: "loan",
    onBudget: false,
    startingBalanceMinor: -500_000,
    startingDate: "2026-01-01",
  });
  const group = doc.createCategoryGroup({ name: "Living" }, NOW);
  const housing = doc.createCategory({ groupId: group.id, name: "Housing" }, NOW);
  const food = doc.createCategory({ groupId: group.id, name: "Food" }, NOW);

  doc.createTransaction(
    {
      accountId: checking.id,
      date: "2026-01-05",
      amountMinor: 300_000,
      categoryId: "rta",
      payeeName: "Employer",
    },
    NOW,
  );
  doc.createTransaction(
    {
      accountId: checking.id,
      date: "2026-01-10",
      amountMinor: -120_000,
      categoryId: housing.id,
      payeeName: "Landlord",
    },
    NOW,
  );
  doc.createTransaction(
    {
      accountId: checking.id,
      date: "2026-02-05",
      amountMinor: 300_000,
      categoryId: "rta",
      payeeName: "Employer",
    },
    NOW,
  );
  doc.createTransaction(
    {
      accountId: checking.id,
      date: "2026-02-10",
      amountMinor: -60_000,
      categoryId: food.id,
      payeeName: "Market",
    },
    NOW,
  );
  doc.createTransaction(
    {
      accountId: checking.id,
      date: "2026-02-15",
      amountMinor: 10_000,
      categoryId: food.id,
      payeeName: "Market refund",
    },
    NOW,
  );
  doc.createTransaction(
    {
      accountId: checking.id,
      date: "2026-03-03",
      amountMinor: -25_000,
      categoryId: null,
      payeeName: "Unknown",
    },
    NOW,
  );
  doc.createTransfer(
    { fromAccount: checking, toAccount: savings, date: "2026-03-04", amountMinor: 50_000 },
    NOW,
  );
  doc.createTransfer(
    {
      fromAccount: checking,
      toAccount: loan,
      date: "2026-03-05",
      amountMinor: 20_000,
      categoryId: housing.id,
    },
    NOW,
  );

  doc.setAssigned("2026-01", housing.id, 100_000, NOW);
  doc.setAssigned("2026-01", food.id, 20_000, NOW);

  return { doc, snapshot: doc.getSnapshot(), checking, savings, loan, housing, food };
}

describe("monthsForRange", () => {
  it("should end at the current month for every fixed range", () => {
    const { snapshot } = setup();

    expect(monthsForRange(snapshot, "1m", NOW)).toEqual(["2026-03"]);
    expect(monthsForRange(snapshot, "3m", NOW)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(monthsForRange(snapshot, "6m", NOW)).toHaveLength(6);
    expect(monthsForRange(snapshot, "12m", NOW)).toHaveLength(12);
    expect(monthsForRange(snapshot, "ytd", NOW)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("should start all time at the first month the ledger knows about", () => {
    const { snapshot } = setup();

    expect(monthsForRange(snapshot, "all", NOW)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("should return nothing for a range on an empty ledger", () => {
    const empty = BudgetDocument.create({ name: "Empty", currency: "USD", now: NOW }).getSnapshot();

    expect(monthsForRange(empty, "all", NOW)).toEqual(["2026-03"]);
  });
});

describe("incomeExpenseSeries", () => {
  it("should count Ready to Assign income and net spending per month", () => {
    const { snapshot } = setup();

    expect(incomeExpenseSeries(snapshot, MONTHS)).toEqual([
      { month: "2026-01", incomeMinor: 300_000, expenseMinor: 120_000, netMinor: 180_000 },
      { month: "2026-02", incomeMinor: 300_000, expenseMinor: 50_000, netMinor: 250_000 },
      { month: "2026-03", incomeMinor: 0, expenseMinor: 45_000, netMinor: -45_000 },
    ]);
  });

  it("should return an empty series for no months", () => {
    const { snapshot } = setup();

    expect(incomeExpenseSeries(snapshot, [])).toEqual([]);
  });
});

describe("spendingByCategory", () => {
  it("should rank categories by net spending, after refunds", () => {
    const { snapshot, housing, food } = setup();

    const rows = spendingByCategory(snapshot, MONTHS);

    expect(rows.map((row) => row.categoryId)).toEqual([housing.id, food.id]);
    expect(rows.map((row) => row.spentMinor)).toEqual([140_000, 50_000]);
    expect(rows[0]).toMatchObject({ categoryName: "Housing", groupName: "Living" });
  });

  it("should leave out a category whose refunds outweigh its spending", () => {
    const doc = BudgetDocument.create({ name: "Refunds", currency: "USD", now: NOW });
    const account = doc.createAccount({ name: "Checking", type: "checking" }, NOW);
    const group = doc.createCategoryGroup({ name: "Living" }, NOW);
    const food = doc.createCategory({ groupId: group.id, name: "Food" }, NOW);
    doc.createTransaction(
      {
        accountId: account.id,
        date: "2026-03-01",
        amountMinor: -10_000,
        categoryId: food.id,
        payeeName: "Market",
      },
      NOW,
    );
    doc.createTransaction(
      {
        accountId: account.id,
        date: "2026-03-02",
        amountMinor: 15_000,
        categoryId: food.id,
        payeeName: "Market",
      },
      NOW,
    );

    expect(spendingByCategory(doc.getSnapshot(), ["2026-03"])).toEqual([]);
  });
});

describe("netWorthSeries", () => {
  it("should include off-budget accounts by default", () => {
    const { snapshot } = setup();

    expect(netWorthSeries(snapshot, MONTHS).map((point) => point.valueMinor)).toEqual([
      -320_000, -70_000, -95_000,
    ]);
  });

  it("should leave off-budget accounts out when asked", () => {
    const { snapshot } = setup();

    expect(
      netWorthSeries(snapshot, MONTHS, { includeOffBudget: false }).map(
        (point) => point.valueMinor,
      ),
    ).toEqual([180_000, 430_000, 385_000]);
  });

  it("should carry the balance through a month with no activity", () => {
    const doc = BudgetDocument.create({ name: "Quiet", currency: "USD", now: NOW });
    const account = doc.createAccount({
      name: "Checking",
      type: "checking",
      startingBalanceMinor: 50_000,
      startingDate: "2026-01-01",
    });
    doc.createTransaction(
      {
        accountId: account.id,
        date: "2026-01-10",
        amountMinor: -10_000,
        categoryId: "rta",
        payeeName: "Shop",
      },
      NOW,
    );

    expect(
      netWorthSeries(doc.getSnapshot(), ["2026-01", "2026-02"]).map((p) => p.valueMinor),
    ).toEqual([40_000, 40_000]);
  });
});

describe("cashFlowSeries", () => {
  it("should report the on-budget balance beside each month's flows", () => {
    const { snapshot } = setup();

    expect(cashFlowSeries(snapshot, MONTHS)).toEqual([
      { month: "2026-01", balanceMinor: 180_000, incomeMinor: 300_000, expenseMinor: 120_000 },
      { month: "2026-02", balanceMinor: 430_000, incomeMinor: 300_000, expenseMinor: 50_000 },
      { month: "2026-03", balanceMinor: 385_000, incomeMinor: 0, expenseMinor: 45_000 },
    ]);
  });
});

describe("budgetVsActual", () => {
  it("should report the plan month's assigned, activity and available", () => {
    const { snapshot, housing, food } = setup();

    const rows = budgetVsActual(snapshot, "2026-01");

    expect(rows).toEqual([
      {
        categoryId: housing.id,
        categoryName: "Housing",
        groupName: "Living",
        assignedMinor: 100_000,
        activityMinor: -120_000,
        availableMinor: -20_000,
      },
      {
        categoryId: food.id,
        categoryName: "Food",
        groupName: "Living",
        assignedMinor: 20_000,
        activityMinor: 0,
        availableMinor: 20_000,
      },
    ]);
  });
});

describe("ageOfMoney", () => {
  it("should age each outflow by the FIFO dollars it consumes", () => {
    const { snapshot } = setup();

    const report = ageOfMoney(snapshot, MONTHS);

    expect(report.points).toEqual([
      { month: "2026-01", days: 5 },
      { month: "2026-02", days: 36 },
      { month: "2026-03", days: 58 },
    ]);
    expect(report.lastOutflows.map((outflow) => outflow.days)).toEqual([5, 36, 57, 59]);
    expect(report.averageDays).toBe(24);
  });

  it("should leave a month with no outflow unmeasured", () => {
    const doc = BudgetDocument.create({ name: "Income only", currency: "USD", now: NOW });
    const account = doc.createAccount({ name: "Checking", type: "checking" }, NOW);
    doc.createTransaction(
      {
        accountId: account.id,
        date: "2026-02-05",
        amountMinor: 300_000,
        categoryId: "rta",
        payeeName: "Employer",
      },
      NOW,
    );

    const report = ageOfMoney(doc.getSnapshot(), ["2026-01", "2026-02"]);

    expect(report.points).toEqual([
      { month: "2026-01", days: null },
      { month: "2026-02", days: null },
    ]);
    expect(report.averageDays).toBeNull();
    expect(report.lastOutflows).toEqual([]);
  });

  it("should not count an internal transfer as an outflow", () => {
    const { snapshot } = setup();
    const report = ageOfMoney(snapshot, MONTHS);

    expect(report.lastOutflows.map((outflow) => outflow.date)).not.toContain("2026-03-04");
  });
});
