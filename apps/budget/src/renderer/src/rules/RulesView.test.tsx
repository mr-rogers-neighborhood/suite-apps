import { type BudgetBridge, BudgetDocument } from "@suite/budget-core";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentReplica, WorkspaceContext } from "../store/snapshotStore";
import { useUiStore } from "../store/uiStore";
import { RulesView } from "./RulesView";

const NOW = new Date(2026, 2, 15, 12, 0, 0, 0);

function setup() {
  const doc = BudgetDocument.create({ name: "Rules", currency: "USD", now: NOW });
  const checking = doc.createAccount({ name: "Checking", type: "checking" }, NOW);
  const savings = doc.createAccount({ name: "Savings", type: "savings" }, NOW);
  const group = doc.createCategoryGroup({ name: "Everyday" }, NOW);
  const food = doc.createCategory({ groupId: group.id, name: "Food" }, NOW);
  return { doc, checking, savings, food, replica: new DocumentReplica(doc) };
}

describe("run rules", () => {
  const commit = vi.fn(async () => undefined);
  let replica: DocumentReplica | null = null;

  beforeEach(() => {
    commit.mockClear();
    window.suiteBudget = { commit } as unknown as BudgetBridge;
    useUiStore.setState({ notice: null });
  });

  afterEach(() => {
    replica?.dispose();
    replica = null;
    delete window.suiteBudget;
  });

  it("should never put a category on an internal transfer", () => {
    const fixture = setup();
    replica = fixture.replica;
    const [from, to] = fixture.doc.createTransfer(
      {
        fromAccount: fixture.checking,
        toAccount: fixture.savings,
        date: "2026-03-10",
        amountMinor: 10_000,
      },
      NOW,
    );
    fixture.doc.createRule(
      {
        conditions: [{ field: "payee", op: "is", value: "Savings" }],
        actions: [{ field: "setCategory", value: fixture.food.id }],
      },
      NOW,
    );

    render(
      <WorkspaceContext.Provider value={fixture.replica}>
        <RulesView />
      </WorkspaceContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Run rules" }));

    expect(fixture.doc.getTransaction(from.id)?.categoryId).toBeNull();
    expect(fixture.doc.getTransaction(to.id)?.categoryId).toBeNull();
  });

  it("should categorize an ordinary row and skip the run when nothing matches", () => {
    const fixture = setup();
    replica = fixture.replica;
    const transaction = fixture.doc.createTransaction(
      {
        accountId: fixture.checking.id,
        date: "2026-03-11",
        amountMinor: -1_500,
        payeeName: "Market",
      },
      NOW,
    );
    fixture.doc.createRule(
      {
        conditions: [{ field: "payee", op: "is", value: "market" }],
        actions: [{ field: "setCategory", value: fixture.food.id }],
      },
      NOW,
    );

    render(
      <WorkspaceContext.Provider value={fixture.replica}>
        <RulesView />
      </WorkspaceContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Run rules" }));
    expect(fixture.doc.getTransaction(transaction.id)?.categoryId).toBe(fixture.food.id);

    fireEvent.click(screen.getByRole("button", { name: "Run rules" }));
    expect(useUiStore.getState().notice?.message).toBe("Rules made no changes");
  });
});
