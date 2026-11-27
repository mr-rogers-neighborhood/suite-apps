import { AppShell, Button, IconButton, MenuBar, type MenuBarBridge, menuBarBridge, PrivacyLine } from "@suite/ui";
import {
  BarChart3,
  CalendarClock,
  Command,
  Download,
  LayoutGrid,
  ListFilter,
  MoreHorizontal,
  Plus,
  Redo2,
  Tags,
  Undo2,
  Upload,
  Wallet,
} from "lucide-react";
import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { AccountDialog } from "../accounts/AccountDialog";
import { AccountsView } from "../accounts/AccountsView";
import { ReconcileDialog } from "../accounts/ReconcileDialog";
import { TransactionDialog } from "../accounts/TransactionDialog";
import { CommandPalette } from "../command/CommandPalette";
import { Modal } from "../components/Modal";
import { ImportWizard } from "../import/ImportWizard";
import { PayeesView } from "../payees/PayeesView";
import { MoveMoneyDialog } from "../plan/MoveMoneyDialog";
import { PlanView } from "../plan/PlanView";
import { TargetDialog } from "../plan/TargetDialog";
import { getBridge } from "../platform/bridge";
import { ReportsView } from "../reports/ReportsView";
import { RulesView } from "../rules/RulesView";
import { ScheduleAutoEnterNotice } from "../schedules/ScheduleAutoEnterNotice";
import { SchedulesView } from "../schedules/SchedulesView";
import { useReplica, useWorkspaceSnapshot } from "../store/snapshotStore";
import { useUiStore, type View } from "../store/uiStore";
import { BudgetMark } from "./BudgetMark";
import { useBudgetMenuBar } from "./menuBar";
import { Sidebar } from "./Sidebar";
import { useWideViewport } from "./useWideViewport";
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
  const wide = useWideViewport();
  const [hosted] = useState<MenuBarBridge | null>(() => menuBarBridge(globalThis));

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

  useBudgetMenuBar(hosted, {
    onOpenPalette: () => setPaletteOpen(true),
    onAddTransaction: addTransaction,
  });

  return (
    <>
      <div className="flex h-[100dvh] flex-col overflow-hidden bg-canvas text-ink">
        <AppShell
          {...(hosted === null
            ? {
                header: (
                  <>
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
                    />
                    <ScheduleAutoEnterNotice />
                  </>
                ),
              }
            : {})}
          navigation={
            wide ? (
              <Sidebar
                onCloseBudget={onCloseBudget}
                onExportBudget={onExportBudget}
                onExportRecords={onExportRecords}
              />
            ) : undefined
          }
          navigationLabel="Sections"
          navigationClassName="bg-panel"
          style={{ "--shell-nav-width": "236px" } as CSSProperties}
          className="min-h-0 flex-1"
        >
          {view === "plan" ? <PlanView /> : null}
          {view === "accounts" ? <AccountsView /> : null}
          {view === "reports" ? <ReportsView /> : null}
          {view === "rules" ? <RulesView /> : null}
          {view === "schedules" ? <SchedulesView /> : null}
          {view === "payees" ? <PayeesView /> : null}
        </AppShell>

        <MobileNav
          view={view}
          onSelect={setView}
          onImport={() => setImportOpen(true)}
          onExportBudget={onExportBudget}
          onExportRecords={onExportRecords}
          onCloseBudget={onCloseBudget}
        />
      </div>

      <AccountDialog />
      <TransactionDialog />
      <ReconcileDialog />
      <TargetDialog />
      <MoveMoneyDialog />
      <ImportWizard />
      <CommandPalette onCloseBudget={onCloseBudget} />
    </>
  );
}

/**
 * The phone's primary navigation.
 *
 * The desktop rail is hidden below `md`; this bar covers the four places a person
 * moves between on a phone and puts the lower-frequency tools, import and export
 * behind one sheet, so the register keeps the width it needs.
 */
function MobileNav({
  view,
  onSelect,
  onImport,
  onExportBudget,
  onExportRecords,
  onCloseBudget,
}: {
  view: View;
  onSelect: (view: View) => void;
  onImport: () => void;
  onExportBudget: () => void;
  onExportRecords: (format: "json" | "csv" | "qif") => void;
  onCloseBudget: () => void;
}) {
  const [toolsOpen, setToolsOpen] = useState(false);

  const go = (next: View): void => {
    onSelect(next);
    setToolsOpen(false);
  };

  return (
    <>
      <nav
        aria-label="Primary"
        data-testid="mobile-nav"
        className="grid shrink-0 grid-cols-4 border-t border-line bg-panel pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <MobileTab
          active={view === "plan"}
          icon={<LayoutGrid size={18} />}
          label="Plan"
          onClick={() => onSelect("plan")}
        />
        <MobileTab
          active={view === "accounts"}
          icon={<Wallet size={18} />}
          label="Accounts"
          onClick={() => onSelect("accounts")}
        />
        <MobileTab
          active={view === "reports"}
          icon={<BarChart3 size={18} />}
          label="Reports"
          onClick={() => onSelect("reports")}
        />
        <MobileTab
          active={view === "rules" || view === "schedules" || view === "payees"}
          icon={<MoreHorizontal size={18} />}
          label="Tools"
          onClick={() => setToolsOpen(true)}
        />
      </nav>

      <Modal
        open={toolsOpen}
        onOpenChange={setToolsOpen}
        title="Tools"
        footer={
          <Button
            onClick={() => {
              onCloseBudget();
              setToolsOpen(false);
            }}
          >
            All budgets
          </Button>
        }
      >
        <div className="grid gap-2">
          <Button className="justify-start" onClick={() => go("schedules")}>
            <CalendarClock size={14} />
            Schedules
          </Button>
          <Button className="justify-start" onClick={() => go("payees")}>
            <Tags size={14} />
            Payees
          </Button>
          <Button className="justify-start" onClick={() => go("rules")}>
            <ListFilter size={14} />
            Rules
          </Button>
          <Button
            className="justify-start"
            onClick={() => {
              onImport();
              setToolsOpen(false);
            }}
          >
            <Upload size={14} />
            Import
          </Button>
          <Button
            className="justify-start"
            onClick={() => {
              onExportBudget();
              setToolsOpen(false);
            }}
          >
            <Download size={14} />
            Export budget
          </Button>
          <Button
            className="justify-start"
            onClick={() => {
              onExportRecords("csv");
              setToolsOpen(false);
            }}
          >
            <Download size={14} />
            Transactions (CSV)
          </Button>
          <Button
            className="justify-start"
            onClick={() => {
              onExportRecords("qif");
              setToolsOpen(false);
            }}
          >
            <Download size={14} />
            Transactions (QIF)
          </Button>
          <PrivacyLine className="mt-1" />
        </div>
      </Modal>
    </>
  );
}

function MobileTab({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-ink"
          : "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] text-muted transition-colors hover:text-ink"
      }
    >
      {icon}
      <span>{label}</span>
    </button>
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
