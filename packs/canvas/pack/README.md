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
  the host's file picker. It also uses the host's file-and-library surface: reveal the open document
  where the host keeps it, read the host's recent list, notice a document that changed while the pack
  was closed and while it is open, and copy a person-chosen folder into the pack's own root.
- `src/PackRender.test.tsx` mounts Canvas's own renderer over the same services the shell's preload
  exposes and opens a board, edits it, saves it, exports it and re-imports it.
- `vite.config.ts` builds into `packs/canvas/.dev/pack`, outside this source tree.
- `pnpm canvas:pack` builds and signs the archive.

Nothing generated belongs here: `node scripts/pack-shape.mjs` fails the gate if a `dist/` or
`node_modules/` appears under `pack/`.

The host gaps this conversion first found are closed by the host's file-and-library surface: reveal,
the recent list, the document watch and folder import are host services the pack calls without a path.
The sync relay is still a host gap, and the pack carries no transport of its own. The
[implementation ledger](../../../docs/spec/ledger.md) owns the clause-level evidence.
