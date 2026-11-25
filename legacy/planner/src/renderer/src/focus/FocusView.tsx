import {
  dayPlan,
  type FocusSession,
  formatDuration,
  type Task,
  todayKey,
} from "@suite/planner-core";
import { Button } from "@suite/ui";
import { Play, Square, Timer } from "lucide-react";
import { useState } from "react";

import { useReplica, useWorkspaceSnapshot } from "../store/snapshotStore";
import { elapsedMinutes, formatCountdown, remainingSeconds, sessionsOn } from "./sessionTime";
import { useNow } from "./useNow";

const DEFAULT_FOCUS_MINUTES = 25;

export function FocusView() {
  const snapshot = useWorkspaceSnapshot();
  const now = useNow();
  const today = todayKey();
  const plan = dayPlan(snapshot.tasks, today, {
    defaultEstimateMinutes: snapshot.settings.defaultEstimateMinutes,
  });
  const tasks = plan.tasks.map((entry) => entry.task);
  const titles = new Map(snapshot.tasks.map((task) => [task.id, task.title]));
  const active = snapshot.focusSessions.find((session) => session.endedAt === null);
  const finished = sessionsOn(snapshot.focusSessions, today).filter(
    (session) => session.endedAt !== null,
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Focus">
      <header className="border-b border-line px-6 pb-4 pt-5">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-xl font-semibold tracking-tight">Focus</h1>
          <span className="text-xs text-faint">
            {finished.length === 0 ? "no sessions yet" : `${finished.length} today`}
          </span>
        </div>
        <p className="mt-1 text-xs text-faint">
          One task, one timer. The countdown is read from the session's timestamps, so leaving this
          view does not stop it.
        </p>
      </header>

      <div className="flex-1 overflow-y-auto px-6 pb-24 pt-5">
        {active ? (
          <ActiveSession session={active} title={taskTitle(titles, active.taskId)} now={now} />
        ) : (
          <StartSession tasks={tasks} />
        )}

        <section className="mt-8" aria-label="Today's focus sessions">
          <h2 className="px-1 text-[11px] font-medium uppercase tracking-wider text-faint">
            Today's sessions
          </h2>
          {finished.length === 0 ? (
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-5 text-sm text-muted">
              <Timer size={17} className="text-faint" />
              <p>Finished sessions appear here with their actual duration.</p>
            </div>
          ) : (
            <ul className="mt-2 space-y-0.5">
              {finished.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  title={taskTitle(titles, session.taskId)}
                  now={now}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}

function ActiveSession({
  session,
  title,
  now,
}: {
  session: FocusSession;
  title: string;
  now: Date;
}) {
  const replica = useReplica();
  const remaining = remainingSeconds(session, now);
  const over = remaining < 0;

  return (
    <section
      aria-label="Running focus session"
      className="rounded-2xl border border-line bg-panel px-5 py-5"
    >
      <p className="text-[11px] font-medium uppercase tracking-wider text-faint">In focus</p>
      <p className="mt-2 text-lg font-semibold tracking-tight text-ink">{title}</p>
      <p className={`mt-1 font-mono text-3xl tabular-nums ${over ? "text-warn" : "text-ink"}`}>
        {formatCountdown(Math.abs(remaining))}
        <span className="ml-2 font-sans text-xs font-normal text-muted">
          {over ? "over" : "left"}
        </span>
      </p>
      <p className="mt-2 text-xs text-faint">
        Planned {formatDuration(session.plannedMinutes)} ·{" "}
        {formatDuration(elapsedMinutes(session, now))} elapsed
      </p>
      <Button
        size="sm"
        className="mt-4"
        onClick={() => replica.document.endFocusSession(session.id)}
        icon={<Square size={12} />}
      >
        Stop session
      </Button>
    </section>
  );
}

function StartSession({ tasks }: { tasks: Task[] }) {
  const replica = useReplica();
  const [taskId, setTaskId] = useState("");
  const [plannedMinutes, setPlannedMinutes] = useState(String(DEFAULT_FOCUS_MINUTES));
  const [error, setError] = useState<string | null>(null);

  const minutes = Number(plannedMinutes);
  const validMinutes = Number.isInteger(minutes) && minutes > 0;

  function start(): void {
    if (taskId === "") {
      setError("Choose the task this session is for.");
      return;
    }
    if (!validMinutes) {
      setError("The planned length must be a whole number of minutes.");
      return;
    }
    replica.document.startFocusSession({ taskId, plannedMinutes: minutes });
    setError(null);
  }

  return (
    <section aria-label="Start a focus session" className="rounded-2xl border border-line p-5">
      <h2 className="text-sm font-medium text-ink">Start a session</h2>
      <p className="mt-1 text-xs text-faint">
        Pick a task from today's plan and set how long you intend to work.
      </p>

      {tasks.length === 0 ? (
        <p className="mt-4 rounded-lg border border-line bg-raised px-3 py-2.5 text-xs text-muted">
          Nothing is planned for today yet, so there is no task to focus on.
        </p>
      ) : (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs text-muted">
            Task
            <select
              aria-label="Task"
              value={taskId}
              onChange={(event) => setTaskId(event.target.value)}
              className="h-9 rounded-lg border border-line bg-canvas px-2.5 text-sm text-ink focus:outline-none"
            >
              <option value="">Choose a task</option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
          </label>
          <label className="flex w-[130px] flex-col gap-1 text-xs text-muted">
            Planned minutes
            <input
              aria-label="Planned minutes"
              type="number"
              min={1}
              step={5}
              value={plannedMinutes}
              onChange={(event) => setPlannedMinutes(event.target.value)}
              className="h-9 rounded-lg border border-line bg-canvas px-2.5 text-sm text-ink focus:outline-none"
            />
          </label>
          <Button size="sm" onClick={start} icon={<Play size={12} />}>
            Start focus
          </Button>
        </div>
      )}

      {error !== null && (
        <p role="alert" className="mt-3 text-xs text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

function SessionRow({ session, title, now }: { session: FocusSession; title: string; now: Date }) {
  const started = new Date(session.startedAt).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <li className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-panel">
      <span className="w-12 shrink-0 text-xs tabular-nums text-faint">{started}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{title}</span>
      <span className="text-xs tabular-nums text-muted">
        {formatDuration(elapsedMinutes(session, now))}
      </span>
    </li>
  );
}

function taskTitle(titles: ReadonlyMap<string, string>, taskId: string | null): string {
  if (taskId === null) return "No task";
  return titles.get(taskId) ?? "Deleted task";
}
