import type { Tag, Task } from "@suite/planner-core";
import { Button, EmptyState } from "@suite/ui";
import { useState } from "react";

import { useReplica, useWorkspaceSnapshot } from "../store/snapshotStore";

export function TagsView() {
  const snapshot = useWorkspaceSnapshot();
  const replica = useReplica();
  const [name, setName] = useState("");

  function addTag(): void {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    replica.document.createTag({ name: trimmed });
    setName("");
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Tags">
      <header className="border-b border-line px-6 pb-4 pt-5">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-xl font-semibold tracking-tight">Tags</h1>
          <span className="text-xs text-faint">
            {snapshot.tags.length === 0
              ? "none yet"
              : `${snapshot.tags.length} ${snapshot.tags.length === 1 ? "tag" : "tags"}`}
          </span>
        </div>
        <p className="mt-1 text-xs text-faint">
          Labels cut across projects. A tag is only a name and a colour; the tasks carry it.
        </p>
      </header>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          addTag();
        }}
        className="flex items-center gap-2 px-6 pt-4"
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label="New tag name"
          placeholder="A new tag"
          className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 py-2 text-sm text-ink placeholder:text-faint focus:outline-none"
        />
        <Button size="sm" type="submit" disabled={name.trim().length === 0}>
          Add tag
        </Button>
      </form>

      <div className="mt-4 flex-1 overflow-y-auto px-6 pb-24">
        {snapshot.tags.length === 0 ? (
          <EmptyState title="No tags yet" className="mt-12">
            Label one above, or type <span className="text-muted">@tag</span> in the capture bar.
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {snapshot.tags.map((tag) => (
              <TagRow
                key={tag.id}
                tag={tag}
                tasks={snapshot.tasks.filter((task) => task.tagIds.includes(tag.id))}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function TagRow({ tag, tasks }: { tag: Tag; tasks: Task[] }) {
  return (
    <li className="rounded-xl border border-transparent px-3 py-2.5 transition-colors hover:border-line hover:bg-panel">
      <div className="flex items-center gap-2">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: tag.color ?? "var(--accent)" }}
          aria-hidden="true"
        />
        <p className="min-w-0 flex-1 truncate text-sm text-ink">#{tag.name}</p>
        <span className="text-[11px] text-faint">
          {tasks.length === 0
            ? "no tasks"
            : `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`}
        </span>
      </div>

      {tasks.length === 0 ? (
        <p className="mt-1 pl-4 text-[11px] text-faint">
          No tasks carry this tag yet. Add <span className="text-muted">@{tag.name}</span> to a
          task&apos;s capture line.
        </p>
      ) : (
        <ul className="mt-1 space-y-0.5 pl-4">
          {tasks.map((task) => (
            <li
              key={task.id}
              className={`truncate text-xs ${task.status === "done" ? "text-faint line-through" : "text-muted"}`}
            >
              {task.title}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
