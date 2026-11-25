import { describe, expect, it } from "vitest";

import type { Target } from "../schema";
import { projectDebtPayoff } from "./amortization";
import { targetStatus } from "./targets";

describe("projectDebtPayoff", () => {
  it("should pay a zero-interest balance in equal payments", () => {
    const projection = projectDebtPayoff({
      balanceMinor: 1_000_000,
      annualRateBps: 0,
      monthlyPaymentMinor: 20_000,
    });
    expect(projection).toEqual({
      status: "paid-off",
      monthsToPayoff: 50,
      totalInterestMinor: 0,
      totalPaidMinor: 1_000_000,
      finalPaymentMinor: 20_000,
    });
  });

  it("should project a standard multi-year loan", () => {
    const projection = projectDebtPayoff({
      balanceMinor: 1_000_000,
      annualRateBps: 500,
      monthlyPaymentMinor: 20_000,
    });
    expect(projection).toEqual({
      status: "paid-off",
      monthsToPayoff: 57,
      totalInterestMinor: 123_692,
      totalPaidMinor: 1_123_692,
      finalPaymentMinor: 3_692,
    });
  });

  it("should round monthly interest half up to the nearest minor unit", () => {
    const projection = projectDebtPayoff({
      balanceMinor: 50,
      annualRateBps: 1_200,
      monthlyPaymentMinor: 50,
    });
    expect(projection).toEqual({
      status: "paid-off",
      monthsToPayoff: 2,
      totalInterestMinor: 1,
      totalPaidMinor: 51,
      finalPaymentMinor: 1,
    });
  });

  it("should reduce the final payment to the remaining balance", () => {
    const projection = projectDebtPayoff({
      balanceMinor: 10_000,
      annualRateBps: 0,
      monthlyPaymentMinor: 3_000,
    });
    expect(projection).toEqual({
      status: "paid-off",
      monthsToPayoff: 4,
      totalInterestMinor: 0,
      totalPaidMinor: 10_000,
      finalPaymentMinor: 1_000,
    });
  });

  it("should report a payment below monthly interest as never paying off", () => {
    const projection = projectDebtPayoff({
      balanceMinor: 100_000,
      annualRateBps: 1_200,
      monthlyPaymentMinor: 999,
    });
    expect(projection).toEqual({
      status: "never-pays-off",
      reason: "payment-below-interest",
      monthlyInterestMinor: 1_000,
    });
  });

  it("should treat a payment equal to monthly interest as never paying off", () => {
    const projection = projectDebtPayoff({
      balanceMinor: 100_000,
      annualRateBps: 1_200,
      monthlyPaymentMinor: 1_000,
    });
    expect(projection).toEqual({
      status: "never-pays-off",
      reason: "payment-below-interest",
      monthlyInterestMinor: 1_000,
    });
  });

  it("should return an already-paid-off result for a zero balance", () => {
    const projection = projectDebtPayoff({
      balanceMinor: 0,
      annualRateBps: 500,
      monthlyPaymentMinor: 20_000,
    });
    expect(projection).toEqual({
      status: "already-paid-off",
      monthsToPayoff: 0,
      totalInterestMinor: 0,
      totalPaidMinor: 0,
      finalPaymentMinor: 0,
    });
  });

  it("should leave a zero-interest debt target's monthly need unchanged", () => {
    const target: Target = {
      id: "tgt_1",
      categoryId: "cat_1",
      kind: "debt_payoff",
      amountMinor: 1,
      dueMonth: "2026-06",
      accountId: "acct_1",
      startsOn: "2026-01",
      endsOn: null,
      createdAt: "2026-01-01T12:00:00.000Z",
      updatedAt: "2026-01-01T12:00:00.000Z",
    };
    const status = targetStatus(target, 0, "2026-01", -120_000, 120_000);
    expect(status.suggestionMinor).toBe(20_000);
    expect(status.funded).toBe(false);

    const projection = projectDebtPayoff({
      balanceMinor: 120_000,
      annualRateBps: 0,
      monthlyPaymentMinor: status.suggestionMinor,
    });
    expect(projection).toEqual({
      status: "paid-off",
      monthsToPayoff: 6,
      totalInterestMinor: 0,
      totalPaidMinor: 120_000,
      finalPaymentMinor: 20_000,
    });
  });
});
