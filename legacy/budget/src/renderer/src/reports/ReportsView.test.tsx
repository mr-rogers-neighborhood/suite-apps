import { type BudgetBridge, BudgetDocument, dateKey, monthKeyOfDate } from "@suite/budget-core";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentReplica, WorkspaceContext } from "../store/snapshotStore";
import { useUiStore } from "../store/uiStore";
import { ReportsView } from "./ReportsView";

const NOW = new Date();

function setup() {
  const doc = BudgetDocument.create({ name: "Reports", currency: "USD", now: NOW });
  const account = doc.createAccount(
    {
      name: "Checking",
      type: "checking",
      startingBalanceMinor: 100_000,
      startingDate: "2026-01-01",
    },
    NOW,
  );
  const group = doc.createCategoryGroup({ name: "Everyday" }, NOW);
  const food = doc.createCategory({ groupId: group.id, name: "Food" }, NOW);
  const date = dateKey(NOW.getFullYear(), NOW.getMonth() + 1, Math.min(NOW.getDate(), 28));
  doc.createTransaction(
    {
      accountId: account.id,
      date,
      amountMinor: -12_345,
      categoryId: food.id,
      payeeName: "Market",
    },
    NOW,
  );
  doc.setAssigned(monthKeyOfDate(NOW), food.id, 20_000, NOW);
  return { doc, replica: new DocumentReplica(doc) };
}

describe("reports view", () => {
  const commit = vi.fn(async () => undefined);
  let replica: DocumentReplica | null = null;

  beforeEach(() => {
    commit.mockClear();
    window.suiteBudget = { commit } as unknown as BudgetBridge;
    useUiStore.setState({ month: monthKeyOfDate(NOW), notice: null });
  });

  afterEach(() => {
    replica?.dispose();
    replica = null;
    delete window.suiteBudget;
  });

  function renderReports() {
    const fixture = setup();
    replica = fixture.replica;
    render(
      <WorkspaceContext.Provider value={fixture.replica}>
        <ReportsView />
      </WorkspaceContext.Provider>,
    );
    return fixture;
  }

  it("should name the page and label the range control", () => {
    renderReports();

    expect(screen.getByRole("heading", { level: 1, name: "Reports" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Report range" })).toHaveValue("6m");
  });

  it("should expose a tab's selected state and the view it opens", () => {
    renderReports();

    const spending = screen.getByRole("button", { name: "Spending" });
    expect(spending).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(spending);

    expect(spending).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Spending by category" })).toBeInTheDocument();
    expect(screen.getAllByText("Food").length).toBeGreaterThan(0);
  });

  it("should give a report chart a name and a data table", () => {
    renderReports();

    fireEvent.click(screen.getByRole("button", { name: "Net worth" }));

    expect(screen.getByRole("img", { name: "Net worth over time" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Data table"));
    expect(screen.getAllByRole("columnheader", { name: /Period|Value/ })).toHaveLength(2);
  });

  it("should expose the budget-vs-actual figures as a table", () => {
    renderReports();

    fireEvent.click(screen.getByRole("button", { name: "Budget vs actual" }));

    const table = screen.getByRole("table", { name: "Budget vs actual" });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(4);
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(2);
    expect(within(rows[1] as HTMLElement).getAllByRole("cell")).toHaveLength(4);
    expect(within(table).getByRole("cell", { name: /Food/ })).toBeInTheDocument();
  });
});
