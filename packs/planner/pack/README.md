# Planner's pack source

Planner's renderer built as a signed desktop pack. The layout is the convention in
[docs/spec/repo-structure.md R2.2](../../../docs/spec/repo-structure.md#2-packs), and the authoring
steps live in [the pack authoring reference](../../../docs/reference/pack-authoring.md).

- `manifest.json` is the source manifest; its version tracks the app's `package.json`, and its
  `documents` entry declares the workspace at `SCHEMA_VERSION` from `@suite/planner-core` with the
  `reminders` projection. The document layer lives in `packages/planner-core`.
- `capabilities` declares `documents`, `files`, `notifications` and `recents`. `recents` lets the
  launcher list the host's rows for this pack. `optionalCapabilities` declares `relay`: Desk serves
  the opaque frame transport, and a host without it runs the same pack as a local-only planner
  (S7.1). A host that refuses either leaves the surface absent or refused without a crash.
- `src/renderer/` is the one renderer tree: the pack builds it, and the frozen Electron shell in
  `legacy/planner` consumes the same files instead of keeping a second copy. Its `index.html` is the
  shell's page; the pack page is the `index.html` beside `manifest.json`.
- `src/prelude.ts` installs `window.suitePlanner` over the host's `window.suite`; `src/main.ts`
  imports it before the renderer.
- `src/bridge.ts` is the adapter: the host document envelope carries a Loro snapshot unchanged, and
  the pack owns the schema, the snapshot export/import codec and the reminder projection. The
  debounce, boundary flush, picker handle lifecycle, notices and disposal come from
  `@suite/pack-runtime`'s shared bridge; this file keeps Planner's `WorkspaceDocument`.
- `src/sync/` is Planner's sync, run inside the pack. `service.ts` gives the shared
  `@suite/sync-desktop` lifecycle a pack-side identity, store and transport; `identity.ts` keeps the
  Ed25519 installation key in `sync/identity.json`; `stores.ts` keeps the group, relay pin, cursor,
  pending join and contacts under the pack's `files` root; `transport.ts` is the WebSocket-shaped
  adapter over `window.suite.relay`. The relay sees sealed frames only: the host never receives a
  document, a key or a path. `browserNode.ts` and `browserSyncDesktop.ts` are build aliases that keep
  the Node-only halves of the shared packages out of the renderer bundle.
- `src/projection.ts` is the declared reminder projection: it returns display rows from one
  snapshot and never schedules, polls or shows a notification. The host calls it on save and on
  open, then owns the queue and delivery.
- `src/PackRender.test.tsx` mounts Planner's own renderer over the same services the shell's preload
  exposes and exercises a task, a day page, and an export/import pair.
- `vite.config.ts` builds into `packs/planner/.dev/pack`, outside this source tree.
- `pnpm planner:pack` builds and signs the archive.

Mobile follows the pack's Tailwind conventions: views trim their gutter below `sm`, the shell's rail
becomes a drawer, and the `.touch` utility in `theme/styles.css` gives the pack's own small controls
the 44px floor on a coarse pointer or a phone-width viewport. No action is hover-only; the row
overflow menus and inbox buttons are always present.

## Chrome and the shared shells

The frame is `@suite/ui`'s, not Planner's:

| Region | Owner |
| --- | --- |
| Frame, desktop rail column, content region | `AppShell`. The rail is `--shell-nav-width` (228px), so its width is the shared column's, not a second flex child. |
| Top bar | The shared `MenuBar`, passed as `AppShell`'s `header`. It keeps the mark/home, workspace name, view menu, export/import and sync controls. |
| View list (rail and drawer) | `ListView`, labelled "Views". Arrows, Home/End and Enter are the shared listbox pattern; selecting a view updates the store. |
| Calendar side panel | `DetailView` with a title, the selected day as its subtitle, and the scrolling timeline as its body. |

Below `md` the shell is asked for **no** navigation: `useWideViewport` omits the column and the
drawer in `Sidebar.tsx` carries the same `ListView`, so a phone spends its width on the plan. The
rail's brand, `WorkspaceActions` and `PrivacyLine`, the drawer itself, `ViewMenu` (a Radix menu
over Planner's own view registry, not a listbox), the `DayCalendar` timeline, and every view stay
app-specific. They compose the shared shell rather than redrawing it.


Nothing generated belongs here: `node scripts/pack-shape.mjs` fails the gate if a `dist/` or
`node_modules/` appears under `pack/`.
