# Budget's pack source

Budget's renderer built as a signed desktop pack. The layout is the convention in
[docs/spec/repo-structure.md R2.2](../../../docs/spec/repo-structure.md#2-packs), and the authoring
steps live in [the pack authoring reference](../../../docs/reference/pack-authoring.md).

- `manifest.json` is the source manifest; its version tracks `apps/budget/package.json`, and its
  `documents` entry declares the snapshot format at `SCHEMA_VERSION` from `@suite/budget-core`.
- `src/` holds the prelude and the bridge, with their tests. `src/PackRender.test.tsx` mounts Budget's
  own renderer over the prelude and exercises the library, an open document, and export/import.
- `vite.config.ts` builds into `apps/budget/.dev/pack`, outside this source tree.
- `pnpm --dir ../.. run budget:pack` builds and signs the archive.

Nothing generated belongs here: `node scripts/pack-shape.mjs` fails the gate if a `dist/` or
`node_modules/` appears under `pack/`.
