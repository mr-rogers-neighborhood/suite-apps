import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { type DayTask, formatDuration, type Project } from "@suite/planner-core";
import { IconButton } from "@suite/ui";
import { MoreHorizontal, Repeat } from "lucide-react";
import type { KeyboardEvent } from "react";

export type WeekMoveDirection = -1 | 1;

type WeekTaskRowProps = {
  entry: DayTask;
  project?: Project | undefined;
  /** A task that repeats stores a series anchor; dragging its occurrence would move the series. */
  movable: boolean;
  onMove: (entry: DayTask, direction: WeekMoveDirection) => void;
  onOpenDay: () => void;
};

/**
 * One task inside a week column.
 *
 * Dragging is the pointer path. The title is a real button so the same move is available from the
 * keyboard: Alt+Left and Alt+Right move the focused task one day, and the menu says the same thing
 * in words for anyone who does not use a pointer.
 */
export function WeekTaskRow({ entry, project, movable, onMove, onOpenDay }: WeekTaskRowProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (!movable || !event.altKey) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    onMove(entry, event.key === "ArrowLeft" ? -1 : 1);
  }

  return (
    <li
      draggable={movable}
      onDragStart={(event) => {
        if (!movable) return;
        event.dataTransfer.setData("text/plain", entry.task.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      className="group rounded-lg border border-transparent px-2 py-1.5 transition-colors hover:border-line hover:bg-panel"
    >
      <div className="flex items-start gap-1.5">
        <button
          type="button"
          onClick={onOpenDay}
          onKeyDown={handleKeyDown}
          aria-keyshortcuts={movable ? "Alt+ArrowLeft Alt+ArrowRight" : undefined}
          title={
            movable
              ? `${entry.task.title} — Alt+Left or Alt+Right moves it one day`
              : entry.task.title
          }
          className="min-w-0 flex-1 truncate text-left text-[13px] leading-5 text-ink touch"
        >
          {entry.task.title}
        </button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <IconButton label={`Actions for ${entry.task.title}`} className="touch">
              <MoreHorizontal size={14} />
            </IconButton>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="z-50 min-w-[190px] rounded-lg border border-line bg-panel p-1 shadow-2xl"
            >
              <DropdownMenu.Item
                onSelect={onOpenDay}
                className="cursor-default rounded-md px-2.5 py-1.5 text-sm text-ink outline-none data-[highlighted]:bg-raised"
              >
                Open day
              </DropdownMenu.Item>
              {movable && (
                <>
                  <DropdownMenu.Separator className="my-1 h-px bg-line" />
                  <DropdownMenu.Item
                    onSelect={() => onMove(entry, -1)}
                    className="cursor-default rounded-md px-2.5 py-1.5 text-sm text-ink outline-none data-[highlighted]:bg-raised"
                  >
                    Move to previous day
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={() => onMove(entry, 1)}
                    className="cursor-default rounded-md px-2.5 py-1.5 text-sm text-ink outline-none data-[highlighted]:bg-raised"
                  >
                    Move to next day
                  </DropdownMenu.Item>
                </>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 pl-0.5 text-[11px] text-faint">
        {project && (
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: project.color ?? "var(--accent)" }}
            />
            {project.name}
          </span>
        )}
        {entry.task.estimateMinutes !== null && (
          <span>{formatDuration(entry.task.estimateMinutes)}</span>
        )}
        {entry.recurring && (
          <span className="inline-flex items-center gap-1">
            <Repeat size={11} />
            repeats
          </span>
        )}
      </div>
    </li>
  );
}
