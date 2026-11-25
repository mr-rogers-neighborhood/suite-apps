/**
 * A projection of a fixed-rate loan paid down by a fixed monthly payment.
 *
 * Every amount is an integer number of minor units and the rate is integer basis points.
 * Monthly interest is rounded half up to the nearest minor unit:
 *
 *   round(balanceMinor * annualRateBps / (10_000 * 12))
 *
 * The final payment is reduced to exactly the balance plus that month's interest, so a
 * projection never charges more than the debt.
 */

const INTEREST_DENOMINATOR = 120_000n;
const INTEREST_ROUNDING = INTEREST_DENOMINATOR / 2n;

/** A payment beyond this horizon is reported as never paying off rather than looping. */
export const DEBT_PAYOFF_HORIZON_MONTHS = 12 * 100;

export type DebtPayoffInput = {
  /** Positive debt outstanding, in minor units. Zero or negative means already paid off. */
  balanceMinor: number;
  /** Annual percentage rate in basis points, for example 500 for 5%. */
  annualRateBps: number;
  /** The amount paid each month, in minor units. */
  monthlyPaymentMinor: number;
};

export type DebtPayoffFailure = "no-payment" | "payment-below-interest" | "beyond-horizon";

export type DebtPayoffProjection =
  | {
      status: "paid-off";
      monthsToPayoff: number;
      totalInterestMinor: number;
      totalPaidMinor: number;
      finalPaymentMinor: number;
    }
  | {
      status: "already-paid-off";
      monthsToPayoff: 0;
      totalInterestMinor: 0;
      totalPaidMinor: 0;
      finalPaymentMinor: 0;
    }
  | {
      status: "never-pays-off";
      reason: DebtPayoffFailure;
      monthlyInterestMinor: number;
    };

export function projectDebtPayoff(input: DebtPayoffInput): DebtPayoffProjection {
  const { balanceMinor, annualRateBps, monthlyPaymentMinor } = input;
  if (
    !Number.isSafeInteger(balanceMinor) ||
    !Number.isSafeInteger(monthlyPaymentMinor) ||
    !Number.isSafeInteger(annualRateBps) ||
    annualRateBps < 0
  ) {
    throw new RangeError("Debt payoff needs integer minor units and a non-negative rate");
  }
  if (balanceMinor <= 0) {
    return {
      status: "already-paid-off",
      monthsToPayoff: 0,
      totalInterestMinor: 0,
      totalPaidMinor: 0,
      finalPaymentMinor: 0,
    };
  }

  const firstInterest = monthlyInterest(balanceMinor, annualRateBps);
  if (monthlyPaymentMinor <= 0) {
    return { status: "never-pays-off", reason: "no-payment", monthlyInterestMinor: firstInterest };
  }
  if (monthlyPaymentMinor <= firstInterest) {
    return {
      status: "never-pays-off",
      reason: "payment-below-interest",
      monthlyInterestMinor: firstInterest,
    };
  }

  let balance = balanceMinor;
  let totalInterest = 0;
  let totalPaid = 0;
  let months = 0;

  while (balance > 0 && months < DEBT_PAYOFF_HORIZON_MONTHS) {
    const interest = monthlyInterest(balance, annualRateBps);
    const due = balance + interest;
    const payment = Math.min(monthlyPaymentMinor, due);
    totalInterest += interest;
    totalPaid += payment;
    balance = due - payment;
    months += 1;
  }

  if (balance > 0) {
    return {
      status: "never-pays-off",
      reason: "beyond-horizon",
      monthlyInterestMinor: monthlyInterest(balance, annualRateBps),
    };
  }

  return {
    status: "paid-off",
    monthsToPayoff: months,
    totalInterestMinor: totalInterest,
    totalPaidMinor: totalPaid,
    finalPaymentMinor: totalPaid - (months - 1) * monthlyPaymentMinor,
  };
}

function monthlyInterest(balanceMinor: number, annualRateBps: number): number {
  const numerator = BigInt(balanceMinor) * BigInt(annualRateBps) + INTEREST_ROUNDING;
  return Number(numerator / INTEREST_DENOMINATOR);
}
