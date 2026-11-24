# Budget's pack source

Budget's renderer built as a signed desktop pack. The layout is the convention in
[docs/spec/repo-structure.md R2.2](../../../docs/spec/repo-structure.md#2-packs), and the authoring
steps live in [the pack authoring reference](../../../docs/reference/pack-authoring.md).

- `manifest.json` is the source manifest; its version tracks `apps/budget/package.json`.
- `src/` holds the prelude and the bridge, with their tests.
- `vite.config.ts` builds into `apps/budget/.dev/pack`, outside this source tree.
- `pnpm --dir ../.. run budget:pack` builds and signs the archive.

Nothing generated belongs here: `node scripts/pack-shape.mjs` fails the gate if a `dist/` or
`node_modules/` appears under `pack/`.
