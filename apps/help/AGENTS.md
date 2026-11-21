# apps/help

Suite Help is the shipped documentation app. Read the repository `AGENTS.md` first, then this
directory's `README.md` for the explorer and handbook model.

## Rules for this directory

- The code, `docs/` and each app's `docs/` are the source of truth. Never edit `public/data/` or
  `.generated/docs/`; run `pnpm docs:index` / `pnpm docs:build` to regenerate.
- The explorer is the structure. Do not add a new Diátaxis page; new explanations go in
  `docs/modules/`, new guided paths in `docs/tours/`. `docs/` is the older notes archive and the
  handbook source.
- One prose MDX per module, not per file. `docs/modules/<module>.mdx` holds the narrative and
  `## <node-id>` notes. The explorer splits by file and declaration at render time.
- Prose is generated until a person reviews it. Only a person adds `reviewed: human` to a module or
  tour frontmatter; an agent must never add that marker to its own prose.
- A tour is one concept with two authoring forms. A linear tour lives in `docs/tours/*.mdx` and its
  headings are node IDs. A composed tour lives in `docs/tours/*.tour.mjs` and only exists when it
  crosses targets or needs a step that is not prose. Both appear in one Tours list.
- The MDX preamble is the tour intro. `## interlude: <title>` is a chapter and pauses Play.
  `### overlay: <title>` inside a step adds a dismissible commentary card.
- Do not generate prose for every symbol. Compiler facts and optional notes; generated entries say
  so.
- Keep the explorer shell below the 3.5rem header. Both panes scroll independently; no page-level
  sticky.

## App rules

- The renderer is sandboxed: `contextIsolation`, `sandbox`, no `nodeIntegration`, no remote content.
- Production is served from `suite-help://app/`; there is no loopback HTTP server and no `next`.
- The app is offline. Do not add a network client, an updater or an analytics call. Flatpak owns
  updates.
- Generated data belongs in `public/data` and `.generated/docs`; both are ignored. Build and package
  regenerate them from the checkout.
- The handbook is Fumadocs headless: `fumadocs-core` provides the source loader and page tree,
  `fumadocs-mdx/vite` compiles the content, and the React Router provider supplies links. Do not
  bring back `fumadocs-ui` or a Next-specific route.
- Conventional commits. A shape change updates [docs/reference/decisions.md](../../docs/reference/decisions.md).

## Commands

```sh
mise exec -- pnpm docs:index
mise exec -- pnpm docs:index:check
mise exec -- pnpm docs:coverage
mise exec -- pnpm docs:explain <node-id>
mise exec -- pnpm docs:dev
mise exec -- pnpm docs:build
mise exec -- pnpm docs:clean
```

The app's own gate is `pnpm check` (Biome, both `tsc` projects, Vitest) and `pnpm build`. Do not
launch the window, `pnpm dev` or Playwright in a headless session.
