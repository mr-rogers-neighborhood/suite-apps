# Help's pack source

Help's renderer, handbook and generated code index built as a signed desktop pack. The layout is
the convention in [docs/spec/repo-structure.md R2.2](../../../docs/spec/repo-structure.md#2-packs),
and the authoring steps live in [the pack authoring reference](../../../docs/reference/pack-authoring.md).

- `manifest.json` is the source manifest; its version tracks `apps/help/package.json`. Its
  `capabilities` list is empty **by decision**: Help reads only the index and pages inside its own
  archive, writes no document, opens no file and opens no socket. The host grants it nothing beyond
  loading the bundle, and the entry's own CSP seals the network as well.
- `src/main.tsx` is the pack entry. It mounts the app's existing `App` under `HashRouter`, because a
  host serves one entry file and answers only files that exist; the desktop window keeps
  `BrowserRouter` and its SPA fallback.
- `src/source.ts` is the handbook loader for this root. It differs from the app's loader in one
  string: `defineDocs.dir` is resolved against the Vite root, and this build's root is `pack/`.
- `vite.config.ts` builds the renderer, the compiled MDX pages and the copied `public/data` index
  into `apps/help/.dev/pack`, outside this source tree.
- From the repository root, `pnpm help:pack` regenerates the index and handbook, builds and signs the
  archive. `pnpm help:pack --check-repro` builds twice and compares every payload path and SHA-256,
  with no signing key.

Nothing generated belongs here: `node scripts/pack-shape.mjs` fails the gate if a `dist/` or
`node_modules/` appears under `pack/`.

## The bundled corpus

The archive carries both halves of Help's content:

- `data/*.json` — the generated tree, modules, search, tours, tour membership, handbook search and
  one file per module, exactly what `pnpm docs:index` writes.
- `assets/*.js` — the compiled handbook pages and the renderer, including the text of every page
  inside `docs/`.

Both are hashed into the signed manifest. The pack never reads a repository checkout, a docs server
or the network.

## Reproducibility

Help is the first pack whose bytes come from generated content, so the build is checked for it: two
builds of one commit must produce the same path list and the same SHA-256 for every file.
`--check-repro` reports the file count and the digest of the whole payload. If the hashes move
without a source change, the command fails and names the paths rather than shipping a pack whose
hash is not a function of its code.
