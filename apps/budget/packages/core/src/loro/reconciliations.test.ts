import { describe, expect, it } from "vitest";

import { BudgetDocument } from "./BudgetDocument";

const NOW = new Date(2026, 1, 1, 12, 0, 0, 0);

function setup() {
  const doc = BudgetDocument.create({ name: "Reconcile", currency: "USD", now: NOW });
  const account = doc.createAccount(
    {
      name: "Checking",
      type: "checking",
      startingBalanceMinor: 100_000,
      startingDate: "2026-01-01",
    },
    NOW,
  );
  const uncleared = doc.createTransaction(
    {
      accountId: account.id,
      date: "2026-01-05",
      amountMinor: -30_000,
      categoryId: null,
      payeeName: "Groceries",
    },
    NOW,
  );
  const cleared = doc.createTransaction(
    {
      accountId: account.id,
      date: "2026-01-08",
      amountMinor: -20_000,
      categoryId: null,
      payeeName: "Fuel",
      cleared: "cleared",
    },
    NOW,
  );
  return { doc, account, uncleared, cleared };
}

describe("clearedBalance", () => {
  it("should count only cleared and reconciled rows through the date", () => {
    const { doc, account, uncleared, cleared } = setup();

    // Starting balance 100,000 is cleared; the fuel row is cleared; groceries is not.
    expect(doc.clearedBalance(account.id, "2026-01-31")).toBe(80_000);
    expect(doc.clearedBalance(account.id, "2026-01-06")).toBe(100_000);

    doc.toggleCleared(uncleared.id, NOW);
    expect(doc.clearedBalance(account.id, "2026-01-31")).toBe(50_000);
    expect(doc.getTransaction(cleared.id)?.cleared).toBe("cleared");
  });

  it("should exclude split children, which their parent already totals", () => {
    const { doc, account } = setup();
    doc.createSplit(
      {
        accountId: account.id,
        date: "2026-01-20",
        payeeName: "Store",
        cleared: "cleared",
        splits: [
          { categoryId: null, amountMinor: -10_000 },
          { categoryId: null, amountMinor: -5_000 },
        ],
      },
      NOW,
    );

    expect(doc.clearedBalance(account.id, "2026-01-31")).toBe(65_000);
  });
});

describe("reconcileAccount", () => {
  it("should mark cleared rows reconciled and create no adjustment at zero difference", () => {
    const { doc, account, uncleared, cleared } = setup();

    const result = doc.reconcileAccount(
      { accountId: account.id, statementDate: "2026-01-31", statementBalanceMinor: 80_000 },
      NOW,
    );

    expect(result.adjustment).toBeNull();
    expect(doc.listReconciliations()).toHaveLength(1);
    expect(doc.getTransaction(cleared.id)?.cleared).toBe("reconciled");
    expect(doc.getTransaction(uncleared.id)?.cleared).toBe("uncleared");
    expect(doc.clearedBalance(account.id, "2026-01-31")).toBe(80_000);
  });

  it("should post the difference as a cleared balance adjustment", () => {
    const { doc, account } = setup();

    const result = doc.reconcileAccount(
      { accountId: account.id, statementDate: "2026-01-31", statementBalanceMinor: 75_000 },
      NOW,
    );

    expect(result.adjustment).toMatchObject({
      accountId: account.id,
      date: "2026-01-31",
      amountMinor: -5_000,
      payeeName: "Reconciliation Balance Adjustment",
      categoryId: "rta",
    });
    expect(result.adjustment && doc.getTransaction(result.adjustment.id)?.cleared).toBe(
      "reconciled",
    );
    expect(doc.clearedBalance(account.id, "2026-01-31")).toBe(75_000);
    expect(result.reconciliation.adjustmentTransactionId).toBe(result.adjustment?.id ?? null);
  });

  it("should refuse an account that does not exist", () => {
    const { doc } = setup();

    expect(() =>
      doc.reconcileAccount(
        { accountId: "acct_missing", statementDate: "2026-01-31", statementBalanceMinor: 0 },
        NOW,
      ),
    ).toThrow(/does not exist/u);
  });
});

describe("unlockReconciliation", () => {
  it("should return reconciled rows to cleared and remove the record", () => {
    const { doc, account, uncleared, cleared } = setup();
    const { reconciliation } = doc.reconcileAccount(
      { accountId: account.id, statementDate: "2026-01-31", statementBalanceMinor: 80_000 },
      NOW,
    );
    expect(doc.getTransaction(cleared.id)?.cleared).toBe("reconciled");

    doc.unlockReconciliation(reconciliation.id, NOW);

    expect(doc.getTransaction(cleared.id)?.cleared).toBe("cleared");
    expect(doc.getTransaction(uncleared.id)?.cleared).toBe("uncleared");
    expect(doc.listReconciliations()).toEqual([]);
    expect(doc.clearedBalance(account.id, "2026-01-31")).toBe(80_000);
  });

  it("should refuse an unknown reconciliation", () => {
    const { doc } = setup();

    expect(() => doc.unlockReconciliation("recon_missing", NOW)).toThrow(/does not exist/u);
  });
});

describe("a reconciled row", () => {
  it("should not toggle until the reconciliation is unlocked", () => {
    const { doc, account, cleared } = setup();
    doc.reconcileAccount(
      { accountId: account.id, statementDate: "2026-01-31", statementBalanceMinor: 80_000 },
      NOW,
    );

    expect(() => doc.toggleCleared(cleared.id, NOW)).toThrow(/Unlock the reconciliation/u);
  });
});
