# Planner's pack source

Planner's renderer built as a signed desktop pack. The layout is the convention in
[docs/spec/repo-structure.md R2.2](../../../docs/spec/repo-structure.md#2-packs), and the authoring
steps live in [the pack authoring reference](../../../docs/reference/pack-authoring.md).

- `manifest.json` is the source manifest; its version tracks the app's `package.json`, and its
  `documents` entry declares the workspace at `SCHEMA_VERSION` from `@suite/planner-core` with the
  `reminders` projection. The document layer lives in `packages/planner-core`.
- `src/renderer/` is the one renderer tree: the pack builds it, and the frozen Electron shell in
  `legacy/planner` consumes the same files instead of keeping a second copy. Its `index.html` is the
  shell's page; the pack page is the `index.html` beside `manifest.json`.
- `src/prelude.ts` installs `window.suitePlanner` over the host's `window.suite`; `src/main.ts`
  imports it before the renderer.
- `src/bridge.ts` is the adapter: the host document envelope carries a Loro snapshot unchanged, and
  the pack owns the schema, the snapshot export/import codec and the reminder projection. The
  debounce, boundary flush, picker handle lifecycle, notices and disposal come from
  `@suite/pack-runtime`'s shared bridge; this file keeps Planner's `WorkspaceDocument`.
- `src/projection.ts` is the declared reminder projection: it returns display rows from one
  snapshot and never schedules, polls or shows a notification. The host calls it on save and on
  open, then owns the queue and delivery.
- `src/PackRender.test.tsx` mounts Planner's own renderer over the same services the shell's preload
  exposes and exercises a task, a day page, and an export/import pair.
- `vite.config.ts` builds into `packs/planner/.dev/pack`, outside this source tree.
- `pnpm planner:pack` builds and signs the archive.

Nothing generated belongs here: `node scripts/pack-shape.mjs` fails the gate if a `dist/` or
`node_modules/` appears under `pack/`.
