import type { ChecklistItem, Project, Tag, Task, WorkspaceDocument } from "@suite/planner-core";
import { createId } from "@suite/planner-core";
import { Button, Field, IconButton, Modal } from "@suite/ui";
import { Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { TaskCheckbox } from "../components/TaskCheckbox";
import { useReplica, useWorkspaceSnapshot } from "../store/snapshotStore";
import { useUiStore } from "../store/uiStore";
import { TaskNotesEditor } from "./TaskNotesEditor";
import {
  formatHistoryDate,
  formatHistoryTimestamp,
  parseDateTimeInput,
  parseEstimateInput,
  type RecurrencePresetId,
  recurrenceForPreset,
  recurrencePresetFor,
  recurrencePresets,
  toDateTimeInput,
} from "./taskDetail";

type TaskPatch = Partial<Omit<Task, "id" | "createdAt">>;

/**
 * The task detail surface, opened from a row in the day or the inbox.
 *
 * It is a dialog over the current view rather than a registered view: the row is the subject, and
 * closing returns to it. Every edit goes through the replica's `WorkspaceDocument`; the only
 * React state here is the draft text a person is typing, never a copy of the record.
 */
export function TaskDetail() {
  const taskId = useUiStore((state) => state.selectedTaskId);
  const selectTask = useUiStore((state) => state.selectTask);
  const snapshot = useWorkspaceSnapshot();
  const replica = useReplica();
  const task = taskId === null ? undefined : snapshot.tasks.find((item) => item.id === taskId);

  useEffect(() => {
    // The task can be deleted elsewhere while the dialog is open; close rather than show stale text.
    if (taskId !== null && task === undefined) selectTask(null);
  }, [taskId, task, selectTask]);

  if (task === undefined) return null;

  return (
    <TaskDetailDialog
      key={task.id}
      task={task}
      note={replica.document.getNote(task.id)}
      workspace={replica.document}
      projects={snapshot.projects}
      tags={snapshot.tags}
      onClose={() => selectTask(null)}
      onPatch={(patch) => replica.document.updateTask(task.id, patch)}
      onToggleChecklist={(itemId) => replica.document.toggleChecklistItem(task.id, itemId)}
    />
  );
}

type TaskDetailDialogProps = {
  readonly task: Task;
  readonly note: string;
  readonly workspace: WorkspaceDocument;
  readonly projects: Project[];
  readonly tags: Tag[];
  readonly onClose: () => void;
  readonly onPatch: (patch: TaskPatch) => void;
  readonly onToggleChecklist: (itemId: string) => void;
};

type FieldName = "title" | "estimate" | "dueAt" | "remindAt" | "checklist" | "recurrence";

function TaskDetailDialog({
  task,
  note,
  workspace,
  projects,
  tags,
  onClose,
  onPatch,
  onToggleChecklist,
}: TaskDetailDialogProps) {
  const [title, setTitle] = useState(task.title);
  const [estimate, setEstimate] = useState(
    task.estimateMinutes === null ? "" : String(task.estimateMinutes),
  );
  const [dueAt, setDueAt] = useState(toDateTimeInput(task.dueAt));
  const [remindAt, setRemindAt] = useState(toDateTimeInput(task.remindAt));
  const [checklistDraft, setChecklistDraft] = useState("");
  const [errors, setErrors] = useState<Partial<Record<FieldName, string | undefined>>>({});

  useEffect(() => setTitle(task.title), [task.title]);
  useEffect(
    () => setEstimate(task.estimateMinutes === null ? "" : String(task.estimateMinutes)),
    [task.estimateMinutes],
  );
  useEffect(() => setDueAt(toDateTimeInput(task.dueAt)), [task.dueAt]);
  useEffect(() => setRemindAt(toDateTimeInput(task.remindAt)), [task.remindAt]);

  function refuse(field: FieldName, sentence: string): void {
    setErrors((current) => ({ ...current, [field]: sentence }));
  }

  function clearError(field: FieldName): void {
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function commitTitle(): void {
    const next = title.trim();
    if (next.length === 0) {
      refuse("title", "A task needs a title.");
      return;
    }
    clearError("title");
    setTitle(next);
    if (next !== task.title) onPatch({ title: next });
  }

  function commitEstimate(): void {
    const parsed = parseEstimateInput(estimate);
    if (!parsed.ok) {
      refuse("estimate", "Enter whole minutes greater than zero, or leave the field empty.");
      return;
    }
    clearError("estimate");
    setEstimate(parsed.value === null ? "" : String(parsed.value));
    if (parsed.value !== task.estimateMinutes) onPatch({ estimateMinutes: parsed.value });
  }

  function commitDateTime(field: "dueAt" | "remindAt", draft: string): void {
    const parsed = parseDateTimeInput(draft);
    if (!parsed.ok) {
      refuse(field, "Enter a real date and time, or clear the field.");
      return;
    }
    clearError(field);
    if (field === "dueAt") {
      setDueAt(toDateTimeInput(parsed.value));
      if (parsed.value !== task.dueAt) onPatch({ dueAt: parsed.value });
    } else {
      setRemindAt(toDateTimeInput(parsed.value));
      if (parsed.value !== task.remindAt) onPatch({ remindAt: parsed.value });
    }
  }

  function addChecklistItem(): void {
    const nextTitle = checklistDraft.trim();
    if (nextTitle.length === 0) {
      refuse("checklist", "Name the checklist item before adding it.");
      return;
    }
    clearError("checklist");
    const item: ChecklistItem = { id: createId("check"), title: nextTitle, done: false };
    onPatch({ checklist: [...task.checklist, item] });
    setChecklistDraft("");
  }

  function removeChecklistItem(itemId: string): void {
    onPatch({ checklist: task.checklist.filter((item) => item.id !== itemId) });
  }

  function toggleTag(tagId: string): void {
    onPatch({
      tagIds: task.tagIds.includes(tagId)
        ? task.tagIds.filter((id) => id !== tagId)
        : [...task.tagIds, tagId],
    });
  }

  function changeRecurrence(preset: RecurrencePresetId): void {
    if (preset !== "none" && task.scheduledFor === null) {
      refuse("recurrence", "Give the task a day before it can repeat.");
      return;
    }
    clearError("recurrence");
    if (preset === recurrencePresetFor(task)) return;
    onPatch({ recurrence: recurrenceForPreset(preset, task.recurrence) });
  }

  return (
    <Modal open onClose={onClose} label="Task details" size="lg">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[15px] font-semibold tracking-tight">Task details</h2>
        <IconButton label="Close task details" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        <Field
          label="Title"
          value={title}
          error={errors.title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={commitTitle}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />

        <TaskNotesEditor workspace={workspace} taskId={task.id} initialText={note} label="Notes" />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Estimate (minutes)"
            value={estimate}
            inputMode="numeric"
            error={errors.estimate}
            onChange={(event) => setEstimate(event.target.value)}
            onBlur={commitEstimate}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="task-detail-project"
              className="text-[12px] font-medium text-[var(--ink)]"
            >
              Project
            </label>
            <select
              id="task-detail-project"
              value={task.projectId ?? ""}
              onChange={(event) =>
                onPatch({ projectId: event.target.value === "" ? null : event.target.value })
              }
              className="h-[var(--control-height,2.25rem)] w-full rounded-lg border border-line bg-panel px-3 text-[13px] text-ink focus:outline-none"
            >
              <option value="">No project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Due"
            type="datetime-local"
            value={dueAt}
            error={errors.dueAt}
            onChange={(event) => setDueAt(event.target.value)}
            onBlur={(event) => commitDateTime("dueAt", event.target.value)}
          />
          <Field
            label="Remind me"
            type="datetime-local"
            value={remindAt}
            error={errors.remindAt}
            onChange={(event) => setRemindAt(event.target.value)}
            onBlur={(event) => commitDateTime("remindAt", event.target.value)}
          />
        </div>

        <fieldset>
          <legend className="text-[12px] font-medium text-[var(--ink)]">Tags</legend>
          {tags.length === 0 ? (
            <p className="mt-1 text-[11px] text-muted">No tags exist yet.</p>
          ) : (
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-2">
              {tags.map((tag) => (
                <label key={tag.id} className="flex items-center gap-2 text-[12px] text-muted">
                  <input
                    type="checkbox"
                    checked={task.tagIds.includes(tag.id)}
                    onChange={() => toggleTag(tag.id)}
                    className="accent-[var(--accent)]"
                  />
                  #{tag.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="task-detail-recurrence"
            className="text-[12px] font-medium text-[var(--ink)]"
          >
            Repeats
          </label>
          <select
            id="task-detail-recurrence"
            value={recurrencePresetFor(task)}
            onChange={(event) => changeRecurrence(event.target.value as RecurrencePresetId)}
            aria-invalid={errors.recurrence !== undefined}
            className="h-[var(--control-height,2.25rem)] w-full rounded-lg border border-line bg-panel px-3 text-[13px] text-ink focus:outline-none"
          >
            {recurrencePresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
          {errors.recurrence === undefined ? null : (
            <p role="alert" className="text-[11px] text-danger">
              {errors.recurrence}
            </p>
          )}
          {task.recurrence === null ? null : (
            <p className="text-[11px] text-muted">
              The series is anchored on {task.scheduledFor ?? "no day yet"} and its occurrences are
              projected, not copied.
            </p>
          )}
        </div>

        <section aria-labelledby="task-detail-checklist">
          <h3 id="task-detail-checklist" className="text-[12px] font-medium text-[var(--ink)]">
            Checklist
          </h3>
          {task.checklist.length === 0 ? (
            <p className="mt-1 text-[11px] text-muted">No checklist items yet.</p>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {task.checklist.map((item) => (
                <li key={item.id} className="flex items-center gap-2">
                  <TaskCheckbox
                    checked={item.done}
                    onCheckedChange={() => onToggleChecklist(item.id)}
                    label={`Toggle ${item.title}`}
                  />
                  <span
                    className={`min-w-0 flex-1 truncate text-[12px] ${
                      item.done ? "text-faint line-through" : "text-ink"
                    }`}
                  >
                    {item.title}
                  </span>
                  <IconButton
                    label={`Remove ${item.title}`}
                    onClick={() => removeChecklistItem(item.id)}
                  >
                    <Trash2 size={14} />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex items-center gap-2">
            <input
              aria-label="New checklist item"
              value={checklistDraft}
              onChange={(event) => setChecklistDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addChecklistItem();
                }
              }}
              placeholder="Add a step"
              className="h-[var(--control-height-sm,2rem)] w-full rounded-md border border-line bg-panel px-2.5 text-[12px] text-ink placeholder:text-faint focus:outline-none"
            />
            <Button size="sm" icon={<Plus size={13} />} onClick={addChecklistItem}>
              Add
            </Button>
          </div>
          {errors.checklist === undefined ? null : (
            <p role="alert" className="mt-1 text-[11px] text-danger">
              {errors.checklist}
            </p>
          )}
        </section>

        <section aria-labelledby="task-detail-history">
          <h3 id="task-detail-history" className="text-[12px] font-medium text-[var(--ink)]">
            Completion history
          </h3>
          {task.completedAt === null && task.recurrenceCompletions.length === 0 ? (
            <p className="mt-1 text-[11px] text-muted">Not completed yet.</p>
          ) : (
            <ul className="mt-1.5 space-y-1 text-[12px] text-muted">
              {task.completedAt === null ? null : (
                <li>Completed {formatHistoryTimestamp(task.completedAt)}</li>
              )}
              {[...task.recurrenceCompletions].sort().map((dateKey) => (
                <li key={dateKey}>Occurrence done {formatHistoryDate(dateKey)}</li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}
