import { BarChart3, CalendarClock, LayoutGrid, ListFilter, Tags, Wallet } from "lucide-react";

import type { View } from "../store/uiStore";

/**
 * The one registry of Budget's surfaces.
 *
 * The rail, the bar's view menu and the phone's primary tabs all read this, so a view's label and
 * glyph are written once. The split is by where a surface is reached, not by what it is: the three
 * everyday views lead, the lower-frequency tools sit in the rail's Tools section and the phone's
 * sheet.
 */
export const PRIMARY_VIEWS = [
  { id: "plan", label: "Plan", icon: LayoutGrid },
  { id: "accounts", label: "Accounts", icon: Wallet },
  { id: "reports", label: "Reports", icon: BarChart3 },
] as const satisfies readonly { id: View; label: string; icon: typeof LayoutGrid }[];

export const TOOL_VIEWS = [
  { id: "schedules", label: "Schedules", icon: CalendarClock },
  { id: "payees", label: "Payees", icon: Tags },
  { id: "rules", label: "Rules", icon: ListFilter },
] as const satisfies readonly { id: View; label: string; icon: typeof LayoutGrid }[];

/** Every surface's name, so a trigger tells the truth while a Tools view is open. */
export const VIEW_CHROME: Record<View, { label: string; icon: typeof LayoutGrid }> = {
  plan: { label: "Plan", icon: LayoutGrid },
  accounts: { label: "Accounts", icon: Wallet },
  reports: { label: "Reports", icon: BarChart3 },
  rules: { label: "Rules", icon: ListFilter },
  schedules: { label: "Schedules", icon: CalendarClock },
  payees: { label: "Payees", icon: Tags },
};
