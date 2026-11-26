import type { Project } from "@suite/planner-core";
import { Button, EmptyState } from "@suite/ui";
import { useState } from "react";

import { useReplica, useWorkspaceSnapshot } from "../store/snapshotStore";

export function ProjectsView() {
  const snapshot = useWorkspaceSnapshot();
  const replica = useReplica();
  const [name, setName] = useState("");

  const active = snapshot.projects.filter((project) => project.archivedAt === null);
  const archived = snapshot.projects.filter((project) => project.archivedAt !== null);

  const openCounts = new Map<string, number>();
  for (const task of snapshot.tasks) {
    if (task.status === "done" || task.projectId === null) continue;
    openCounts.set(task.projectId, (openCounts.get(task.projectId) ?? 0) + 1);
  }

  function addProject(): void {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    replica.document.createProject({ name: trimmed });
    setName("");
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Projects">
      <header className="border-b border-line px-6 pb-4 pt-5">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
          <span className="text-xs text-faint">
            {active.length === 0 ? "none yet" : `${active.length} active`}
          </span>
        </div>
        <p className="mt-1 text-xs text-faint">
          Group tasks by the outcome they belong to, then archive the ones that are finished.
        </p>
      </header>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          addProject();
        }}
        className="flex items-center gap-2 px-6 pt-4"
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label="New project name"
          placeholder="A new project"
          className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 py-2 text-sm text-ink placeholder:text-faint focus:outline-none"
        />
        <Button size="sm" type="submit" disabled={name.trim().length === 0}>
          Add project
        </Button>
      </form>

      <div className="mt-4 flex-1 overflow-y-auto px-6 pb-24">
        {active.length === 0 && archived.length === 0 ? (
          <EmptyState title="No projects yet" className="mt-12">
            Name one above, or type <span className="text-muted">@project</span> in the capture bar.
          </EmptyState>
        ) : (
          <>
            <ul className="space-y-0.5">
              {active.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  openCount={openCounts.get(project.id) ?? 0}
                />
              ))}
            </ul>

            {archived.length > 0 && (
              <details className="mt-6 px-3">
                <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wider text-faint">
                  Archived · {archived.length}
                </summary>
                <ul className="mt-1 space-y-0.5">
                  {archived.map((project) => (
                    <ProjectRow
                      key={project.id}
                      project={project}
                      openCount={openCounts.get(project.id) ?? 0}
                    />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function ProjectRow({ project, openCount }: { project: Project; openCount: number }) {
  const replica = useReplica();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.name);

  function startRename(): void {
    setDraft(project.name);
    setEditing(true);
  }

  function commitRename(): void {
    const trimmed = draft.trim();
    setEditing(false);
    if (trimmed.length === 0 || trimmed === project.name) return;
    replica.document.updateProject(project.id, { name: trimmed });
  }

  return (
    <li className="group flex items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 transition-colors hover:border-line hover:bg-panel">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: project.color ?? "var(--accent)" }}
        aria-hidden="true"
      />

      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitRename();
              if (event.key === "Escape") {
                setDraft(project.name);
                setEditing(false);
              }
            }}
            aria-label="Project name"
            className="w-full rounded-md border border-line bg-canvas px-2 py-1 text-sm text-ink focus:outline-none"
          />
        ) : (
          <p className={`truncate text-sm ${project.archivedAt ? "text-faint" : "text-ink"}`}>
            {project.name}
          </p>
        )}
        <p className="mt-0.5 text-[11px] text-faint">
          {openCount === 0
            ? "No open tasks"
            : `${openCount} open ${openCount === 1 ? "task" : "tasks"}`}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Rename ${project.name}`}
          onClick={startRename}
          className="touch"
        >
          Rename
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`${project.archivedAt ? "Unarchive" : "Archive"} ${project.name}`}
          onClick={() =>
            replica.document.updateProject(project.id, {
              archivedAt: project.archivedAt ? null : new Date().toISOString(),
            })
          }
          className="touch"
        >
          {project.archivedAt ? "Unarchive" : "Archive"}
        </Button>
      </div>
    </li>
  );
}
