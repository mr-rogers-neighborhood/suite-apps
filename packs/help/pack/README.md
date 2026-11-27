# Help's pack source

Help's renderer, handbook and generated code index built as a signed desktop pack. The layout is
the convention in [docs/spec/repo-structure.md R2.2](../../../docs/spec/repo-structure.md#2-packs),
and the authoring steps live in [the pack authoring reference](../../../docs/reference/pack-authoring.md).

- `manifest.json` is the source manifest; its version tracks `legacy/help/package.json`. Its
  `capabilities` list is empty **by decision**: Help reads only the index and pages inside its own
  archive, writes no document, opens no file and opens no socket. The host grants it nothing beyond
  loading the bundle, and the entry's own CSP seals the network as well.
- `src/renderer/` is the shared renderer: the explorer, the handbook reader and the desktop entry.
  The desktop shell in `legacy/help` compiles the same files, so there is one copy. It consumes
  `@suite/ui` for the shared shells; `styles.css` scans that package's `dist/`, and both Vite
  configs name one React copy because the package is linked by workspace path.
- `src/main.tsx` is the pack entry. It mounts the shared `App` under `HashRouter`, because a host
  serves one entry file and answers only files that exist; the desktop entry beside the renderer
  keeps `BrowserRouter` and its SPA fallback.
- `src/source.ts` is the handbook loader for this root. It differs from the shared loader in one
  string: `defineDocs.dir` is resolved against the Vite root, and this build's root is `pack/`.
- `../scripts/` generates the explorer index and mirrors `docs/` into `packs/help/.generated/docs`.
  The desktop shell runs the same scripts through its own `index` and `sync` commands.
- `vite.config.ts` builds the renderer, the compiled MDX pages and the copied `public/data` index
  into `packs/help/.dev/pack`, outside this source tree.
- From the repository root, `pnpm help:pack` regenerates the index and handbook, builds and signs the
  archive. `pnpm help:pack --check-repro` builds twice and compares every payload path and SHA-256,
  with no signing key.

Nothing generated belongs here: `node scripts/pack-shape.mjs` fails the gate if a `dist/` or
`node_modules/` appears under `pack/`.

## Phone and the shared shells

The reader is one document at every width. Nothing is hidden behind a breakpoint except the
navigator, and the reading column keeps its source order.

| At phone width (360–430px) | What happens |
| --- | --- |
| Explorer frame | Under a host, the host draws the one bar and Help publishes its sections into it; standalone, `AppShell` from `@suite/ui` owns the header, the one `<h1>` and the content region. |
| Navigator | A drawer from the header (standalone) or the host's Contents toggle (hosted), with the same search, views, tree, modules and tours. Selecting anything closes it. |
| Page list | `ListView` renders the module sections (Apps, Packages, Tools, Config) and the search results as a listbox: one tab stop, arrows, Home/End, Enter. |
| Document pane | `DetailView` owns a file or symbol's title, breadcrumb subtitle, GitHub/Copy actions and scrolling body. |
| Handbook | The page tree and search stay in a drawer; long tables scroll inside the article and code blocks scroll inside themselves. |
| Targets | 44px for controls at `max-width: 767.98px`, including the header, drawer, explorer rows and handbook links. |

The explorer's data and loading logic stay in `src/renderer/explorer/`; the shells take nodes and
own no selection, route or domain type. `AppShell` gained one small extension for this: its
desktop column reads `--shell-nav-width` (default `14rem`), so the explorer's existing resizable
rail keeps working without forking the frame. The desktop shell compiles the same renderer; its
`electron.vite.config.ts` is untouched.

When Suite Desk drives Help, both the reader and the explorer detect the host's menu bridge and
publish their material instead of drawing a header: the current page name, a **Help sections**
menu (explorer, tours, the other section, GitHub) and, below `md`, a **Contents** toggle. The
reader drops its fixed 56px band and its `pt-14` offset, and the explorer passes `header={null}` to
`AppShell`; the visible page `<h1>` stays in the document in both cases. Standalone, nothing
changes: no bridge means the pack draws its own header exactly as before.

The pack still declares **no capability**. It reads the generated index and compiled pages inside
its own archive and opens no file, document or socket. The mobile layout adds no fetch and no
host call.

## What still needs a person's device or window pass (#358)

- Measure the 44px targets and the drawer with TalkBack on a real phone, including the code
  viewer's inner horizontal scroll.
- Open the handbook keyboard on a phone and confirm the search field, the page and the sticky
  header do not overlap.
- Resize a desktop window across 768px and confirm the rail/drawer swap keeps the selected node
  and its scroll position.
- Confirm the desktop Help window still builds and reads the same pages after the `@suite/ui`
  adoption.

## The bundled corpus

The archive carries both halves of Help's content:

- `data/*.json` — the generated tree, modules, search, tours, tour membership, `docs.json` (the
  audience index behind the two sections), handbook search and one file per module, exactly what
  `pnpm docs:index` writes.
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
