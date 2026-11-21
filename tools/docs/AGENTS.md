# tools/docs

The local documentation reader and code explorer, not an app. Read the repository `AGENTS.md` first,
then `tools/docs/README.md` for the model and its limits.

## Rules for this directory

- The code, `docs/` and each app's `docs/` are the source of truth. Never edit `public/data/` or
  `.generated/docs/`; run `pnpm docs:index` / `pnpm docs:dev` to regenerate.
- Do not add a new Diátaxis page. The explorer is the structure; new explanations go in
  `docs/modules/`, new guided paths in `docs/walkthroughs/`. `docs/` keeps the older notes archive.
- One authored MDX per module, not per file. `docs/modules/<module>.mdx` holds the narrative and
  `## <node-id>` notes. The explorer splits by file and declaration at render time.
- A walkthrough is an ordered list of node IDs, not a copy of the code. Authored walks live in
  `docs/walkthroughs/`; the full descent is generated. A composed tour lives in
  `docs/walkthroughs/*.tour.mjs` and only exists when it crosses targets or needs a callout; a normal
  walk derives its tour from its steps.
- Do not generate prose for every symbol. Compiler facts and optional notes; generated entries say
  so.
- Do not add `tools/docs` to `pnpm build`, the release path, or a shipped package.
- Keep the explorer shell below the 3.5rem header. Both panes scroll independently; no page-level
  sticky.

## Commands

```sh
mise exec -- pnpm docs:index
mise exec -- pnpm docs:index:check
mise exec -- pnpm docs:coverage
mise exec -- pnpm docs:explain <node-id>
mise exec -- pnpm docs:dev
mise exec -- pnpm docs:dev:bg
mise exec -- pnpm docs:status
mise exec -- pnpm docs:logs
mise exec -- pnpm docs:stop
mise exec -- pnpm docs:build
mise exec -- pnpm docs:start
mise exec -- pnpm docs:clean
```

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
