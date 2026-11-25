import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  BarChart3,
  CalendarClock,
  Check,
  ChevronDown,
  LayoutGrid,
  ListFilter,
  Tags,
  Wallet,
} from "lucide-react";

import { useUiStore, type View } from "../store/uiStore";

/** The three surfaces the bar offers; the rail's Tools section keeps the rest. */
const PRIMARY_VIEWS = [
  { id: "plan", label: "Plan", icon: LayoutGrid },
  { id: "accounts", label: "Accounts", icon: Wallet },
  { id: "reports", label: "Reports", icon: BarChart3 },
] as const satisfies readonly { id: View; label: string; icon: typeof LayoutGrid }[];

/** Every surface's name, so the trigger tells the truth while a Tools view is open. */
const VIEW_CHROME: Record<View, { label: string; icon: typeof LayoutGrid }> = {
  plan: { label: "Plan", icon: LayoutGrid },
  accounts: { label: "Accounts", icon: Wallet },
  reports: { label: "Reports", icon: BarChart3 },
  rules: { label: "Rules", icon: ListFilter },
  schedules: { label: "Schedules", icon: CalendarClock },
  payees: { label: "Payees", icon: Tags },
};

/**
 * The bar's navigation takeover.
 *
 * It offers Plan, Accounts and Reports, the same three the rail leads with. Schedules, Payees
 * and Rules stay in the rail's Tools section rather than making the bar a second full index.
 */
export function ViewMenu() {
  const view = useUiStore((state) => state.view);
  const setView = useUiStore((state) => state.setView);
  const active = VIEW_CHROME[view];
  const ActiveIcon = active.icon;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`Switch view (${active.label})`}
          className="flex h-7 min-w-0 max-w-40 items-center gap-1.5 rounded-md border border-line bg-panel px-2 text-[12px] text-ink transition-colors hover:bg-raised"
        >
          <ActiveIcon size={14} />
          <span className="min-w-0 flex-1 truncate text-left">{active.label}</span>
          <ChevronDown size={13} aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 min-w-40 rounded-lg border border-line bg-panel p-1 shadow-xl"
        >
          {PRIMARY_VIEWS.map((destination) => {
            const Icon = destination.icon;
            const current = destination.id === view;
            return (
              <DropdownMenu.Item
                key={destination.id}
                aria-current={current ? "page" : undefined}
                onSelect={() => setView(destination.id)}
                className="flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-ink outline-none data-[highlighted]:bg-raised"
              >
                <Icon size={14} />
                <span className="flex-1">{destination.label}</span>
                {current ? <Check size={13} aria-hidden="true" /> : null}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
