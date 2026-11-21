import { type BudgetBridge, BudgetDocument } from "@suite/budget-core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentReplica, WorkspaceContext } from "../store/snapshotStore";
import { useUiStore } from "../store/uiStore";
import { PlanView } from "./PlanView";

const NOW = new Date(2026, 2, 15, 12, 0, 0, 0);

function setup() {
  const doc = BudgetDocument.create({ name: "Plan", currency: "USD", now: NOW });
  const account = doc.createAccount(
    {
      name: "Checking",
      type: "checking",
      startingBalanceMinor: 100_000,
      startingDate: "2026-03-01",
    },
    NOW,
  );
  const group = doc.createCategoryGroup({ name: "Everyday" }, NOW);
  const food = doc.createCategory({ groupId: group.id, name: "Food" }, NOW);
  const rent = doc.createCategory({ groupId: group.id, name: "Rent" }, NOW);
  return { doc, account, group, food, rent, replica: new DocumentReplica(doc) };
}

describe("plan envelope rows", () => {
  const commit = vi.fn(async () => undefined);
  let replica: DocumentReplica | null = null;

  beforeEach(() => {
    commit.mockClear();
    window.suiteBudget = { commit } as unknown as BudgetBridge;
    useUiStore.setState({
      month: "2026-03",
      notice: null,
      targetCategoryId: null,
      moveMoneyOpen: false,
    });
  });

  afterEach(() => {
    replica?.dispose();
    replica = null;
    delete window.suiteBudget;
  });

  it("should keep focus in the grid when Enter commits an assignment", async () => {
    const fixture = setup();
    replica = fixture.replica;

    render(
      <WorkspaceContext.Provider value={fixture.replica}>
        <PlanView />
      </WorkspaceContext.Provider>,
    );

    const food = screen.getByLabelText("Assigned to Food");
    food.focus();
    fireEvent.change(food, { target: { value: "12.34" } });
    fireEvent.keyDown(food, { key: "Enter" });

    await waitFor(() => expect(screen.getByLabelText("Assigned to Rent")).toHaveFocus());
    expect(fixture.doc.assignedFor("2026-03", fixture.food.id)).toBe(1234);
  });

  it("should make the group control's expanded state match its action", () => {
    const fixture = setup();
    replica = fixture.replica;

    render(
      <WorkspaceContext.Provider value={fixture.replica}>
        <PlanView />
      </WorkspaceContext.Provider>,
    );

    const header = screen.getByRole("button", { name: "Everyday" });
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Assigned to Food")).toBeInTheDocument();

    fireEvent.click(header);

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Assigned to Food")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Assigned to Rent")).not.toBeInTheDocument();
  });

  it("should name a row action after the envelope it acts on", () => {
    const fixture = setup();
    replica = fixture.replica;

    render(
      <WorkspaceContext.Provider value={fixture.replica}>
        <PlanView />
      </WorkspaceContext.Provider>,
    );

    expect(screen.getByRole("button", { name: "Actions for Food" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set a target for Rent" })).toBeInTheDocument();
  });
});
