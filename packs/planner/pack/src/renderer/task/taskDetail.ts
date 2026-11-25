import type { Recurrence, Task } from "@suite/planner-core";

/**
 * The pure parts of the task detail surface: turning a field's text into a value the schema will
 * accept, and turning a stored rule back into the preset the select shows.
 *
 * Validation lives here so the component can refuse a value in place and say why, rather than
 * handing it to `WorkspaceDocument` and letting a Zod throw end the edit.
 */

export type ParsedEstimate =
  | { readonly ok: true; readonly value: number | null }
  | { readonly ok: false };

/** An empty estimate means "use the default", so it is a valid null. */
export function parseEstimateInput(input: string): ParsedEstimate {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (!/^\d+$/u.test(trimmed)) return { ok: false };
  const minutes = Number(trimmed);
  return Number.isSafeInteger(minutes) && minutes > 0
    ? { ok: true, value: minutes }
    : { ok: false };
}

export type ParsedDateTime =
  | { readonly ok: true; readonly value: string | null }
  | { readonly ok: false };

/** A `datetime-local` value is local time with no offset; the schema stores an ISO instant. */
export function parseDateTimeInput(input: string): ParsedDateTime {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: true, value: null };
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return { ok: false };
  return { ok: true, value: parsed.toISOString() };
}

/** The inverse of `parseDateTimeInput`, in the shape a `datetime-local` input wants. */
export function toDateTimeInput(iso: string | null): string {
  if (iso === null) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export const recurrencePresets = [
  { id: "none", label: "Does not repeat" },
  { id: "daily", label: "Every day" },
  { id: "weekly", label: "Every week" },
  { id: "monthly", label: "Every month" },
] as const;

export type RecurrencePresetId = (typeof recurrencePresets)[number]["id"];

/**
 * A stored rule with a finer interval still reads as its frequency's preset. Picking a preset is
 * how a person resets it to the everyday case; the rule keeps its end date.
 */
export function recurrencePresetFor(task: Task): RecurrencePresetId {
  return task.recurrence?.frequency ?? "none";
}

export function recurrenceForPreset(
  preset: RecurrencePresetId,
  current: Recurrence | null,
): Recurrence | null {
  if (preset === "none") return null;
  return {
    frequency: preset,
    interval: 1,
    weekdays: [],
    until: current?.until ?? null,
  };
}

export function formatHistoryDate(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatHistoryTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
