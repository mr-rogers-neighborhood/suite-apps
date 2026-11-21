import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { type DayTask, formatDuration, type Project, type Tag } from "@suite/planner-core";
import { IconButton } from "@suite/ui";
import { Bell, ChevronRight, Maximize2, MoreHorizontal, Repeat, Timer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TaskCheckbox } from "../components/TaskCheckbox";
import { useReplica } from "../store/snapshotStore";
import { useUiStore } from "../store/uiStore";
import { eveningReminder, inMinutes, reminderLabel, tomorrowMorning } from "./reminderPresets";

type TaskRowProps = {
  entry: DayTask;
  project?: Project | undefined;
  tags: Tag[];
};

export function TaskRow({ entry, project, tags }: TaskRowProps) {
  const replica = useReplica();
  const selectTask = useUiStore((state) => state.selectTask);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.task.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLButtonElement>(null);
  const detailsRef = useRef<HTMLButtonElement>(null);
  // A keyboard commit or cancel unmounts the editor; focus would otherwise fall to the page.
  const restoreTitleFocus = useRef(false);
  // The action the row menu chose, run once the menu has actually closed. Radix returns focus to
  // its trigger in a deferred callback; opening the dialog any earlier lets that callback pull
  // focus back out of it. `onCloseAutoFocus` is the point where the menu is gone and we can keep
  // the focus the dialog is about to take.
  const openDetailsOnClose = useRef(false);

  useEffect(() => {
    setDraft(entry.task.title);
  }, [entry.task.title]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.select();
      return;
    }
    if (!restoreTitleFocus.current) return;
    restoreTitleFocus.current = false;
    titleRef.current?.focus();
  }, [editing]);

  function toggle(): void {
    if (entry.done) {
      if (entry.recurring) {
        replica.document.uncompleteOccurrence(entry.task.id, entry.occurrence);
      } else {
        replica.document.uncompleteTask(entry.task.id);
      }
    } else {
      replica.document.completeTask(entry.task.id, entry.recurring ? entry.occurrence : null);
    }
  }

  function commitTitle({ returnFocus = false }: { returnFocus?: boolean } = {}): void {
    const next = draft.trim();
    if (returnFocus) restoreTitleFocus.current = true;
    setEditing(false);
    if (next.length === 0 || next === entry.task.title) {
      setDraft(entry.task.title);
      return;
    }
    replica.document.updateTask(entry.task.id, { title: next });
  }

  function cancelTitle(): void {
    restoreTitleFocus.current = true;
    setDraft(entry.task.title);
    setEditing(false);
  }

  function setReminderTo(at: Date): void {
    replica.document.updateTask(entry.task.id, { remindAt: at.toISOString() });
  }

  function clearReminder(): void {
    replica.document.updateTask(entry.task.id, { remindAt: null });
  }

  function openDetails(): void {
    // Modal restores focus to whatever had it when it opened, so point that at this row.
    detailsRef.current?.focus();
    selectTask(entry.task.id);
  }

  const dueTime = entry.task.dueAt
    ? new Date(entry.task.dueAt).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <li className="group flex items-start gap-3 rounded-xl border border-transparent px-3 py-2.5 transition-colors hover:border-line hover:bg-panel">
      <TaskCheckbox
        checked={entry.done}
        onCheckedChange={toggle}
        label={entry.done ? `Mark ${entry.task.title} not done` : `Complete ${entry.task.title}`}
      />

      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            ref={inputRef}
            aria-label={`Edit title for ${entry.task.title}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => commitTitle()}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitTitle({ returnFocus: true });
              if (event.key === "Escape") cancelTitle();
            }}
            className="w-full rounded-md border border-line bg-canvas px-2 py-1 text-sm text-ink focus:outline-none"
          />
        ) : (
          <button
            ref={titleRef}
            type="button"
            onClick={() => setEditing(true)}
            className={`block w-full truncate text-left text-sm ${
              entry.done ? "text-faint line-through" : "text-ink"
            }`}
          >
            {entry.task.title}
          </button>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
          {project && (
            <span className="inline-flex items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: project.color ?? "var(--accent)" }}
              />
              {project.name}
            </span>
          )}
          {tags.map((tag) => (
            <span key={tag.id}>#{tag.name}</span>
          ))}
          {entry.task.estimateMinutes !== null && (
            <span className="inline-flex items-center gap-1">
              <Timer size={11} />
              {formatDuration(entry.task.estimateMinutes)}
            </span>
          )}
          {dueTime && <span>due {dueTime}</span>}
          {entry.recurring && (
            <span className="inline-flex items-center gap-1">
              <Repeat size={11} />
              {entry.task.recurrence?.frequency}
            </span>
          )}
          {entry.task.remindAt && (
            <span
              className="inline-flex items-center gap-1"
              title={`Reminder at ${entry.task.remindAt}`}
            >
              <Bell size={11} />
              {reminderLabel(entry.task.remindAt)}
            </span>
          )}
        </div>
      </div>

      <button
        ref={detailsRef}
        type="button"
        aria-label={`Open details for ${entry.task.title}`}
        title={`Open details for ${entry.task.title}`}
        onClick={openDetails}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent bg-transparent text-muted opacity-0 transition-colors hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Maximize2 size={14} />
      </button>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <IconButton
            label={`Actions for ${entry.task.title}`}
            className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal size={15} />
          </IconButton>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            onCloseAutoFocus={(event) => {
              if (!openDetailsOnClose.current) return;
              openDetailsOnClose.current = false;
              // Do not return focus to the trigger; the dialog opens next and takes it.
              event.preventDefault();
              openDetails();
            }}
            className="z-50 min-w-[180px] rounded-lg border border-line bg-panel p-1 shadow-2xl"
          >
            <DropdownMenu.Item
              onSelect={() => {
                openDetailsOnClose.current = true;
              }}
              className="cursor-default rounded-md px-2.5 py-1.5 text-sm text-ink outline-none data-[highlighted]:bg-raised"
            >
              Open details
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="my-1 h-px bg-line" />
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger className="flex cursor-default items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-sm text-ink outline-none data-[highlighted]:bg-raised data-[state=open]:bg-raised">
                Remind me
                <ChevronRight size={13} />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent
                  sideOffset={4}
                  className="z-50 min-w-[180px] rounded-lg border border-line bg-panel p-1 shadow-2xl"
                >
                  <DropdownMenu.Item
                    onSelect={() => setReminderTo(inMinutes(30))}
                    className="cursor-default rounded-md px-2.5 py-1.5 text-sm text-ink outline-none data-[highlighted]:bg-raised"
                  >
                    In 30 minutes
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={() => setReminderTo(inMinutes(60))}
                    className="cursor-default rounded-md px-2.5 py-1.5 text-sm text-ink outline-none data-[highlighted]:bg-raised"
                  >
                    In 1 hour
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={() => setReminderTo(inMinutes(180))}
                    className="cursor-default rounded-md px-2.5 py-1.5 text-sm text-ink outline-none data-[highlighted]:bg-raised"
                  >
                    In 3 hours
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={() => setReminderTo(eveningReminder())}
                    className="cursor-default rounded-md px-2.5 py-1.5 text-sm text-ink outline-none data-[highlighted]:bg-raised"
                  >
                    This evening
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={() => setReminderTo(tomorrowMorning())}
                    className="cursor-default rounded-md px-2.5 py-1.5 text-sm text-ink outline-none data-[highlighted]:bg-raised"
                  >
                    Tomorrow at 9:00
                  </DropdownMenu.Item>
                  {entry.task.remindAt && (
                    <>
                      <DropdownMenu.Separator className="my-1 h-px bg-line" />
                      <DropdownMenu.Item
                        onSelect={() => clearReminder()}
                        className="cursor-default rounded-md px-2.5 py-1.5 text-sm text-ink outline-none data-[highlighted]:bg-raised"
                      >
                        Clear reminder
                      </DropdownMenu.Item>
                    </>
                  )}
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
            <DropdownMenu.Separator className="my-1 h-px bg-line" />
            <DropdownMenu.Item
              onSelect={() => replica.document.scheduleTask(entry.task.id, null)}
              className="cursor-default rounded-md px-2.5 py-1.5 text-sm text-ink outline-none data-[highlighted]:bg-raised"
            >
              Move to inbox
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={() => replica.document.deleteTask(entry.task.id)}
              className="cursor-default rounded-md px-2.5 py-1.5 text-sm text-danger outline-none data-[highlighted]:bg-raised"
            >
              Delete task
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </li>
  );
}
