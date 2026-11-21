import { Button, IconButton, MenuBar } from "@suite/ui";
import { Command, Plus, Redo2, Undo2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { AccountDialog } from "../accounts/AccountDialog";
import { AccountsView } from "../accounts/AccountsView";
import { ReconcileDialog } from "../accounts/ReconcileDialog";
import { TransactionDialog } from "../accounts/TransactionDialog";
import { CommandPalette } from "../command/CommandPalette";
import { ImportWizard } from "../import/ImportWizard";
import { PayeesView } from "../payees/PayeesView";
import { MoveMoneyDialog } from "../plan/MoveMoneyDialog";
import { PlanView } from "../plan/PlanView";
import { TargetDialog } from "../plan/TargetDialog";
import { getBridge } from "../platform/bridge";
import { ReportsView } from "../reports/ReportsView";
import { RulesView } from "../rules/RulesView";
import { SchedulesView } from "../schedules/SchedulesView";
import { useReplica, useWorkspaceSnapshot } from "../store/snapshotStore";
import { useUiStore } from "../store/uiStore";
import { ThemePicker } from "../theme/ThemePicker";
import { BudgetMark } from "./BudgetMark";
import { Sidebar } from "./Sidebar";
import { ViewMenu } from "./ViewMenu";

export function Shell({
  onCloseBudget,
  onExportBudget,
  onExportRecords,
}: {
  onCloseBudget: () => void;
  onExportBudget: () => void;
  onExportRecords: (format: "json" | "csv" | "qif") => void;
}) {
  const snapshot = useWorkspaceSnapshot();
  const replica = useReplica();
  const view = useUiStore((state) => state.view);
  const setPaletteOpen = useUiStore((state) => state.setPaletteOpen);
  const setImportOpen = useUiStore((state) => state.setImportOpen);
  const setNewTransactionOpen = useUiStore((state) => state.setNewTransactionOpen);
  const selectTransaction = useUiStore((state) => state.selectTransaction);
  const setView = useUiStore((state) => state.setView);

  function addTransaction(): void {
    const account =
      snapshot.accounts.find((candidate) => candidate.onBudget && !candidate.closedAt) ??
      snapshot.accounts[0];
    if (account) {
      useUiStore.getState().selectAccount(account.id);
    } else {
      setView("accounts");
    }
    selectTransaction(null);
    setNewTransactionOpen(true);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-canvas text-ink">
      <Sidebar
        onCloseBudget={onCloseBudget}
        onExportBudget={onExportBudget}
        onExportRecords={onExportRecords}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <MenuBar
          mark={<BudgetMark size="sm" />}
          homeAriaLabel="Back to all budgets"
          onNavigateHome={onCloseBudget}
          context={
            <div className="hidden min-w-0 items-center lg:flex">
              <span
                className="max-w-56 truncate text-[13px] font-medium"
                title={snapshot.meta.name}
              >
                {snapshot.meta.name}
              </span>
            </div>
          }
          navigation={
            <div className="hidden min-w-0 items-center md:flex">
              <ViewMenu />
            </div>
          }
          search={
            <button
              type="button"
              data-testid="command-bar"
              aria-label="Search or run a command"
              aria-keyshortcuts="Meta+K Control+K"
              title="Search or run a command (⌘K)"
              onClick={() => setPaletteOpen(true)}
              className="hidden h-7 min-w-0 flex-1 max-w-sm items-center gap-1.5 rounded-md border border-line bg-raised px-2 text-[12px] text-muted transition-colors hover:text-ink md:flex"
            >
              <Command size={13} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-left">Search</span>
              <kbd className="rounded border border-line px-1 py-0.5 text-[10px] opacity-70">
                ⌘K
              </kbd>
            </button>
          }
          actions={
            <div className="flex items-center gap-1">
              <div className="hidden md:block">
                <SaveStatus />
              </div>
              <div className="hidden items-center gap-1 md:flex">
                <IconButton
                  label="Undo"
                  onClick={() => replica.undo()}
                  disabled={!replica.canUndo()}
                >
                  <Undo2 size={15} />
                </IconButton>
                <IconButton
                  label="Redo"
                  onClick={() => replica.redo()}
                  disabled={!replica.canRedo()}
                >
                  <Redo2 size={15} />
                </IconButton>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Import"
                  onClick={() => setImportOpen(true)}
                >
                  <Upload size={13} />
                  <span className="hidden xl:inline">Import</span>
                </Button>
              </div>
              <Button
                size="sm"
                variant="primary"
                aria-label="Add transaction"
                onClick={addTransaction}
              >
                <Plus size={13} />
                <span className="hidden xl:inline">Add transaction</span>
              </Button>
            </div>
          }
          controls={
            <div className="hidden lg:block">
              <ThemePicker layout="inline" />
            </div>
          }
        />

        <main className="scroll min-h-0 flex-1 overflow-y-auto">
          {view === "plan" ? <PlanView /> : null}
          {view === "accounts" ? <AccountsView /> : null}
          {view === "reports" ? <ReportsView /> : null}
          {view === "rules" ? <RulesView /> : null}
          {view === "schedules" ? <SchedulesView /> : null}
          {view === "payees" ? <PayeesView /> : null}
        </main>
      </div>

      <AccountDialog />
      <TransactionDialog />
      <ReconcileDialog />
      <TargetDialog />
      <MoveMoneyDialog />
      <ImportWizard />
      <CommandPalette onCloseBudget={onCloseBudget} />
    </div>
  );
}

function SaveStatus() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const check = async (): Promise<void> => {
      try {
        const info = await getBridge().info();
        if (alive) setError(info.saveError ?? null);
      } catch {
        // No open budget yet; the next tick tries again.
      }
    };
    void check();
    const timer = setInterval(() => void check(), 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (!error) return null;
  return (
    <span role="alert" title={error} className="mr-1 text-[11px] text-danger">
      Save failed
    </span>
  );
}
