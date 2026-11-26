import { todayKey } from "@suite/planner-core";
import { IconButton, ListView, Modal, PrivacyLine } from "@suite/ui";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { getBridge } from "../platform/bridge";
import { useUiStore } from "../store/uiStore";
import { PlannerMark } from "./PlannerMark";
import { views } from "./views";
import { WorkspaceActions } from "./WorkspaceActions";

/**
 * The rail's content.
 *
 * `AppShell` owns the desktop column and its landmark; this file owns what Planner puts in it:
 * the brand, the view list and the workspace footer. Below `md` the same content is a drawer,
 * opened from the shell's phone header, so a phone spends its width on the plan.
 */
export function Sidebar() {
  return <Rail />;
}

/** The same navigation as a drawer, opened from the shell's phone header. */
export function SidebarDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      label="Navigation"
      className="mr-auto h-full max-h-none w-[min(272px,85vw)] rounded-none border-y-0 border-l-0 p-0"
    >
      <Rail onNavigate={onClose} onClose={onClose} />
    </Modal>
  );
}

function Rail({
  onNavigate,
  onClose,
}: {
  /** Called after a destination is chosen, so the drawer gets out of the way. */
  onNavigate?: () => void;
  /** When given, the header shows a close button; the desktop rail does not need one. */
  onClose?: () => void;
}) {
  const view = useUiStore((state) => state.view);
  const setView = useUiStore((state) => state.setView);
  const setSelectedDate = useUiStore((state) => state.setSelectedDate);
  const [workspacePath, setWorkspacePath] = useState<string>("");

  useEffect(() => {
    void getBridge()
      .info()
      .then((info) => setWorkspacePath(info.path))
      .catch(() => setWorkspacePath(""));
  }, []);

  const destinations = Object.values(views);
  const items = destinations.map((destination) => {
    const Icon = destination.icon;
    return {
      id: destination.id,
      content: (
        <span className="flex items-center gap-2.5">
          <Icon size={15} />
          <span className="min-w-0 truncate">{destination.label}</span>
        </span>
      ),
    };
  });

  function go(id: string): void {
    const destination = destinations.find((candidate) => candidate.id === id);
    if (destination === undefined) return;
    setView(destination.id);
    if (destination.id === "today") setSelectedDate(todayKey());
    onNavigate?.();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2.5 px-2 pb-5 pt-6">
        <PlannerMark size="sm" />
        <span className="text-[15px] font-semibold tracking-tight">Suite Planner</span>
        {onClose !== undefined && (
          <IconButton label="Close navigation" className="ml-auto" onClick={onClose}>
            <X size={16} />
          </IconButton>
        )}
      </div>

      <ListView
        label="Views"
        items={items}
        selectedId={view}
        onSelect={go}
        onActivate={go}
      />

      <div className="mt-auto space-y-3 border-t border-line p-4">
        <WorkspaceActions className="flex gap-2 md:hidden" grow />
        <PrivacyLine {...(workspacePath ? { where: workspacePath } : {})} />
      </div>
    </div>
  );
}
