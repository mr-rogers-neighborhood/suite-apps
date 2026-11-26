# packages/ui

The shared component base. Read the repository `AGENTS.md`, [`README.md`](README.md), and the
[`storybook-workbench` skill](../../.agents/skills/storybook-workbench/SKILL.md) before changing it.

## Rules for this package

- **The workbench is the contract.** A component or pattern is not done until it has a story, an
  axe-green render, a `play` test where it interacts, and a local screenshot. The owner starts
  Storybook; do not launch a dev server, Electron or a headed browser yourself.
- **Tokens, never literals.** Every colour, radius, shadow and duration is a `var(--role)` from
  `@suite/theme`. `src/tokenLiterals.test.ts` enforces it; do not add a `bg-black`, `rounded-2xl`,
  `shadow-lg` or `duration-200`.
- **One surface, one owner.** `HostTabBar` and `NewTabPicker` are host chrome, not pack primitives.
  Packs import `@suite/ui`; host-only code belongs behind the `@suite/ui/chrome` subpath.
- **Status is part of the API.** Tag a story `status:experimental`, `status:ready` or
  `status:deprecated`. A deprecation names its replacement. A pattern is tagged `layer:pattern`.
- **No app knowledge.** A primitive takes nodes, data and callbacks. It does not read a store, a
  route, a document or a host service.
- **Use the Storybook MCP before guessing props.** Query `docs-list` / `docs-show`, and run
  `test-run` to check the result. The endpoint is `http://localhost:6007/mcp` while Storybook runs.

## Checks

```sh
mise exec -- pnpm --filter @suite/ui typecheck
mise exec -- pnpm --filter @suite/ui test
mise exec -- pnpm --filter @suite/ui test:stories
mise exec -- pnpm --filter @suite/ui build-storybook
```

`pnpm --filter @suite/ui check` runs all of them in order. `typecheck` covers `src/**/*.tsx` and
`.storybook/**/*`; the test runner owns its own files.
