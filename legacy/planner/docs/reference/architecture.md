# Architecture

Suite Planner is a local-first daily planner. One Loro document per workspace is the source of truth,
`@suite/planner-core` validates every write, and the React app renders projections of that document. A
task exists whether or not it is planned for a day; a day is a date that some tasks point at.

This page is the map. The rules are in [conventions.md](conventions.md), the records in
[data-model.md](data-model.md), and the reasoning in [decisions.md](decisions.md).

## Three rules

1. **Offline works.** The network is not required to open, edit or export a workspace. Sync is
   opt-in, runs through a relay a person hosts, and the file stays the document either way.
2. **Loro owns the document.** The UI reads through `@suite/planner-core` and writes through
   `WorkspaceDocument`, never raw Loro.
3. **Every write is validated.** Zod schemas in `packages/planner-core/src/schema.ts` parse at the boundary
   before a value reaches the CRDT.

## Process model

```
┌────────────────────────── Electron main (authority) ──────────────────────────┐
│  WorkspaceDocument (Loro)  ──►  file store (.planner, atomic write)          │
│         │                                                                     │
│         ├──► reminder scheduler ──► native Notification                      │
│         ├──► sync service ──► sealed frames ──► user-run relay (opt-in)       │
│         └──► IPC: snapshot / commit / export / import / info / sync           │
└───────────────────────────────────────────────────────────────────────────────┘
                                    │ contextBridge, allowlisted channels
┌───────────────────────────────────▼───────────────────────────────────────────┐
│  Renderer (replica)                                                           │
│  React 19 + Vite + Tailwind + Radix                                           │
│    ├── WorkspaceDocument replica (@suite/document-runtime) → snapshot store   │
│    ├── Zustand: UI state only (view, selected date, capture focus, notice)    │
│    └── pure projections: dayPlan, capacityFor, occurrencesBetween, parseCapture│
└───────────────────────────────────────────────────────────────────────────────┘
```

**Boot.** Main loads `workspace.planner` from `~/Documents/Suite/Planner` (the suite's file-location
convention, overridable with `SUITE_PLANNER_LIBRARY`), falls back to `workspace.backup.planner`, and
creates a new document if both are missing or invalid. A workspace left in the old application
directory is copied into the folder once, without deleting the original. A `.planner` path handed over
by the operating system or by the hub replaces the open workspace. The renderer
asks for a snapshot and builds a replica.

**Pre-release isolation.** A build whose manifest or Flatpak id marks it as a pre-release
(`run.suite.slop.planner`) keeps its default workspace in `~/Documents/Suite Slop/Planner`. A
`.planner` file handed to it from anywhere else, including the stable folder, is copied in before it
is opened; the original, its backup and its temporary file are never written. Export is the only write
a person asks for, and it refuses the stable folder. The rule is in
[workspaceLocation.ts](../../src/main/workspaceLocation.ts) and [channel.ts](../../src/main/channel.ts),
with the copy and the untouched original proven in
[workspaceLocation.test.ts](../../src/main/workspaceLocation.test.ts).

**Edits.** The renderer mutates its replica. `subscribeLocalUpdates` emits the CRDT delta; the
snapshot store forwards it over `workspace:commit`, refreshes its derived snapshot, and the UI
re-renders. Main imports the delta and debounces an atomic write (400 ms). The same delta is sealed
into a relay frame when sync is on, so document code did not change when sync arrived. Incoming
frames are applied to the authority and reach the renderer through `workspace:replaced`, the same
replacement path an import uses; [sync.md](sync.md) is the seam.

The replica and the atomic store are the two pieces Planner shares with Budget through
`@suite/document-runtime`. Planner still supplies its own document factory (including the fresh peer
id on load), `.planner` serializer, workspace directory and rolling backup.

**Import.** Main decodes the file, builds a fresh document, validates every record, replaces the
authority and writes it, then broadcasts `workspace:replaced` with a new snapshot. The renderer
replaces its replica and re-subscribes.

**Reminders.** In the released Flatpak main keeps its own document, so the scheduler ticks with no
window open. A due task gets `remindedAt` as a leaf write, which is what stops it repeating.
Changing or clearing `remindAt` resets `remindedAt`, so a new time is a new reminder rather than one
the app believes it already delivered. The pack has no scheduler and no timer: the manifest declares
the `reminders` projection, the pack binds it, and the host calls it on save and on open to receive
display rows. The host owns the queue, permission, delivery and click route; the pack resolves a
clicked `suite://planner/task/<id>` once it is running.

## Navigation

`packs/planner/pack/src/renderer/app/views.ts` is the one registry of surfaces: an id, label, icon and component per
entry. The rail renders the registry in order and the shell renders the resolved component, so a new
surface is an entry and its component, not an edit to `Shell.tsx`, `Sidebar.tsx` and the store. The
rail's "Soon" list stays for surfaces that do not exist yet. An id this build does not register — a
store written by a different build — opens `today` rather than an empty pane. The Week, Projects, Tags
and Upcoming surfaces have their own pages: [Week](week.md),
[projects-tags-upcoming.md](projects-tags-upcoming.md).

## Window chrome

`Shell.tsx` renders the shared `@suite/ui` `MenuBar` above the active view. Its zones carry the material
this app has: the Planner mark as a link back to today, the workspace file's name as context, a compact
view switcher over the same `views` registry, export and import in the actions, and the sync pill. The
rail stays the full navigation, and the bar's switcher is the compact one. The theme is host state:
Suite Desk's **View** menu or Suite Go's **Settings** owns it, so the app carries no picker of its own. Planner has no command palette and no presence, so the search and peers zones stay empty rather
than holding a control that does nothing.

Below `md` the rail is not rendered: the bar's navigation button opens `SidebarDrawer`, which carries the
same navigation and export/import, and the bar hides its wide zones so the day view keeps the width. The bar therefore adds no horizontal scrolling at 360, 390 or 430 px.

The Electron window auto-hides its native menu on Linux and Windows (`autoHideMenuBar`), so the in-app
bar is the visible menu and the native accelerators do not draw a second copy beside it.

## Why main is the authority

The renderer is sandboxed and its lifetime is a window. The scheduler has to outlive the window, and
autosave has to survive a renderer crash. Putting the document in main gives both, and it keeps the
file and notification APIs in the process that is allowed to use them.

The cost is a delta channel and a full-snapshot fallback. Both are small, and both are what the
relay uses: the delta becomes a sealed frame, and a snapshot is what a device that joined late or
reconnected is handed.

## Repo map

| Path                                  | Responsibility                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `src/main`                            | Authority, file store, IPC, tray, scheduler, menu, window, sync                 |
| `src/preload`                         | Typed `PlannerBridge` over `contextBridge`                                      |
| `packs/planner/pack/src/renderer`     | React shell, day and week views, inbox, capture, calendar, theme, sync dialog   |
| `packages/planner-core/src/schema.ts` | Zod records and `z.infer` types                                                 |
| `packages/planner-core/src/loro`      | `WorkspaceDocument` and its domain modules                                      |
| `packages/planner-core/src/plan`      | Pure projections: day and week plans, capacity, recurrence, inbox, search, sort |
| `packages/planner-core/src/capture`   | Pure one-line capture parser                                                    |
| `packages/planner-core/src/file`      | `.planner` envelope, encode/decode, errors                                      |
| `scripts/check-shape.mjs`             | Mechanical rules: file length, observe sites, Loro confinement                  |

## Layers

- **Pure.** `schema`, `plan/*`, `capture/parse`, `dates`, `ids`. No DOM, no Loro, no `fetch`, no
  timers. A test needs none of them.
- **Document.** `loro/*`. Owns the `LoroDoc`, validates writes, commits transactions. The only layer
  allowed to import `loro-crdt`.
- **Shell.** Electron main, preload, file store, scheduler, IPC, React hosts. Owns state and I/O.
- **UI state.** Zustand, UI only. Never a second copy of document truth.

Dependencies point inward: a pure module never imports the document layer, and the document layer
never imports React or Electron.

## Security model

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`.
- No remote content. `setWindowOpenHandler` denies and opens external links in the system browser.
- A Content-Security-Policy is set on responses and repeated in `index.html`.
- Every IPC payload is parsed with Zod in main. Only `Uint8Array` updates cross the commit channel.
- File paths are app-owned except for paths the user picks in a native dialog.
- No telemetry, no analytics, and no network client in the renderer bundle. Main opens a WebSocket
  only when somebody turns sync on, and the payload it carries is sealed before it leaves.

## Decisions

| Question                   | Decision                                         |
| -------------------------- | ------------------------------------------------ |
| Where truth lives          | One Loro document per workspace, owned by main   |
| What runs the UI           | Electron, one Chromium on every OS               |
| Who owns a task's day      | The task owns `scheduledFor` and `order`         |
| What a subtask is          | A checklist item on the task                     |
| How recurrence works       | A pure projection plus per-occurrence completion |
| What sync is               | Sealed frames through a user-run relay           |
| What the calendar holds    | Local events only                                |
| What the UI primitives are | Radix + Tailwind                                 |
| Where the file lives       | App-managed autosave plus export/import          |
| How a day is planned       | Estimates and capacity, not time blocking        |
| How the workspace is built | pnpm scripts, no Turborepo                       |
| What gates a change        | Local commands only                              |

## Not settled

- **Time blocking.** The model has estimates and a day calendar; placing a task on the grid needs a
  start time and a duration, and a conflict rule. It waits for a real request.
- **External calendars.** Google/Outlook need OAuth and a server. `.ics` import/export fits the
  local model and can come first.
- **Integrations.** A `source` field and an adapter seam exist; no adapter ships. Nothing in the
  schema assumes there will never be one.
- **Body search.** Search covers titles, projects and tags in memory. Searching note bodies needs a
  stored index, which is a cache with an invalidation problem; it waits.
- **Multi-window.** The delta channel would merge edits from two windows, but the UI assumes one.
