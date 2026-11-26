# Canvas's pack source

Canvas's renderer built as a signed desktop pack. The layout is the convention in
[docs/spec/repo-structure.md R2.2](../../../docs/spec/repo-structure.md#2-packs), and the authoring
steps live in [the pack authoring reference](../../../docs/reference/pack-authoring.md).

- `manifest.json` is the source manifest; its version tracks `legacy/canvas/package.json`, and its
  `documents` entry declares the `.canvas` workspace format at `SCHEMA_VERSION` from `@suite/graph`.
- `../src/` is Canvas's renderer, its styles, its tests and its test setup. It is the one copy:
  the Electron shell in `legacy/canvas` builds the same source through its own entry.
- `src/prelude.ts` installs `window.suiteDesktop` over the host's `window.suite`; `src/main.ts`
  imports it before the renderer. The renderer's desktop path already owns the document through that
  bridge, so the pack reuses it rather than teaching the app a second storage mode.
- `src/bridge.ts` is the adapter: the host document envelope carries a `.canvas` envelope unchanged,
  and the pack owns the schema, snapshot writes at a durability boundary, and export/import through
  the host's file picker. The debounce, boundary flush, picker handle lifecycle, notices and
  disposal come from `@suite/pack-runtime`'s shared bridge; this file keeps Canvas's envelope, its
  attachment store and its remembered titles. It also uses the host's file-and-library surface:
  reveal the open document where the host keeps it, read the host's recent list, notice a document
  that changed while the pack was closed and while it is open, and copy a person-chosen folder into
  the pack's own root.
- `src/sync/` is the pack's sync, over the host's opaque-frame `relay` service. It reuses
  `@suite/sync-desktop/relay` for the group, cursor, frame queue and reconnect policy, and the
  existing Canvas sync dialog and title pill for the interface. Keys, contacts, relay pins and the
  recovery-kit answer live in the pack's own `files` root under `sync/`; none of them is in
  `localStorage` or the host. `src/sync/adapter.ts` implements the same doors the Electron preload
  exposed, so the renderer keeps one sync UI. `service.test.ts` and `adapter.test.ts` cover the
  capability refusal, the address-and-pin request, key persistence, an opaque frame in both
  directions and the no-document guard.
- `src/PackRender.test.tsx` mounts Canvas's own renderer over the same services the shell's preload
  exposes and opens a board, edits it, saves it, exports it and re-imports it.
- `vite.config.ts` builds into `packs/canvas/.dev/pack`, outside this source tree.
- `pnpm canvas:pack` builds and signs the archive.

Nothing generated belongs here: `node scripts/pack-shape.mjs` fails the gate if a `dist/` or
`node_modules/` appears under `pack/`.

The host gaps this conversion first found are closed by the host's file-and-library surface: reveal,
the recent list, the document watch and folder import are host services the pack calls without a path.
Sync is the same shape: the host supervises the relay and opens the pinned socket, while the pack
holds the group key, seals and opens its own frames, and never hands the host a document. The
[implementation ledger](../../../docs/spec/ledger.md) owns the clause-level evidence.
