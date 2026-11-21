import { todayKey } from "@suite/planner-core";
import { IconButton, MenuBar } from "@suite/ui";
import { Menu } from "lucide-react";
import { useEffect, useState } from "react";

import { DayCalendar } from "../calendar/DayCalendar";
import { getBridge } from "../platform/bridge";
import { useUiStore } from "../store/uiStore";
import { ThemePicker } from "../theme/ThemePicker";
import { PlannerMark } from "./PlannerMark";
import { Sidebar, SidebarDrawer } from "./Sidebar";
import { ViewMenu } from "./ViewMenu";
import { resolveView, views } from "./views";
import { WorkspaceActions } from "./WorkspaceActions";

/**
 * The shell.
 *
 * The rail is the full navigation; the bar is the compact one. Below `md` the rail becomes the
 * drawer, opened from the bar, and the bar keeps only the mark, the drawer button and the view
 * menu so a phone spends its width on the plan.
 */
export function Shell() {
  const view = useUiStore((state) => state.view);
  const setView = useUiStore((state) => state.setView);
  const setSelectedDate = useUiStore((state) => state.setSelectedDate);
  const [navOpen, setNavOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("Suite Planner");
  const View = resolveView(views, view).component;

  useEffect(() => {
    void getBridge()
      .info()
      .then((info) => {
        const file = info.path.split(/[\\/]/).pop() ?? "";
        const name = file.replace(/\.[^.]+$/, "");
        if (name.length > 0) setWorkspaceName(name);
      })
      .catch(() => setWorkspaceName("Suite Planner"));
  }, []);

  function goToday(): void {
    setView("today");
    setSelectedDate(todayKey());
  }

  return (
    <div className="flex h-screen overflow-hidden bg-canvas text-ink">
      <Sidebar />
      <SidebarDrawer open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MenuBar
          mark={<PlannerMark size="sm" />}
          homeAriaLabel="Go to today"
          onNavigateHome={goToday}
          context={
            <div className="hidden min-w-0 items-center lg:flex">
              <span className="max-w-56 truncate text-[13px] font-medium" title={workspaceName}>
                {workspaceName}
              </span>
            </div>
          }
          navigation={
            <div className="flex min-w-0 items-center gap-1">
              <IconButton
                label="Open navigation"
                className="md:hidden"
                onClick={() => setNavOpen(true)}
              >
                <Menu size={16} />
              </IconButton>
              <ViewMenu />
            </div>
          }
          actions={
            <WorkspaceActions className="hidden items-center gap-2 md:flex" variant="ghost" />
          }
          controls={
            <div className="hidden lg:block">
              <ThemePicker layout="inline" />
            </div>
          }
        />
        <View />
      </div>
      <DayCalendar />
    </div>
  );
}
