import { type BudgetBridge, BudgetDocument } from "@suite/budget-core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentReplica, WorkspaceContext } from "../store/snapshotStore";
import { ScheduleAutoEnterNotice } from "./ScheduleAutoEnterNotice";
import { SchedulesView } from "./SchedulesView";

const NOW = new Date(2026, 2, 15, 12, 0, 0, 0);

function setup() {
  const doc = BudgetDocument.create({ name: "Test", currency: "USD", now: NOW });
  const account = doc.createAccount({ name: "Checking", type: "checking" }, NOW);
  const group = doc.createCategoryGroup({ name: "Bills" }, NOW);
  const category = doc.createCategory({ groupId: group.id, name: "Rent" }, NOW);
  const replica = new DocumentReplica(doc);
  return { doc, account, category, replica };
}

describe("schedule auto-enter UI", () => {
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
  });

  it("should explain the per-schedule choice and save the checkbox", async () => {
    const fixture = setup();
    replica = fixture.replica;

    render(
      <WorkspaceContext.Provider value={fixture.replica}>
        <SchedulesView />
      </WorkspaceContext.Provider>,
    );

    expect(
      screen.getByText(/A schedule adds its transaction automatically only when/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Add schedule" })[0] as HTMLElement);
    const checkbox = await screen.findByLabelText("Automatically add transaction");
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "100.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));

    await waitFor(() => {
      expect(fixture.doc.listSchedules()[0]?.autoEnter).toBe(true);
    });
    expect(fixture.doc.listSchedules()[0]?.amountMinor).toBe(-10_000);
    await waitFor(() => expect(commit).toHaveBeenCalled());
  });

  it("should show the batch total and undo it", async () => {
    const fixture = setup();
    replica = fixture.replica;
    const schedule = fixture.doc.createSchedule(
      {
        accountId: fixture.account.id,
        categoryId: fixture.category.id,
        payeeName: "Landlord",
        amountMinor: -100_000,
        frequency: "monthly",
        anchorDate: "2026-01-15",
        autoEnter: true,
      },
      NOW,
    );
    fixture.doc.updateSchedule(schedule.id, { nextDate: "2026-01-15" }, NOW);
    fixture.doc.autoEnterSchedules(NOW);

    render(
      <WorkspaceContext.Provider value={fixture.replica}>
        <ScheduleAutoEnterNotice />
      </WorkspaceContext.Provider>,
    );

    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("Added 3 scheduled transactions");
    expect(notice).toHaveTextContent("3,000.00");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(fixture.doc.listTransactions()).toEqual([]);
    expect(fixture.doc.listSchedules()[0]?.nextDate).toBe("2026-01-15");
  });
});
