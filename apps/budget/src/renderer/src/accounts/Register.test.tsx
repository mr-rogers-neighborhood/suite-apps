import { type BudgetBridge, BudgetDocument } from "@suite/budget-core";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentReplica, WorkspaceContext } from "../store/snapshotStore";
import { useUiStore } from "../store/uiStore";
import { Register } from "./Register";

const NOW = new Date(2026, 2, 15, 12, 0, 0, 0);

function setup() {
  const doc = BudgetDocument.create({ name: "Register", currency: "USD", now: NOW });
  const account = doc.createAccount(
    {
      name: "Checking",
      type: "checking",
      startingBalanceMinor: 100_000,
      startingDate: "2026-01-01",
    },
    NOW,
  );
  const transaction = doc.createTransaction(
    {
      accountId: account.id,
      date: "2026-01-05",
      amountMinor: -25_000,
      categoryId: null,
      payeeName: "Market",
    },
    NOW,
  );
  return { doc, account, transaction, replica: new DocumentReplica(doc) };
}

describe("register row", () => {
  const commit = vi.fn(async () => undefined);
  let replica: DocumentReplica | null = null;

  beforeEach(() => {
    commit.mockClear();
    window.suiteBudget = { commit } as unknown as BudgetBridge;
    useUiStore.setState({ newTransactionOpen: false, selectedTransactionId: null });
  });

  afterEach(() => {
    replica?.dispose();
    replica = null;
    delete window.suiteBudget;
  });

  it("should not open the editor when a key lands on the cleared control", () => {
    const fixture = setup();
    replica = fixture.replica;

    render(
      <WorkspaceContext.Provider value={fixture.replica}>
        <Register account={fixture.account} />
      </WorkspaceContext.Provider>,
    );

    fireEvent.keyDown(screen.getByTitle("Mark cleared"), { key: "Enter" });

    expect(useUiStore.getState().newTransactionOpen).toBe(false);
    expect(useUiStore.getState().selectedTransactionId).toBeNull();
  });

  it("should toggle cleared and report the state as pressed", () => {
    const fixture = setup();
    replica = fixture.replica;

    render(
      <WorkspaceContext.Provider value={fixture.replica}>
        <Register account={fixture.account} />
      </WorkspaceContext.Provider>,
    );

    const toggle = screen.getByTitle("Mark cleared");
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);

    expect(fixture.doc.getTransaction(fixture.transaction.id)?.cleared).toBe("cleared");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });
});
