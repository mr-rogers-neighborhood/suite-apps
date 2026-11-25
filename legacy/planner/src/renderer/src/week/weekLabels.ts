import { type DateKey, fromDateKey } from "@suite/planner-core";

export function weekdayName(dateKey: DateKey): string {
  return fromDateKey(dateKey).toLocaleDateString(undefined, { weekday: "long" });
}

export function dayAndMonth(dateKey: DateKey): string {
  return fromDateKey(dateKey).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
