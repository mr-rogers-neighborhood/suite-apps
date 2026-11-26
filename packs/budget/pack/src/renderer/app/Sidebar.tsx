import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { type Account, formatMoney } from "@suite/budget-core";
import { Button, ListView, PrivacyLine } from "@suite/ui";
import { ChevronDown, Download, Plus } from "lucide-react";
import { useState } from "react";
import { IconButton } from "../components/IconButton";
import { useReplica, useWorkspaceSnapshot } from "../store/snapshotStore";
import { useUiStore } from "../store/uiStore";
import { BudgetMark } from "./BudgetMark";
import { PRIMARY_VIEWS, TOOL_VIEWS } from "./views";

/**
 * The rail's content.
 *
 * `AppShell` owns the desktop column and its landmark; this file owns what Budget puts in it: the
 * budget's name, the three everyday views, the accounts, the tools and the export footer. The view
 * lists are the shared `ListView`, so arrow keys, Home/End and Enter work the same way they do in
 * every other pack.
 */
export function Sidebar({
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
  const setView = useUiStore((state) => state.setView);
  const selectAccount = useUiStore((state) => state.selectAccount);
  const selectedAccountId = useUiStore((state) => state.selectedAccountId);
  const setAccountDialog = useUiStore((state) => state.setAccountDialog);
  const [showClosed, setShowClosed] = useState(false);

  const scale = snapshot.settings.currencyScale;
  const currency = snapshot.settings.currency;
  const open = snapshot.accounts.filter((account) => !account.closedAt);
  const closed = snapshot.accounts.filter((account) => account.closedAt);
  const onBudget = open.filter((account) => account.onBudget);
  const offBudget = open.filter((account) => !account.onBudget);

  const money = (account: Account): string =>
    formatMoney(replica.document.accountBalance(account.id), currency, undefined, scale);

  const accountItems = (accounts: readonly Account[]) =>
    accounts.map((account) => ({
      id: account.id,
      content: (
        <span className="flex w-full items-center justify-between gap-2">
          <span className="min-w-0 truncate text-[12px] text-ink">{account.name}</span>
          <span
            className={
              account.closedAt
                ? "tnum shrink-0 text-[11px] text-faint"
                : "tnum shrink-0 text-[11px] text-muted"
            }
          >
            {money(account)}
          </span>
        </span>
      ),
    }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2.5 px-1 pb-4 pt-5">
        <BudgetMark size="sm" />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold tracking-tight text-ink">
            {snapshot.meta.name}
          </p>
          <p className="text-[10px] text-faint">Suite Budget</p>
        </div>
      </div>

      <ListView
        label="Views"
        items={PRIMARY_VIEWS.map((destination) => {
          const Icon = destination.icon;
          return {
            id: destination.id,
            content: (
              <span className="flex items-center gap-2.5">
                <Icon size={15} />
                {destination.label}
              </span>
            ),
          };
        })}
        selectedId={view}
        onSelect={(id) => setView(id as (typeof PRIMARY_VIEWS)[number]["id"])}
      />

      <div className="mt-4 flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-faint">On budget</p>
          <IconButton
            label="Add account"
            icon={<Plus size={14} />}
            onClick={() => setAccountDialog(true)}
          />
        </div>
        <div className="scroll mt-1 min-h-0 overflow-y-auto">
          {onBudget.length > 0 ? (
            <ListView
              label="On budget accounts"
              items={accountItems(onBudget)}
              selectedId={selectedAccountId}
              onSelect={selectAccount}
            />
          ) : null}
          {offBudget.length > 0 ? (
            <div className="mt-3">
              <p className="px-2 text-[10px] font-semibold uppercase tracking-wider text-faint">
                Off budget
              </p>
              <ListView
                label="Off budget accounts"
                items={accountItems(offBudget)}
                selectedId={selectedAccountId}
                onSelect={selectAccount}
              />
            </div>
          ) : null}
          {closed.length > 0 ? (
            <div className="mt-3">
              <button
                type="button"
                aria-expanded={showClosed}
                onClick={() => setShowClosed((value) => !value)}
                className="flex w-full items-center gap-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-faint hover:text-muted"
              >
                <ChevronDown size={12} className={showClosed ? "" : "-rotate-90"} />
                Closed ({closed.length})
              </button>
              {showClosed ? (
                <ListView
                  label="Closed accounts"
                  items={accountItems(closed)}
                  selectedId={selectedAccountId}
                  onSelect={selectAccount}
                />
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="mt-4 border-t border-line pt-2">
          <p className="px-2 text-[10px] font-semibold uppercase tracking-wider text-faint">
            Tools
          </p>
          <ListView
            label="Tools"
            items={TOOL_VIEWS.map((destination) => {
              const Icon = destination.icon;
              return {
                id: destination.id,
                content: (
                  <span className="flex items-center gap-2.5">
                    <Icon size={15} />
                    {destination.label}
                  </span>
                ),
              };
            })}
            selectedId={view}
            onSelect={(id) => setView(id as (typeof TOOL_VIEWS)[number]["id"])}
          />
        </div>
      </div>

      <div className="space-y-2 border-t border-line p-3">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button size="sm" className="w-full">
              <Download size={13} />
              Export
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              side="top"
              align="start"
              sideOffset={6}
              className="z-50 min-w-48 rounded-lg border border-line bg-panel p-1 shadow-xl"
            >
              <Item onSelect={onExportBudget}>Budget file (.budget)</Item>
              <DropdownMenu.Separator className="my-1 h-px bg-line" />
              <Item onSelect={() => onExportRecords("json")}>Records (JSON)</Item>
              <Item onSelect={() => onExportRecords("csv")}>Transactions (CSV)</Item>
              <Item onSelect={() => onExportRecords("qif")}>Transactions (QIF)</Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <Button size="sm" className="w-full" onClick={onCloseBudget}>
          All budgets
        </Button>
        <PrivacyLine className="px-1" />
      </div>
    </div>
  );
}

function Item({ children, onSelect }: { children: string; onSelect: () => void }) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className="cursor-default select-none rounded-md px-2 py-1.5 text-[12px] text-ink outline-none data-[highlighted]:bg-raised"
    >
      {children}
    </DropdownMenu.Item>
  );
}
