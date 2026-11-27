import { todayKey } from "@suite/planner-core";
import { AppShell, IconButton, MenuBar, type MenuBarBridge, menuBarBridge } from "@suite/ui";
import { Menu } from "lucide-react";
import { type CSSProperties, useEffect, useState } from "react";

import { DayCalendar } from "../calendar/DayCalendar";
import { getBridge } from "../platform/bridge";
import { useUiStore } from "../store/uiStore";
import { SyncControl } from "../sync/SyncControl";
import { usePlannerMenuBar } from "./menuBar";
import { PlannerMark } from "./PlannerMark";
import { Sidebar, SidebarDrawer } from "./Sidebar";
import { useWideViewport } from "./useWideViewport";
import { ViewMenu } from "./ViewMenu";
import { resolveView, views } from "./views";
import { WorkspaceActions } from "./WorkspaceActions";

/**
 * The shell.
 *
 * `AppShell` owns the frame: the bar, the desktop rail column and the content region. Planner
 * supplies the bar, the rail's content and the view. The rail is the full navigation; the bar's
 * view menu is the compact one. Below `md` the rail is a drawer, opened from the bar, so the
 * shared shell is asked for no navigation at all and a phone keeps its width for the plan.
 *
 * Under a host there is no bar here: the host draws the one physical bar from the slots this
 * pack publishes. A standalone window still gets Planner's own `MenuBar`.
 */
export function Shell() {
  const view = useUiStore((state) => state.view);
  const setView = useUiStore((state) => state.setView);
  const setSelectedDate = useUiStore((state) => state.setSelectedDate);
  const [navOpen, setNavOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("Suite Planner");
  const [hosted] = useState<MenuBarBridge | null>(() => menuBarBridge(globalThis));
  const wide = useWideViewport();
  const View = resolveView(views, view).component;
  usePlannerMenuBar(hosted, { showNav: !wide, onOpenNav: () => setNavOpen(true) });

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
      <AppShell
        {...(hosted === null
          ? {
              header: (
                <MenuBar
                  mark={<PlannerMark size="sm" />}
                  homeAriaLabel="Go to today"
                  onNavigateHome={goToday}
                  context={
                    <div className="hidden min-w-0 items-center lg:flex">
                      <span
                        className="max-w-56 truncate text-[13px] font-medium"
                        title={workspaceName}
                      >
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
                    <WorkspaceActions
                      className="hidden items-center gap-2 md:flex"
                      variant="ghost"
                    />
                  }
                  sync={<SyncControl />}
                />
              ),
            }
          : {})}
        navigation={wide ? <Sidebar /> : undefined}
        navigationLabel="Primary"
        navigationClassName="bg-panel"
        style={{ "--shell-nav-width": "228px" } as CSSProperties}
        className="min-w-0 flex-1"
      >
        <div className="flex h-full min-h-0 flex-col">
          <View />
        </div>
      </AppShell>
      <DayCalendar />
      <SidebarDrawer open={navOpen} onClose={() => setNavOpen(false)} />
    </div>
  );
}
