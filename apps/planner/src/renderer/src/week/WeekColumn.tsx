import type { DayTask, Project, WeekDay } from "@suite/planner-core";
import { CapacityMeter } from "../day/CapacityMeter";
import { type WeekMoveDirection, WeekTaskRow } from "./WeekTaskRow";
import { dayAndMonth, weekdayName } from "./weekLabels";

type WeekColumnProps = {
  day: WeekDay;
  projects: ReadonlyMap<string, Project>;
  onMove: (entry: DayTask, direction: WeekMoveDirection) => void;
  onDropTask: (taskId: string, dateKey: string) => void;
  onOpenDay: (dateKey: string) => void;
};

export function WeekColumn({ day, projects, onMove, onDropTask, onOpenDay }: WeekColumnProps) {
  const name = weekdayName(day.dateKey);
  const headingId = `week-day-${day.dateKey}`;

  return (
    <section
      aria-labelledby={headingId}
      onDragOver={(event) => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        event.preventDefault();
        const taskId = event.dataTransfer.getData("text/plain");
        if (taskId.length > 0) onDropTask(taskId, day.dateKey);
      }}
      className={
        day.isToday
          ? "flex min-h-[320px] flex-col rounded-2xl border border-accent/40 bg-panel p-2.5"
          : "flex min-h-[320px] flex-col rounded-2xl border border-line bg-panel p-2.5"
      }
    >
      <header className="flex items-baseline gap-2 px-1">
        <h2 id={headingId} className="text-sm font-semibold tracking-tight text-ink">
          {name}
        </h2>
        <span className="text-[11px] text-faint">{dayAndMonth(day.dateKey)}</span>
        {day.isToday && (
          <span className="ml-auto rounded-full border border-accent/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
            Today
          </span>
        )}
      </header>

      <div className="mt-2 px-1">
        <CapacityMeter capacity={day.capacity} label={`${name} planned time against capacity`} />
      </div>

      {day.plan.tasks.length === 0 ? (
        <p className="mt-4 px-1 text-xs leading-relaxed text-faint">
          Nothing planned. Drop a task here to give it this day.
        </p>
      ) : (
        <ul aria-label={`Tasks on ${name}`} className="mt-1.5 space-y-0.5">
          {day.plan.tasks.map((entry) => (
            <WeekTaskRow
              key={`${entry.task.id}:${entry.occurrence}`}
              entry={entry}
              {...(entry.task.projectId ? { project: projects.get(entry.task.projectId) } : {})}
              movable={!entry.recurring}
              onMove={onMove}
              onOpenDay={() => onOpenDay(day.dateKey)}
            />
          ))}
        </ul>
      )}

      {day.plan.completed.length > 0 && (
        <p className="mt-auto px-1 pt-3 text-[11px] text-faint">{day.plan.completed.length} done</p>
      )}
    </section>
  );
}
