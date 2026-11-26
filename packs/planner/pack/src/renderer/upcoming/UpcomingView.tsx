import {
  compareDateKeys,
  type DateKey,
  formatDuration,
  fromDateKey,
  humanDayLabel,
  type Project,
  type Tag,
  type Task,
  todayKey,
} from "@suite/planner-core";
import { Button, EmptyState } from "@suite/ui";
import { useWorkspaceSnapshot } from "../store/snapshotStore";
import { useUiStore } from "../store/uiStore";

export function UpcomingView() {
  const snapshot = useWorkspaceSnapshot();
  const setView = useUiStore((state) => state.setView);
  const setSelectedDate = useUiStore((state) => state.setSelectedDate);
  const today = todayKey();

  const projects = new Map<string, Project>(
    snapshot.projects.map((project) => [project.id, project]),
  );
  const tags = new Map<string, Tag>(snapshot.tags.map((tag) => [tag.id, tag]));

  const groups = new Map<DateKey, Task[]>();
  for (const task of snapshot.tasks) {
    if (task.status === "done" || task.scheduledFor === null) continue;
    if (compareDateKeys(task.scheduledFor, today) <= 0) continue;
    const group = groups.get(task.scheduledFor);
    if (group) group.push(task);
    else groups.set(task.scheduledFor, [task]);
  }

  const days = [...groups.entries()].sort(([a], [b]) => compareDateKeys(a, b));

  function openDay(dateKey: DateKey): void {
    setSelectedDate(dateKey);
    setView("today");
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Upcoming">
      <header className="border-b border-line px-6 pb-4 pt-5">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-xl font-semibold tracking-tight">Upcoming</h1>
          <span className="text-xs text-faint">
            {days.length === 0 ? "clear" : `${days.length} ${days.length === 1 ? "day" : "days"}`}
          </span>
        </div>
        <p className="mt-1 text-xs text-faint">
          Open tasks with a future day, in the order they arrive.
        </p>
      </header>

      <div className="mt-4 flex-1 overflow-y-auto px-6 pb-24">
        {days.length === 0 ? (
          <EmptyState
            title="Nothing scheduled ahead"
            className="mt-12"
            action={
              <Button size="sm" onClick={() => setView("inbox")}>
                Open inbox
              </Button>
            }
          >
            Give a task a future day from the inbox, or capture one with a date such as{" "}
            <span className="text-muted">tomorrow</span>.
          </EmptyState>
        ) : (
          <div className="space-y-6">
            {days.map(([dateKey, tasks]) => (
              <section key={dateKey} aria-label={humanDayLabel(dateKey, today)}>
                <div className="flex items-baseline gap-2.5 px-3">
                  <h2 className="text-sm font-semibold tracking-tight text-ink">
                    {humanDayLabel(dateKey, today)}
                  </h2>
                  <span className="text-[11px] text-faint">
                    {fromDateKey(dateKey).toLocaleDateString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                  <span className="ml-auto text-[11px] text-faint">
                    {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
                  </span>
                </div>

                <ul className="mt-1 space-y-0.5">
                  {[...tasks]
                    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))
                    .map((task) => {
                      const project = task.projectId ? projects.get(task.projectId) : undefined;
                      return (
                        <li
                          key={task.id}
                          className="group flex items-start gap-3 rounded-xl border border-transparent px-3 py-2.5 transition-colors hover:border-line hover:bg-panel"
                        >
                          <div className="min-w-0 flex-1">
                            <button
                              type="button"
                              onClick={() => openDay(dateKey)}
                              className="block w-full truncate text-left text-sm text-ink"
                            >
                              {task.title}
                            </button>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-faint">
                              {project && (
                                <span className="inline-flex items-center gap-1.5">
                                  <span
                                    className="h-1.5 w-1.5 rounded-full"
                                    style={{ backgroundColor: project.color ?? "var(--accent)" }}
                                  />
                                  {project.name}
                                </span>
                              )}
                              {task.tagIds.map((id) => {
                                const tag = tags.get(id);
                                return tag ? <span key={tag.id}>#{tag.name}</span> : null;
                              })}
                              {task.estimateMinutes !== null && (
                                <span>{formatDuration(task.estimateMinutes)}</span>
                              )}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Open ${task.title}`}
                            onClick={() => openDay(dateKey)}
                            className="touch"
                          >
                            Open day
                          </Button>
                        </li>
                      );
                    })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
