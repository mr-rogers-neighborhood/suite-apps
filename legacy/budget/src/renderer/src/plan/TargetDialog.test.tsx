import { type BudgetBridge, BudgetDocument } from "@suite/budget-core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentReplica, WorkspaceContext } from "../store/snapshotStore";
import { useUiStore } from "../store/uiStore";
import { TargetDialog } from "./TargetDialog";

function setup(interestRateBps: number) {
  const doc = BudgetDocument.create({
    name: "Test",
    currency: "USD",
    now: new Date("2026-01-01T12:00:00.000Z"),
  });
  const group = doc.createCategoryGroup({ name: "Debt" });
  const category = doc.createCategory({ groupId: group.id, name: "Car loan" });
  const account = doc.createAccount({
    name: "Car loan",
    type: "loan",
    onBudget: false,
    startingBalanceMinor: -120_000,
    startingDate: "2026-01-01",
    loan: {
      originalBalanceMinor: 120_000,
      interestRateBps,
      minimumPaymentMinor: null,
    },
  });
  const replica = new DocumentReplica(doc);
  return { doc, category, account, replica };
}

function renderDialog(replica: DocumentReplica): void {
  render(
    <WorkspaceContext.Provider value={replica}>
      <TargetDialog />
    </WorkspaceContext.Provider>,
  );
}

async function chooseDebtTarget(accountId: string, dueMonth: string): Promise<void> {
  fireEvent.change(await screen.findByLabelText("Target type"), {
    target: { value: "debt_payoff" },
  });
  fireEvent.change(screen.getByLabelText("Account"), { target: { value: accountId } });
  fireEvent.change(screen.getByLabelText("By month"), { target: { value: dueMonth } });
}

describe("TargetDialog debt payoff estimate", () => {
  const commit = vi.fn(async () => undefined);
  let replica: DocumentReplica | null = null;

  beforeEach(() => {
    commit.mockClear();
    window.suiteBudget = { commit } as unknown as BudgetBridge;
  });

  afterEach(() => {
    replica?.dispose();
    replica = null;
    delete window.suiteBudget;
    useUiStore.setState({ targetCategoryId: null });
  });

  it("should show the payoff estimate and keep a zero-interest loan editable", async () => {
    const fixture = setup(0);
    replica = fixture.replica;
    useUiStore.setState({ month: "2026-01", targetCategoryId: fixture.category.id });

    renderDialog(fixture.replica);
    await chooseDebtTarget(fixture.account.id, "2026-12");

    expect(screen.getByText(/Estimated payoff in 12 months/)).toBeInTheDocument();
    expect(screen.getByText(/around December 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Estimated interest \$0\.00/)).toBeInTheDocument();
    expect(screen.getByText(/New charges and rate changes are not modelled/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "500.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save target" }));

    await waitFor(() => {
      expect(fixture.replica.document.activeTarget(fixture.category.id, "2026-01")?.kind).toBe(
        "debt_payoff",
      );
    });
    await waitFor(() => expect(commit).toHaveBeenCalled());
  });

  it("should show interest for a loan with a rate", async () => {
    const fixture = setup(500);
    replica = fixture.replica;
    useUiStore.setState({ month: "2026-01", targetCategoryId: fixture.category.id });

    renderDialog(fixture.replica);
    await chooseDebtTarget(fixture.account.id, "2026-12");

    expect(screen.getByText(/Estimated payoff in 13 months/)).toBeInTheDocument();
    expect(screen.getByText(/Estimated interest \$33\.65/)).toBeInTheDocument();
  });
});
