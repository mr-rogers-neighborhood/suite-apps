# Budget's pack source

Budget's renderer built as a signed desktop pack. The layout is the convention in
[docs/spec/repo-structure.md R2.2](../../../docs/spec/repo-structure.md#2-packs), and the authoring
steps live in [the pack authoring reference](../../../docs/reference/pack-authoring.md).

- `manifest.json` is the source manifest. Its `version` tracks Budget's app version, and its
  `documents` entry declares the snapshot format at `SCHEMA_VERSION` from `@suite/budget-core`.
  It also names its `ring` (`stable`), the `minHost` it needs and the capabilities it uses.
- `src/renderer/` is the pack's own copy of Budget's renderer, styles, tests and test setup. The
  frozen Electron shell under `legacy/budget/` keeps its last copy and is not an input to this
  build. `../packages/core` is `@suite/budget-core`, the schema and document layer both this pack
  and the frozen shell consume.
- `src/` also holds the prelude and the bridge, with their tests. `src/PackRender.test.tsx` mounts
  the pack renderer over the prelude and opens, edits, saves, exports and re-imports a budget.
- `vite.config.ts` builds into `packs/budget/.dev/pack`, outside this source tree.
- `pnpm --dir ../.. run budget:pack` builds and signs the archive.

Nothing generated belongs here: `node scripts/pack-shape.mjs` fails the gate if a `dist/` or
`node_modules/` appears under `pack/`.
