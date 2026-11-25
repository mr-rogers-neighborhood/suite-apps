# Focus

Focus is one task and one timer. It is a view over `focusSessions` in the workspace document; the
record is in [data-model.md](data-model.md), and the state rule is in
[conventions.md](conventions.md).

## The session record

A session is a `focusSession`:

| Field            | Meaning                                  |
| ---------------- | ---------------------------------------- |
| `id`             | `focus_<uuid>`                           |
| `taskId`         | the task, or `null`                      |
| `startedAt`      | ISO timestamp written on start           |
| `plannedMinutes` | the intended length, a positive integer  |
| `endedAt`        | ISO timestamp written on stop, or `null` |

Start and stop go through the existing `WorkspaceDocument` methods, `startFocusSession` and
`endFocusSession`. The view never writes a session directly and adds no fields.

## The countdown comes from timestamps

The remaining time is computed on render:

```
plannedMinutes * 60 - (now - startedAt)
```

`now` is a transient value that re-renders the view; it is not stored in the document, Zustand or
localStorage. A reload therefore reads the same `startedAt` and `plannedMinutes` and resumes the same
countdown. Once the planned length passes, the view says how far over the session has run.

## Leaving the view

A running session belongs to the document, not to this component. Moving to Today, another view or
another day does not end it. Reopening Focus finds the session whose `endedAt` is still `null` and
continues from its timestamps.

## Today's list

The list shows sessions whose `startedAt` falls on today, including sessions that started before
today's view was opened. Finished rows show the actual duration, `endedAt - startedAt`, not
`plannedMinutes`. A session that was planned for 25 minutes and stopped after 12 reads `12m`.

## Which task

The task picker offers the non-completed tasks in today's plan. A session can point at a task that is
later completed, deleted or rescheduled; the list falls back to "Deleted task" rather than hiding
the history.
