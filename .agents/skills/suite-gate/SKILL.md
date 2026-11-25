---
name: suite-gate
description: Run and interpret the Suite gate. Use when verifying a change, choosing a gate row, running typecheck/tests, or when asked about --only, --prelude, --fresh, --no-e2e, gate-status.json, or what a green check proves.
argument-hint: "[row|all] [--fresh] [--no-e2e]"
---

# Suite gate

The root gate runs one prelude, then each app's own `check:full` in dependency order. It is the
same command locally and in CI. Read `docs/reference/commands.md` for the full command page and
`legacy/<app>/AGENTS.md` (or `hosts/<app>/AGENTS.md`) for what that app's check includes; do not restate either here.

## Rows

`scripts/lib/pipeline.mjs` `PIPELINE`, in order:

```text
sync, desk, help, canvas, planner, budget, go
```

Prelude rows, before the pipeline:

- `libraries` — builds `packages/*`, `hosts/*/packages/*`, `legacy/*/packages/*` and `services/*/packages/*`; consumers resolve `dist/`
- `scripts` — the `node --test` checks beside `scripts/`
- `budget pack` — Budget's signed round-trip

A failed row **breaks the loop**. Later rows are skipped, not failed; say "not run" rather than
implying they passed.

## Commands

```sh
mise exec -- node scripts/gate.mjs                    # working tree, all rows
mise exec -- node scripts/gate.mjs --only canvas      # one row; not a suite proof
mise exec -- node scripts/gate.mjs --prelude          # shared libraries + script tests, no row
mise exec -- node scripts/gate.mjs --fresh            # HEAD in a clean export
mise exec -- node scripts/gate.mjs --no-e2e           # skip a row marked with e2e
mise exec -- node scripts/affected.mjs --base origin/main
```

- `--fresh` exports `HEAD` with `git archive` to a sibling of the repo, installs with
  `--frozen-lockfile`, and runs the same order. Use it when the claim is about a commit, not a
  dirty tree.
- `--only` records `only` in `.dev/gate-status.json`; release refuses to publish on it. A
  one-row loop is not evidence the suite passes.
- `--prelude` records `prelude: true` and runs no app row. A trunk push uses it; release refuses
  it because it proves no row.
- `--no-e2e` only matters for a row that marks an e2e suite. No row marks one today (Start's
  suite left with Start, #314), so it currently changes nothing.
- `.dev/gate-status.json` records `ok`, `fresh`, `commit`, `e2e`, `e2eRequested`, `prelude`,
  `only`, `results`. `e2e` is what ran, not what was requested.

For a large fan-out, cap it:

```sh
systemd-run --user --scope -p MemoryHigh=10G -p MemoryMax=15G \
  --setenv=NODE_OPTIONS=--max-old-space-size=3072 \
  mise exec -- node scripts/gate.mjs
```

## Headless rule

Never launch Electron, a Flatpak build, a Storybook dev server, `pnpm dev`, or Playwright on this
machine. They steal focus from whatever the owner is testing. The gate's own checks are headless;
e2e runs only when the owner asks for a run or names a milestone. `docs:dev` is an Electron app;
use `docs:index`, `docs:index:check`, `docs:coverage`, and `docs:build` instead.

## Reporting

- Name the exact command and its result. "Gate passed" without the command is not a claim.
- Distinguish `--only` from the full gate, and a dirty-tree run from `--fresh`.
- If a row was skipped because an earlier row failed, say which row failed first.
- Do not fix unrelated failures to make the gate green; report them.
