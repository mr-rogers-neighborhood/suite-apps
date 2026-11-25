import {
  addDaysToKey,
  compareDateKeys,
  type DateKey,
  type DayTask,
  fromDateKey,
  humanDayLabel,
  type Project,
  type Task,
  todayKey,
  weekPlan,
} from "@suite/planner-core";
import { Button, IconButton } from "@suite/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { useReplica, useWorkspaceSnapshot } from "../store/snapshotStore";
import { useUiStore } from "../store/uiStore";
import { WeekColumn } from "./WeekColumn";
import type { WeekMoveDirection } from "./WeekTaskRow";

/**
 * Seven days at once.
 *
 * A week is a projection: the same tasks, estimates and per-day capacity the day view reads. A
 * move is a document write through `scheduleTask`; the column you drop on is the new
 * `scheduledFor`. Nothing is carried forward unless somebody chooses it.
 */
export function WeekView() {
  const snapshot = useWorkspaceSnapshot();
  const replica = useReplica();
  const selectedDate = useUiStore((state) => state.selectedDate);
  const setSelectedDate = useUiStore((state) => state.setSelectedDate);
  const setView = useUiStore((state) => state.setView);
  const today = todayKey();
  const [announcement, setAnnouncement] = useState("");

  const plan = weekPlan(snapshot.tasks, selectedDate, {
    weekStartsOn: snapshot.settings.weekStartsOn,
    dailyCapacityMinutes: snapshot.settings.dailyCapacityMinutes,
    defaultEstimateMinutes: snapshot.settings.defaultEstimateMinutes,
    days: snapshot.days,
    today,
  });
  const projects = new Map<string, Project>(
    snapshot.projects.map((project) => [project.id, project]),
  );

  function moveToDay(task: Task, dateKey: DateKey): void {
    replica.document.scheduleTask(task.id, dateKey);
    setAnnouncement(`Moved ${task.title} to ${humanDayLabel(dateKey, today)}.`);
  }

  function moveTask(entry: DayTask, direction: WeekMoveDirection): void {
    const from = entry.task.scheduledFor ?? entry.occurrence;
    const target = addDaysToKey(from, direction);
    if (
      compareDateKeys(target, plan.startDateKey) < 0 ||
      compareDateKeys(target, plan.endDateKey) > 0
    ) {
      setAnnouncement(
        `${entry.task.title} is already on the ${direction < 0 ? "first" : "last"} day of this week.`,
      );
      return;
    }
    moveToDay(entry.task, target);
  }

  function dropTask(taskId: string, dateKey: DateKey): void {
    const task = snapshot.tasks.find((entry) => entry.id === taskId);
    if (!task) return;
    if (task.recurrence) {
      setAnnouncement(`${task.title} repeats, so its series stays where it is.`);
      return;
    }
    if (task.scheduledFor === dateKey) {
      setAnnouncement(`${task.title} is already on ${humanDayLabel(dateKey, today)}.`);
      return;
    }
    moveToDay(task, dateKey);
  }

  function openDay(dateKey: DateKey): void {
    setSelectedDate(dateKey);
    setView("today");
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Week plan">
      <header className="border-b border-line px-6 pb-4 pt-5">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <h1 className="text-xl font-semibold tracking-tight">Week</h1>
          <span className="text-xs text-faint">
            {fromDateKey(plan.startDateKey).toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
            })}{" "}
            –{" "}
            {fromDateKey(plan.endDateKey).toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <IconButton
              label="Previous week"
              onClick={() => setSelectedDate(addDaysToKey(plan.startDateKey, -7))}
            >
              <ChevronLeft size={16} />
            </IconButton>
            <Button size="sm" variant="ghost" onClick={() => setSelectedDate(today)}>
              This week
            </Button>
            <IconButton
              label="Next week"
              onClick={() => setSelectedDate(addDaysToKey(plan.startDateKey, 7))}
            >
              <ChevronRight size={16} />
            </IconButton>
          </div>
        </div>
        <p className="mt-1 text-xs text-faint">
          Seven days at once. Each column plans its own work against its own capacity.
        </p>
        <p id="week-move-hint" className="mt-1 text-xs text-faint">
          Drag a task between days, or focus a task and press <kbd>Alt</kbd> + <kbd>←</kbd> /{" "}
          <kbd>Alt</kbd> + <kbd>→</kbd> to move it one day.
        </p>
      </header>

      {plan.carryOver.length > 0 && (
        <section
          aria-labelledby="week-carry-over-heading"
          className="mx-6 mt-4 rounded-2xl border border-warn/40 bg-panel p-4"
        >
          <div className="flex flex-wrap items-baseline gap-2.5">
            <h2 id="week-carry-over-heading" className="text-sm font-semibold text-ink">
              Carry-over
            </h2>
            <span className="text-xs text-faint">
              {plan.carryOver.length} unfinished before today
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-faint">
            These stay on their original day until you move one. Nothing is rescheduled silently.
          </p>
          <ul className="mt-2 space-y-0.5">
            {plan.carryOver.map((task) => (
              <li
                key={task.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-1.5 text-sm"
              >
                <span className="min-w-0 flex-1 truncate text-ink">{task.title}</span>
                <span className="text-[11px] text-faint">
                  from {humanDayLabel(task.scheduledFor ?? today, today)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Move ${task.title} to today`}
                  onClick={() => moveToDay(task, today)}
                >
                  Move to today
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-4 flex-1 overflow-auto px-6 pb-24">
        <div className="grid min-w-[1050px] grid-cols-7 gap-3">
          {plan.days.map((day) => (
            <WeekColumn
              key={day.dateKey}
              day={day}
              projects={projects}
              onMove={moveTask}
              onDropTask={dropTask}
              onOpenDay={openDay}
            />
          ))}
        </div>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}
