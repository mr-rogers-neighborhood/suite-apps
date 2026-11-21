import { IconButton } from "@suite/ui";
import { Menu } from "lucide-react";
import { useState } from "react";
import { DayCalendar } from "../calendar/DayCalendar";
import { useUiStore } from "../store/uiStore";
import { PlannerMark } from "./PlannerMark";
import { Sidebar, SidebarDrawer } from "./Sidebar";
import { resolveView, views } from "./views";

export function Shell() {
  const view = useUiStore((state) => state.view);
  const [navOpen, setNavOpen] = useState(false);
  const View = resolveView(views, view).component;

  return (
    <div className="flex h-screen overflow-hidden bg-canvas text-ink">
      <Sidebar />
      <SidebarDrawer open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Below `md` the rail becomes this button plus the drawer, so the day view keeps the width. */}
        <header className="flex items-center gap-2.5 border-b border-line bg-panel px-4 py-2 md:hidden">
          <IconButton label="Open navigation" onClick={() => setNavOpen(true)}>
            <Menu size={16} />
          </IconButton>
          <PlannerMark size="sm" />
          <span className="text-[15px] font-semibold tracking-tight">Suite Planner</span>
        </header>
        <View />
      </div>
      <DayCalendar />
    </div>
  );
}
