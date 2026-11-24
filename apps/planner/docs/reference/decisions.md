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
- The calendar is local. There is no calendar account and no calendar feed; sync carries the
  workspace file, not an external calendar.
- The workspace is one `.planner` file, written atomically with a temp-file rename and one rolling
  backup.
- A schema bump is additive or it migrates. An older file opens and is upgraded on open; a newer
  one is refused with a sentence naming Planner and both versions, and is never rewritten by an
  older build. Schema 2 added `settings.notificationsAskedAt`.
- Capture is one line: project, tag, estimate, priority and time are parsed from the text.
- Navigation renders from one view registry. An id the build does not register opens today.
- UI uses Tailwind v4 with Radix primitives. There is no Turborepo.
- The gate is local: `pnpm check` to edit, `pnpm verify` for the full gate.
- A note is a Loro root at `note:<taskId>`, not a task field. A rich note is a `LoroMap` tree beside
  the legacy `LoroText` at the same key, rather than a replacement for it: an older build keeps
  reading the text it wrote, and the editor prefers the map once it exists. The fallback is what makes
  the upgrade one-way instead of rewriting every note or breaking an older build.
- Carry-over is a report, not a reschedule. `weekPlan` lists the unfinished, non-recurring tasks from
  before today; nothing moves until a person presses **Move to today** or drags one.
- A recurring task's day is its series anchor. `scheduledFor` anchors the series, so a projected
  occurrence has no independent day to drag; the week view leaves it in place.
- Sync is a relay a person runs, not a Suite service. A workspace is carried by sealed MLS frames
  over `@suite/sync`; the relay stores ciphertext and signed metadata and never reads a document.
  The main process holds the keys, the socket and the certificate pin, the renderer holds none of
  them, and the file stays the only document. A reachable relay serves `wss://` with a self-signed
  certificate the main process pins by SHA-256; the default remains loopback. See [sync.md](sync.md).
- A friend code names an installation, and a contact is a local trust decision. `sync/contacts.json`
  stays in main, outside the `.planner` file and the relay store. An invitation from a known code
  connects without a second certificate question; an unknown code is refused with the code to add.

## Planner as a shell pack

A pack has no main process. The host owns the file; the pack owns what is inside it. The split for
the Planner pack (`apps/planner/pack`) is deliberate, not a copy of Budget's list:

| Responsibility                                                    | Owner                         | Why                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document envelope (magic, header, schema stamp, payload checksum) | Host                          | S6.1. The host reads the header and never parses a `.planner` payload.                                                                                                                                                                                                                                                                    |
| Atomic write, one rolling backup, crash recovery, quarantine      | Host                          | S6.2. The pack deliberately keeps **no** second `.bak`: two backup schemes can disagree about which file is current, and a pack that keeps a second one is worse than one that keeps none.                                                                                                                                                |
| Document identity and scope (`documents/<container>/planner`)     | Host                          | A pack asks for an id; an absolute path never crosses the bridge.                                                                                                                                                                                                                                                                         |
| Schema, `WorkspaceDocument`, validation, projections              | Pack                          | The host must never learn a Planner field.                                                                                                                                                                                                                                                                                                |
| Schema upgrade on open                                            | Pack                          | `WorkspaceDocument.fromSnapshot` upgrades or refuses before a record is read. The manifest declares no `migrations` entry: the upgrade needs the Loro payload and schema, so the host's declared-entry invocation adds no value here. If a migration ever has to run before the payload is handed over, it becomes a declared entry then. |
| Debounced snapshot write at ADR-0005 boundaries                   | Pack                          | Main used to own this; the pack now does it through `documents.save`, and the host makes the write atomic and backed up.                                                                                                                                                                                                                  |
| Export and import                                                 | Pack, through the host picker | The pack encodes and decodes its own `.planner` file; the host owns the picker and the destination, and the pack only ever sees a handle and a display name.                                                                                                                                                                              |
| Reminder scheduler, tray, menu and commands                       | Main, released Flatpak only   | The shell has no `notifications`, `recents` or `commands` service. The pack reports reminders unsupported instead of pretending to schedule them, and it registers no command.                                                                                                                                                            |
| Sync socket, identity keys, contacts                              | Main, released Flatpak only   | The shell has no `relay` service, and a pack must never hold a document key. The pack exposes no sync methods, so the renderer hides the surface.                                                                                                                                                                                         |

Planner's main process survives **only for the released Flatpak**, the same position Budget is in and
more so: Planner's main process also owns the tray, the reminder scheduler, the workspace paths, the
custom protocol and the sync service, none of which have moved. The pack imports none of `src/main`
and does not duplicate the store; `docs/reference/status.md` keeps Planner frozen with its code and
last artifact, so the Flatpak remains the authority for that release while the pack proves the next
host.
