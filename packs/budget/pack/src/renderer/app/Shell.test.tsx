import { type BudgetBridge, BudgetDocument } from "@suite/budget-core";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentReplica, WorkspaceContext } from "../store/snapshotStore";
import { useUiStore } from "../store/uiStore";
import { Shell } from "./Shell";

/**
 * The phone's navigation.
 *
 * The desktop rail is `hidden` below `md`, so the bar is the only way between Plan,
 * Accounts and Reports on a phone; the low-frequency tools live in its sheet. jsdom
 * has no layout, so this proves the controls exist, are named, and change the view.
 */
const NOW = new Date(2026, 2, 15, 12, 0, 0, 0);

function setup() {
  const doc = BudgetDocument.create({ name: "Phone", currency: "USD", now: NOW });
  doc.createAccount(
    {
      name: "Checking",
      type: "checking",
      startingBalanceMinor: 100_000,
      startingDate: "2026-03-01",
    },
    NOW,
  );
  return new DocumentReplica(doc);
}

function stubWide(wide: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: wide,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

describe("Budget's phone navigation", () => {
  const commit = vi.fn(async () => undefined);
  let replica: DocumentReplica | null = null;

  beforeEach(() => {
    window.suiteBudget = { commit } as unknown as BudgetBridge;
    useUiStore.setState({
      view: "plan",
      month: "2026-03",
      selectedAccountId: null,
      notice: null,
    });
  });

  afterEach(() => {
    replica?.dispose();
    replica = null;
    delete window.suiteBudget;
    vi.unstubAllGlobals();
  });

  function renderShell() {
    replica = setup();
    render(
      <WorkspaceContext.Provider value={replica}>
        <Shell
          onCloseBudget={() => undefined}
          onExportBudget={() => undefined}
          onExportRecords={() => undefined}
        />
      </WorkspaceContext.Provider>,
    );
    return replica;
  }

  it("names the four primary destinations and marks the current one", () => {
    renderShell();

    const nav = screen.getByTestId("mobile-nav");
    expect(within(nav).getByRole("button", { name: "Plan" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("button", { name: "Accounts" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "Reports" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "Tools" })).toBeInTheDocument();
  });

  it("puts the desktop rail in the shared frame's navigation landmark", () => {
    renderShell();

    const nav = screen.getByRole("navigation", { name: "Sections" });
    expect(within(nav).getByRole("listbox", { name: "Views" })).toBeInTheDocument();
    expect(within(nav).getByRole("option", { name: "Plan" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(nav).getByRole("listbox", { name: "On budget accounts" })).toBeInTheDocument();
    expect(within(nav).getByRole("listbox", { name: "Tools" })).toBeInTheDocument();
  });

  it("switches views and accounts from the desktop rail's listboxes", () => {
    renderShell();

    const nav = screen.getByRole("navigation", { name: "Sections" });
    fireEvent.click(within(nav).getByRole("option", { name: "Reports" }));
    expect(useUiStore.getState().view).toBe("reports");
    expect(screen.getByRole("heading", { level: 1, name: "Reports" })).toBeInTheDocument();

    fireEvent.click(within(nav).getByRole("option", { name: /Checking/u }));
    expect(useUiStore.getState().view).toBe("accounts");
    expect(useUiStore.getState().selectedAccountId).not.toBeNull();
  });

  it("omits the desktop rail below the breakpoint", () => {
    stubWide(false);
    renderShell();

    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull();
    expect(screen.getByTestId("mobile-nav")).toBeInTheDocument();
  });

  it("changes the view from the phone bar", () => {
    renderShell();

    fireEvent.click(within(screen.getByTestId("mobile-nav")).getByRole("button", { name: "Reports" }));

    expect(useUiStore.getState().view).toBe("reports");
    expect(screen.getByRole("heading", { level: 1, name: "Reports" })).toBeInTheDocument();
  });

  it("keeps schedules, payees and rules one tap away in the tools sheet", () => {
    renderShell();

    fireEvent.click(within(screen.getByTestId("mobile-nav")).getByRole("button", { name: "Tools" }));

    const sheet = screen.getByRole("dialog", { name: "Tools" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Schedules" }));
    expect(useUiStore.getState().view).toBe("schedules");

    fireEvent.click(within(screen.getByTestId("mobile-nav")).getByRole("button", { name: "Tools" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Tools" })).getByRole("button", { name: "Payees" }),
    );
    expect(useUiStore.getState().view).toBe("payees");

    fireEvent.click(within(screen.getByTestId("mobile-nav")).getByRole("button", { name: "Tools" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Tools" })).getByRole("button", { name: "Rules" }),
    );
    expect(useUiStore.getState().view).toBe("rules");
  });
});
