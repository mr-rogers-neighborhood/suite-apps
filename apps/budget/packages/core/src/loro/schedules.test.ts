import { describe, expect, it } from "vitest";

import { addDays, decodeRecords, todayKey } from "../index";
import { BudgetDocument } from "./BudgetDocument";
import { AUTO_ENTER_HORIZON_DAYS } from "./schedules";

const NOW = new Date(2026, 2, 15, 12, 0, 0, 0);
const TODAY = todayKey(NOW);

function setup(now: Date = NOW) {
  const doc = BudgetDocument.create({ name: "Test", now });
  const account = doc.createAccount({ name: "Checking", type: "checking" }, now);
  const group = doc.createCategoryGroup({ name: "Bills" }, now);
  const category = doc.createCategory({ groupId: group.id, name: "Rent" }, now);
  return { doc, account, category };
}

function addSchedule(
  doc: BudgetDocument,
  accountId: string,
  categoryId: string,
  input: Partial<{
    amountMinor: number;
    frequency: "daily" | "weekly" | "monthly" | "yearly";
    interval: number;
    anchorDate: string;
    endDate: string | null;
    autoEnter: boolean;
  }> = {},
) {
  return doc.createSchedule(
    {
      accountId,
      categoryId,
      payeeName: "Landlord",
      amountMinor: input.amountMinor ?? -100_000,
      frequency: input.frequency ?? "monthly",
      interval: input.interval ?? 1,
      anchorDate: input.anchorDate ?? "2026-01-15",
      endDate: input.endDate ?? null,
      autoEnter: input.autoEnter ?? true,
    },
    NOW,
  );
}

describe("schedule auto-enter", () => {
  it("should default the checkbox off for a stored schedule and old records", () => {
    const old = {
      format: "suite.budget.records",
      formatVersion: 1,
      schemaVersion: 1,
      exportedAt: "2026-01-01T12:00:00.000Z",
      meta: {
        budgetId: "budget_old",
        name: "Old",
        schemaVersion: 1,
        createdAt: "2026-01-01T12:00:00.000Z",
      },
      settings: {},
      accounts: [
        {
          id: "acct_old",
          name: "Checking",
          type: "checking",
          createdAt: "2026-01-01T12:00:00.000Z",
          updatedAt: "2026-01-01T12:00:00.000Z",
        },
      ],
      categoryGroups: [],
      categories: [],
      targets: [],
      monthlyBudgets: [],
      transactions: [],
      payees: [],
      rules: [],
      schedules: [
        {
          id: "sched_old",
          accountId: "acct_old",
          payeeName: "Landlord",
          amountMinor: -100_000,
          frequency: "monthly",
          anchorDate: "2026-01-01",
          nextDate: "2026-02-01",
          createdAt: "2026-01-01T12:00:00.000Z",
          updatedAt: "2026-01-01T12:00:00.000Z",
        },
      ],
      reconciliations: [],
      dashboards: [],
      widgets: [],
    };

    const decoded = decodeRecords(JSON.stringify(old));
    expect(decoded.isOk()).toBe(true);
    if (decoded.isErr()) return;
    expect(decoded.value.schedules[0]?.autoEnter).toBe(false);
    expect(decoded.value.scheduleBatches).toEqual([]);

    const doc = BudgetDocument.fromRecords(decoded.value, NOW);
    expect(doc.listSchedules()[0]?.autoEnter).toBe(false);
    expect(doc.listScheduleBatches()).toEqual([]);
  });

  it("should post one due occurrence through the manual entry path", () => {
    const { doc, account, category } = setup();
    const schedule = addSchedule(doc, account.id, category.id);
    doc.updateSchedule(schedule.id, { nextDate: TODAY }, NOW);

    const result = doc.autoEnterSchedules(NOW);

    expect(result.postedCount).toBe(1);
    expect(result.totalAmountMinor).toBe(-100_000);
    const [transaction] = doc.listTransactions();
    expect(transaction).toMatchObject({
      date: TODAY,
      amountMinor: -100_000,
      scheduledId: schedule.id,
      categoryId: category.id,
    });
    expect(doc.listSchedules()[0]?.nextDate).toBe("2026-04-15");
    expect(doc.listPayees().find((payee) => payee.name === "Landlord")?.lastCategoryId).toBe(
      category.id,
    );
  });

  it("should catch up every missed occurrence as its own transaction", () => {
    const { doc, account, category } = setup();
    const schedule = addSchedule(doc, account.id, category.id);
    doc.updateSchedule(schedule.id, { nextDate: "2026-01-15" }, NOW);

    const result = doc.autoEnterSchedules(NOW);

    expect(result.postedCount).toBe(3);
    expect(doc.listTransactions().map((transaction) => transaction.date)).toEqual([
      "2026-01-15",
      "2026-02-15",
      "2026-03-15",
    ]);
    expect(doc.listSchedules()[0]?.nextDate).toBe("2026-04-15");
    expect(result.batch?.transactionIds).toHaveLength(3);
    expect(result.batch?.totalAmountMinor).toBe(-300_000);
  });

  it("should not post a scheduled date twice after reopening", () => {
    const { doc, account, category } = setup();
    const schedule = addSchedule(doc, account.id, category.id);
    doc.updateSchedule(schedule.id, { nextDate: "2026-01-15" }, NOW);
    expect(doc.autoEnterSchedules(NOW).postedCount).toBe(3);

    const reopened = BudgetDocument.fromSnapshot(doc.snapshot());
    const second = reopened.autoEnterSchedules(NOW);

    expect(second.postedCount).toBe(0);
    expect(reopened.listTransactions()).toHaveLength(3);
    expect(reopened.listSchedules()[0]?.nextDate).toBe("2026-04-15");
  });

  it("should post nothing when the same catch-up runs again while open", () => {
    const { doc, account, category } = setup();
    const schedule = addSchedule(doc, account.id, category.id);
    doc.updateSchedule(schedule.id, { nextDate: "2026-01-15" }, NOW);
    expect(doc.autoEnterSchedules(NOW).postedCount).toBe(3);

    const again = doc.autoEnterSchedules(NOW);

    expect(again.postedCount).toBe(0);
    expect(again.batch).toBeNull();
    expect(doc.listTransactions()).toHaveLength(3);
    expect(doc.listSchedules()[0]?.nextDate).toBe("2026-04-15");
  });

  it("should stop at the end date", () => {
    const { doc, account, category } = setup();
    const schedule = addSchedule(doc, account.id, category.id, { endDate: "2026-02-20" });
    doc.updateSchedule(schedule.id, { nextDate: "2026-01-15" }, NOW);

    expect(doc.autoEnterSchedules(NOW).postedCount).toBe(2);
    expect(doc.listTransactions().map((transaction) => transaction.date)).toEqual([
      "2026-01-15",
      "2026-02-15",
    ]);
    expect(doc.listSchedules()[0]?.nextDate).toBe("2026-03-15");
    expect(doc.autoEnterSchedules(NOW).postedCount).toBe(0);
  });

  it("should skip occurrences beyond the horizon instead of posting years of dailies", () => {
    const { doc, account, category } = setup();
    const schedule = addSchedule(doc, account.id, category.id, {
      frequency: "daily",
      anchorDate: addDays(TODAY, -400),
    });
    doc.updateSchedule(schedule.id, { nextDate: addDays(TODAY, -400) }, NOW);

    const result = doc.autoEnterSchedules(NOW);

    expect(result.skippedBefore).toBeGreaterThan(300);
    expect(result.postedCount).toBeGreaterThan(0);
    expect(result.postedCount).toBeLessThanOrEqual(AUTO_ENTER_HORIZON_DAYS + 1);
    expect(doc.listSchedules()[0]?.nextDate).toBe(addDays(TODAY, 1));
  });

  it("should skip a zero amount and post a negative one", () => {
    const { doc, account, category } = setup();
    const zero = addSchedule(doc, account.id, category.id, { amountMinor: 0 });
    doc.updateSchedule(zero.id, { nextDate: TODAY }, NOW);

    const result = doc.autoEnterSchedules(NOW);
    expect(result.postedCount).toBe(0);
    expect(result.skippedZero).toBe(1);
    expect(doc.listTransactions()).toEqual([]);
    expect(doc.listSchedules()[0]?.nextDate).toBe(TODAY);

    doc.updateSchedule(zero.id, { amountMinor: -2_500 }, NOW);
    expect(doc.autoEnterSchedules(NOW).postedCount).toBe(1);
    expect(doc.listTransactions()[0]?.amountMinor).toBe(-2_500);
  });

  it("should leave a manual schedule alone", () => {
    const { doc, account, category } = setup();
    const schedule = addSchedule(doc, account.id, category.id, { autoEnter: false });
    doc.updateSchedule(schedule.id, { nextDate: "2026-01-15" }, NOW);

    expect(doc.autoEnterSchedules(NOW).postedCount).toBe(0);
    expect(doc.listTransactions()).toEqual([]);
    expect(doc.listSchedules()[0]?.nextDate).toBe("2026-01-15");
  });

  it("should undo the batch and restore nextDate after a restart", () => {
    const { doc, account, category } = setup();
    const schedule = addSchedule(doc, account.id, category.id);
    doc.updateSchedule(schedule.id, { nextDate: "2026-01-15" }, NOW);
    const result = doc.autoEnterSchedules(NOW);
    const batchId = result.batch?.id;
    expect(batchId).toBeDefined();
    if (!batchId) return;

    const reopened = BudgetDocument.fromSnapshot(doc.snapshot());
    expect(reopened.latestScheduleBatch()?.id).toBe(batchId);
    reopened.undoScheduleBatch(batchId, NOW);

    expect(reopened.listTransactions()).toEqual([]);
    expect(reopened.listSchedules()[0]?.nextDate).toBe("2026-01-15");
    expect(reopened.latestScheduleBatch()).toBeUndefined();
    expect(reopened.listScheduleBatches()[0]?.undoneAt).not.toBeNull();

    // A second undo is a no-op and cannot delete anything else.
    const again = reopened.undoScheduleBatch(batchId, NOW);
    expect(again.undoneAt).not.toBeNull();
  });
});
