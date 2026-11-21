import { todayKey } from "@suite/planner-core";
import { Button, IconButton, Modal, PrivacyLine } from "@suite/ui";
import { Download, Upload, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { getBridge } from "../platform/bridge";
import { useUiStore } from "../store/uiStore";
import { ThemePicker } from "../theme/ThemePicker";
import { PlannerMark } from "./PlannerMark";
import { views } from "./views";

/**
 * The desktop rail.
 *
 * Below `md` the rail is not rendered at all: `SidebarDrawer` carries the same content on top of
 * the day view, so a phone spends its width on the plan and not on navigation.
 */
export function Sidebar() {
  return (
    <aside
      aria-label="Navigation"
      className="hidden w-[228px] shrink-0 flex-col border-r border-line bg-panel md:flex"
    >
      <SidebarContent />
    </aside>
  );
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
      <SidebarContent onNavigate={onClose} onClose={onClose} />
    </Modal>
  );
}

function SidebarContent({
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
  const setNotice = useUiStore((state) => state.setNotice);
  const [workspacePath, setWorkspacePath] = useState<string>("");

  useEffect(() => {
    void getBridge()
      .info()
      .then((info) => setWorkspacePath(info.path))
      .catch(() => setWorkspacePath(""));
  }, []);

  async function exportWorkspace(): Promise<void> {
    try {
      const result = await getBridge().exportWorkspace();
      if (!result.canceled) setNotice(`Exported to ${result.path ?? "your chosen file"}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Export failed");
    }
  }

  async function importWorkspace(): Promise<void> {
    try {
      const result = await getBridge().importWorkspace();
      if (!result.canceled) setNotice("Workspace imported");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Import failed");
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2.5 px-5 pb-5 pt-6">
        <PlannerMark size="sm" />
        <span className="text-[15px] font-semibold tracking-tight">Suite Planner</span>
        {onClose !== undefined && (
          <IconButton label="Close navigation" className="ml-auto" onClick={onClose}>
            <X size={16} />
          </IconButton>
        )}
      </div>

      <div className="px-3 pb-2">
        <ThemePicker />
      </div>

      <nav aria-label="Primary" className="flex flex-col gap-1 px-3">
        {Object.values(views).map((destination) => {
          const Icon = destination.icon;
          return (
            <NavItem
              key={destination.id}
              active={view === destination.id}
              icon={<Icon size={15} />}
              label={destination.label}
              onClick={() => {
                setView(destination.id);
                if (destination.id === "today") setSelectedDate(todayKey());
                onNavigate?.();
              }}
            />
          );
        })}
      </nav>

      <div className="mt-auto space-y-3 border-t border-line p-4">
        <div className="flex gap-2">
          <Button size="sm" className="flex-1" onClick={() => void exportWorkspace()}>
            <Download size={13} />
            Export
          </Button>
          <Button size="sm" className="flex-1" onClick={() => void importWorkspace()}>
            <Upload size={13} />
            Import
          </Button>
        </div>
        <PrivacyLine {...(workspacePath ? { where: workspacePath } : {})} />
      </div>
    </div>
  );
}

function NavItem({
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
          ? "flex items-center gap-2.5 rounded-lg bg-accent-soft px-3 py-2 text-sm font-medium text-ink"
          : "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-raised hover:text-ink"
      }
    >
      {icon}
      {label}
    </button>
  );
}
