# Decisions

The rules that shape Planner.

- One Loro document per workspace. `WorkspaceDocument` is the only writer; every write is validated
  by the Zod schema in `@suite/planner-core`.
- The main process holds the authoritative document. The renderer keeps a replica and streams CRDT
  deltas over a validated IPC bridge.
- Document truth never lives in Zustand, React state or localStorage.
- A task owns its day. The inbox holds captured work until it is given one.
- Checklist items are subtasks of one task, not separate tasks.
- Recurrence is a projection over the stored series; occurrences are not copied into the document.
- Estimates are compared with daily capacity. The app does not time-block the calendar.
- The calendar is local. There is no calendar account and no network client.
- The workspace is one `.planner` file, written atomically with a temp-file rename and one rolling
  backup.
- A schema bump is additive or it migrates. An older file opens and is upgraded on open; a newer
  one is refused with a sentence naming Planner and both versions, and is never rewritten by an
  older build. Schema 2 added `settings.notificationsAskedAt`.
- Capture is one line: project, tag, estimate, priority and time are parsed from the text.
- Navigation renders from one view registry. An id the build does not register opens today.
- UI uses Tailwind v4 with Radix primitives. There is no Turborepo.
- The gate is local: `pnpm check` to edit, `pnpm verify` for the full gate.
- Sync is a designed seam with no transport yet.
