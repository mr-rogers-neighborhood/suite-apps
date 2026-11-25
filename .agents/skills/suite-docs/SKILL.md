---
name: suite-docs
description: Write or review Suite Help's module narratives, tours, and code-index notes. Use when doing documentation work, choosing symbols to explain, validating notes or tours, or reviewing prose before it is marked human-authored.
---

# Suite docs

Suite Help is the reader: **Browser / Modules / Tours** over one generated index of every file and
declaration. The index derives reference facts. `docs/modules/` and `docs/tours/` are the authored
layer. `docs/` is the handbook and notes archive.

Read `legacy/help/AGENTS.md` and `legacy/help/README.md` before editing.

## Commands

```sh
mise exec -- pnpm docs:index          # rebuild public/data
mise exec -- pnpm docs:index:check    # validate notes, tours and generated data
mise exec -- pnpm docs:coverage       # gaps; report only, never fails
mise exec -- pnpm docs:explain <id>   # scaffold one note section
mise exec -- pnpm docs:build          # headless app build
```

Do not run `pnpm docs:dev`, Electron, or Playwright in a headless session.

## Authoring rules

- One MDX per **module**, not per file.
- Frontmatter: `module`, `title`, `summary`.
- Narrative at the top: what the module owns and what it deliberately does not.
- `## <node-id>` sections for 6–12 important exported symbols. Not every symbol.
- A tour is `docs/tours/<id>.mdx`: intro, then headings that are real node IDs.
  `## interlude: <title>` is a chapter. `### overlay: <title>` inside a step adds a commentary card.
- A composed tour is `docs/tours/<id>.tour.mjs` and only exists when the path crosses module, file,
  symbol, tour, or doc targets, or needs an overlay that is not prose.
- Keep tour notes short and deictic; the durable explanation belongs in the module note.
- Never mirror a signature or narrate line by line. Explain why, invariants, failure modes, and test
  intent.
- Get node IDs from `legacy/help/public/data/search.json`; never invent one.
- **Never add `reviewed: human`.** That is a person's claim after reading or rewriting the prose.

## Choosing what to write

Priority is the tour, then the module:

1. Modules referenced by the flagship tours (`open-a-document`, `write-through-the-graph`,
   `install-and-launch`, `sync-seal-and-deliver`).
2. Missing module notes for a tour: `pnpm docs:coverage` and the tour headings show them.
3. Largest modules with no prose. Add a narrative and selective notes; do not chase 100% symbol
   coverage.

## Review gate

- `pnpm docs:index:check` passes.
- `mise exec -- pnpm --dir legacy/help lint` passes.
- A person reads the prose, fixes claims against the code, and only then adds `reviewed: human`.
- Work in a branch or worktree; open a pull request. Do not merge your own review.
