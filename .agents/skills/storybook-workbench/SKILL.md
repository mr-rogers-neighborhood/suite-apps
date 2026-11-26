---
name: storybook-workbench
description: Use when building or reviewing Suite UI in the Storybook workbench, adding stories, patterns or theme proofs, or querying the Storybook MCP. The owner starts Storybook; this skill never starts a dev server.
argument-hint: "[component|screen|theme|mcp]"
---

# Storybook workbench

The single workbench is `packages/ui/.storybook` on **http://localhost:6007**. It is the design
system, the component catalog, the pattern library and the place a screen is drawn before it is
wired into Desk or Go.

## Start here

The owner starts Storybook. Do not run `storybook dev`, `pnpm dev`, Electron or a headed Playwright
run yourself; the repository's headless rule applies.

```sh
mise exec -- pnpm --filter @suite/ui storybook
```

Then open `http://localhost:6007` in Orca's embedded browser. The MCP endpoint is
`http://localhost:6007/mcp`; the OpenCode server entry is named `storybook`.

## MCP first

When the `storybook` MCP server is available, use it before writing component code:

- `docs-list` — documented components and unattached docs.
- `docs-show` — props, the first stories, and the rest of a component's stories.
- `docs-show-story` — the full story and its docs when `docs-show` is not enough.
- `get-storybook-story-instructions` — the current story conventions before authoring.
- `test-run` — run the story and its axe check, then fix what it reports.
- `stories-preview` — a preview or link to show the result.

Never guess a prop that the docs do not name. A story name is not a prop name.

## Story contract

- Title paths: `Components/<Name>` for primitives, `Workbench/<Name>` for host frames, patterns
  and catalog pages, `Packs/<pack>/<Surface>` for a pack slice.
- Tags: `pack:suite|canvas|planner|budget|help`, `layer:primitive|host|pattern|surface`, and
  `status:experimental|ready|deprecated`. The catalog index reads these; do not invent new facets
  without updating `stories.index.json`.
- The preview applies the `theme` (Suite/Solarized/Warm), `mode` (light/dark) and `density`
  (compact/cozy/comfortable) globals from `@suite/theme`; do not hardcode a palette, radius,
  shadow or duration. `src/tokenLiterals.test.ts` fails the package if one appears.
- Every story is an axe test (`a11y: { test: "error" }`). A new violation fails the story.
- Use a `play` function for any interaction worth testing. A visual state with no interaction still
  needs a story.
- For a date-sensitive surface, set `parameters.mockingDate` rather than reading the real clock.

## Checks

```sh
mise exec -- pnpm --filter @suite/ui typecheck
mise exec -- pnpm --filter @suite/ui test
mise exec -- pnpm --filter @suite/ui test:stories
mise exec -- pnpm --filter @suite/ui build-storybook
mise exec -- pnpm --filter @suite/ui check   # all of the above, in order
mise exec -- pnpm --filter @suite/ui capture:workbench   # needs Storybook running
```

`typecheck` covers `src/**/*.tsx` and `.storybook/**/*`; test files are typechecked by their own
runner, not `tsc`.

## Patterns and proof

- A pattern page is task-shaped: when to use it, anatomy, content, keyboard, accessibility, and the
  components it composes. New tab, Home, Settings, Sync and first-run/empty live here.
- A block is done when it has a story, a play test where it interacts, axe green, a local
  screenshot, and a short keyboard/screen-reader note. The checklist lives in
  [`packages/ui/AGENTS.md`](../../../packages/ui/AGENTS.md).
- Visual proof is local: screenshot the story or matrix cell and attach it to the change. There is
  no hosted visual service in the required path. `capture:workbench` writes the pack matrix under
  `.artifacts/workbench/` while Storybook is running.
- Host chrome (`HostTabBar`, `NewTabPicker`) is not pack surface. Packs import `@suite/ui`; the
  `@suite/ui/chrome` subpath is the boundary once it lands.

## Report

Say which story or screen you verified, which commands and MCP tools ran, and what you could not
verify (for example, MCP when Storybook is not running). Do not claim a window check from a story.
