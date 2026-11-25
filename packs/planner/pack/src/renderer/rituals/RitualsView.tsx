import {
  addDaysToKey,
  type Capacity,
  capacityFor,
  type DateKey,
  type DayPlan,
  type DayRecord,
  type DayTask,
  dayPlan,
  formatDuration,
  humanDayLabel,
  todayKey,
} from "@suite/planner-core";
import { Button } from "@suite/ui";
import { type FormEvent, useEffect, useState } from "react";

import { CapacityMeter } from "../day/CapacityMeter";
import { useReplica, useWorkspaceSnapshot } from "../store/snapshotStore";
import { useUiStore } from "../store/uiStore";

export function RitualsView() {
  const snapshot = useWorkspaceSnapshot();
  const date = useUiStore((state) => state.selectedDate);
  const setView = useUiStore((state) => state.setView);
  const day = snapshot.days.find((record) => record.dateKey === date);
  const plan = dayPlan(snapshot.tasks, date, {
    defaultEstimateMinutes: snapshot.settings.defaultEstimateMinutes,
  });
  const available = day?.capacityMinutesOverride ?? snapshot.settings.dailyCapacityMinutes;
  const capacity = capacityFor(
    plan.tasks.map((entry) => entry.task),
    available,
    snapshot.settings.defaultEstimateMinutes,
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Rituals">
      <header className="border-b border-line px-6 pb-4 pt-5">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-xl font-semibold tracking-tight">Rituals</h1>
          <span className="text-xs text-faint">{humanDayLabel(date, todayKey())}</span>
        </div>
        <p className="mt-1 text-xs text-faint">
          Plan what the day is for, then close it out. Planning and shutting down are separate
          steps, and both write to the same day record the day view reads.
        </p>
      </header>

      <div className="flex-1 overflow-y-auto px-6 pb-24 pt-5">
        <PlanRitual
          date={date}
          day={day}
          plan={plan}
          capacity={capacity}
          defaultCapacityMinutes={snapshot.settings.dailyCapacityMinutes}
          defaultEstimateMinutes={snapshot.settings.defaultEstimateMinutes}
          onOpenDay={() => setView("today")}
        />
        <ShutdownRitual
          date={date}
          day={day}
          unfinished={plan.tasks}
          completedCount={plan.completed.length}
          defaultEstimateMinutes={snapshot.settings.defaultEstimateMinutes}
        />
      </div>
    </section>
  );
}

function PlanRitual({
  date,
  day,
  plan,
  capacity,
  defaultCapacityMinutes,
  defaultEstimateMinutes,
  onOpenDay,
}: {
  date: DateKey;
  day: DayRecord | undefined;
  plan: DayPlan;
  capacity: Capacity;
  defaultCapacityMinutes: number;
  defaultEstimateMinutes: number;
  onOpenDay: () => void;
}) {
  const replica = useReplica();
  const [intention, setIntention] = useState(day?.intention ?? "");
  const [capacityDraft, setCapacityDraft] = useState(
    day?.capacityMinutesOverride?.toString() ?? "",
  );
  const [planFeedback, setPlanFeedback] = useState<string | null>(null);
  const [capacityFeedback, setCapacityFeedback] = useState<string | null>(null);
  const [capacityError, setCapacityError] = useState<string | null>(null);

  useEffect(() => {
    setIntention(day?.intention ?? "");
  }, [day?.intention]);

  useEffect(() => {
    setCapacityDraft(day?.capacityMinutesOverride?.toString() ?? "");
  }, [day?.capacityMinutesOverride]);

  const alreadyPlanned = day?.plannedAt !== null && day?.plannedAt !== undefined;

  function saveIntention(): void {
    if (intention === (day?.intention ?? "")) return;
    replica.document.updateDay(date, { intention });
  }

  function saveCapacity(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = capacityDraft.trim();

    if (trimmed === "") {
      if (day?.capacityMinutesOverride != null) {
        replica.document.updateDay(date, { capacityMinutesOverride: null });
      }
      setCapacityError(null);
      setCapacityFeedback(`Using the default ${formatDuration(defaultCapacityMinutes)}.`);
      return;
    }

    const minutes = Number(trimmed);
    if (!Number.isInteger(minutes) || minutes <= 0) {
      setCapacityError("Capacity must be a whole number of minutes greater than zero.");
      setCapacityFeedback(null);
      return;
    }

    replica.document.updateDay(date, { capacityMinutesOverride: minutes });
    setCapacityError(null);
    setCapacityFeedback(`Capacity set to ${formatDuration(minutes)}.`);
  }

  function planDay(): void {
    const record = replica.document.markDayPlanned(date);
    const at = formatTime(record.plannedAt);
    setPlanFeedback(
      alreadyPlanned
        ? `Planned again at ${at}. The planned time was updated, not duplicated.`
        : `Planned at ${at}.`,
    );
  }

  return (
    <section aria-label="Plan the day" className="rounded-2xl border border-line p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-ink">1 · Plan the day</h2>
        <span className="text-xs text-faint">
          {alreadyPlanned ? `Planned at ${formatTime(day?.plannedAt ?? null)}` : "Not planned yet"}
        </span>
      </div>
      <p className="mt-1 text-xs text-faint">
        Say what the day is for and check that its tasks fit the capacity you have.
      </p>

      <label className="mt-4 flex flex-col gap-1 text-xs text-muted">
        Intention
        <input
          aria-label="Day intention"
          value={intention}
          onChange={(event) => setIntention(event.target.value)}
          onBlur={saveIntention}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          placeholder="What matters most today?"
          className="h-9 rounded-lg border border-line bg-canvas px-2.5 text-sm text-ink placeholder:text-faint focus:outline-none"
        />
      </label>

      <div className="mt-5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-faint">
            Chosen tasks
          </h3>
          {plan.tasks.length > 0 && (
            <span className="text-xs text-muted">
              {formatDuration(plan.plannedMinutes)} planned
            </span>
          )}
        </div>
        {plan.tasks.length === 0 ? (
          <div className="mt-2 flex items-center gap-3 rounded-lg border border-line bg-raised px-3 py-2.5">
            <p className="text-xs text-muted">No tasks are chosen for this day yet.</p>
            <Button size="sm" className="ml-auto" onClick={onOpenDay}>
              Open day
            </Button>
          </div>
        ) : (
          <ul className="mt-2 space-y-0.5">
            {plan.tasks.map((entry) => (
              <li
                key={`${entry.task.id}:${entry.occurrence}`}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-panel"
              >
                <span className="min-w-0 flex-1 truncate text-ink">{entry.task.title}</span>
                <span className="text-xs text-faint">
                  {formatDuration(entry.task.estimateMinutes ?? defaultEstimateMinutes)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-5">
        <CapacityMeter capacity={capacity} />
        <form onSubmit={saveCapacity} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex w-[190px] flex-col gap-1 text-xs text-muted">
            Capacity override (minutes)
            <input
              aria-label="Capacity override in minutes"
              type="number"
              min={1}
              step={15}
              value={capacityDraft}
              onChange={(event) => setCapacityDraft(event.target.value)}
              placeholder={`${defaultCapacityMinutes} (default)`}
              className="h-9 rounded-lg border border-line bg-canvas px-2.5 text-sm text-ink placeholder:text-faint focus:outline-none"
            />
          </label>
          <Button size="sm" type="submit">
            Save capacity
          </Button>
          <span className="text-xs text-faint">
            Empty uses the default {formatDuration(defaultCapacityMinutes)}.
          </span>
        </form>
        {capacityError !== null && (
          <p role="alert" className="mt-2 text-xs text-danger">
            {capacityError}
          </p>
        )}
        {capacityFeedback !== null && (
          <p role="status" className="mt-2 text-xs text-muted">
            {capacityFeedback}
          </p>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={planDay}>
          {alreadyPlanned ? "Plan again" : "Plan the day"}
        </Button>
        {alreadyPlanned && (
          <span className="text-xs text-faint">
            Planning again updates the planned time; nothing is duplicated.
          </span>
        )}
      </div>
      {planFeedback !== null && (
        <p role="status" className="mt-2 text-xs text-muted">
          {planFeedback}
        </p>
      )}
    </section>
  );
}

function ShutdownRitual({
  date,
  day,
  unfinished,
  completedCount,
  defaultEstimateMinutes,
}: {
  date: DateKey;
  day: DayRecord | undefined;
  unfinished: DayTask[];
  completedCount: number;
  defaultEstimateMinutes: number;
}) {
  const replica = useReplica();
  const [note, setNote] = useState(day?.shutdownNote ?? "");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [carryFeedback, setCarryFeedback] = useState<string | null>(null);
  const tomorrow = addDaysToKey(date, 1);
  const alreadyShutdown = day?.shutdownAt !== null && day?.shutdownAt !== undefined;

  useEffect(() => {
    setNote(day?.shutdownNote ?? "");
  }, [day?.shutdownNote]);

  function shutdown(): void {
    if (note !== (day?.shutdownNote ?? "")) {
      replica.document.updateDay(date, { shutdownNote: note });
    }
    const record = replica.document.markDayShutdown(date);
    const at = formatTime(record.shutdownAt);
    setFeedback(
      alreadyShutdown ? `Shutdown updated at ${at}.` : `Shut down at ${at}. The day is closed.`,
    );
  }

  function moveToTomorrow(entry: DayTask): void {
    replica.document.scheduleTask(entry.task.id, tomorrow);
    setCarryFeedback(`Moved ${entry.task.title} to ${humanDayLabel(tomorrow, date)}.`);
  }

  return (
    <section aria-label="Shut down the day" className="mt-5 rounded-2xl border border-line p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-ink">2 · Shut down the day</h2>
        <span className="text-xs text-faint">
          {alreadyShutdown
            ? `Shut down at ${formatTime(day?.shutdownAt ?? null)}`
            : "Not shut down yet"}
        </span>
      </div>
      <p className="mt-1 text-xs text-faint">
        Write down where the day landed, then close it. Running the step again updates the time; it
        does not add a second shutdown.
      </p>

      <label className="mt-4 flex flex-col gap-1 text-xs text-muted">
        Shutdown note
        <textarea
          aria-label="Shutdown note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          placeholder="What got done, what is still open, what you learned?"
          className="resize-y rounded-lg border border-line bg-canvas px-2.5 py-2 text-sm text-ink placeholder:text-faint focus:outline-none"
        />
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={shutdown}>
          {alreadyShutdown ? "Update shutdown" : "Shut down the day"}
        </Button>
        {feedback !== null && (
          <p role="status" className="text-xs text-muted">
            {feedback}
          </p>
        )}
      </div>

      <div className="mt-5 rounded-xl border border-line p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-faint">
            Carry-over · moves to tomorrow
          </h3>
          {unfinished.length > 0 && (
            <span className="text-xs text-muted">{unfinished.length} unfinished</span>
          )}
        </div>
        <p className="mt-1 text-xs text-faint">
          Unfinished work stays on this day's plan until you move it. Shutting down never
          reschedules a task for you.
        </p>

        {unfinished.length === 0 ? (
          <p className="mt-3 text-xs text-muted">
            {completedCount > 0
              ? "Everything planned for this day is done; nothing needs carrying over."
              : "Nothing is planned for this day."}
          </p>
        ) : (
          <ul className="mt-3 space-y-0.5">
            {unfinished.map((entry) => (
              <li
                key={`${entry.task.id}:${entry.occurrence}`}
                className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm"
              >
                <span className="min-w-0 flex-1 truncate text-ink">{entry.task.title}</span>
                <span className="text-xs text-faint">
                  {formatDuration(entry.task.estimateMinutes ?? defaultEstimateMinutes)}
                </span>
                {entry.recurring ? (
                  <span className="text-xs text-faint">repeats</span>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Move ${entry.task.title} to tomorrow`}
                    onClick={() => moveToTomorrow(entry)}
                  >
                    Move to tomorrow
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {carryFeedback !== null && (
          <p role="status" className="mt-2 text-xs text-muted">
            {carryFeedback}
          </p>
        )}
      </div>
    </section>
  );
}

function formatTime(timestamp: string | null): string {
  if (timestamp === null) return "";
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}
