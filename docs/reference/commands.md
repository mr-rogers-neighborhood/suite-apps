# Commands

The toolchain is pinned in `package.json`: the Node engine and the pnpm version. `mise exec --` makes
both resolve without relying on the shell's defaults.

```sh
mise exec -- pnpm install
mise exec -- node scripts/gate.mjs
```

## The root gate

```sh
mise exec -- node scripts/gate.mjs                 # this working tree
mise exec -- node scripts/gate.mjs --only canvas
mise exec -- node scripts/gate.mjs --fresh         # this commit, clean install
mise exec -- node scripts/gate.mjs --no-e2e        # skip Start's e2e suite
```

The gate builds the workspace libraries (`packages/*` and `apps/*/packages/*`) once, then runs each
app's own `check:full` in dependency order. It writes `.dev/gate-status.json`. `--fresh` exports `HEAD` with `git archive`,
installs from the lockfile, and runs the same order in that clean tree. The cross-app Playwright suite
runs after the checks, under `xvfb-run` when there is no display.

Run heavy checks under a cap so a fan-out cannot take the desktop with it:

```sh
systemd-run --user --scope -p MemoryHigh=10G -p MemoryMax=15G \
  --setenv=NODE_OPTIONS=--max-old-space-size=3072 \
  mise exec -- node scripts/gate.mjs
```

## Per-app checks

Each app owns its gate. Read `apps/<app>/AGENTS.md` before changing code; the README repeats the
short version.

| App | Command |
| --- | --- |
| Canvas | `pnpm check` (edit loop), `pnpm verify` (full local gate) |
| Planner | `pnpm check`, `pnpm verify` |
| Budget | `pnpm check`, `pnpm verify` |
| Start | `pnpm check` |
| Sync | `pnpm check` |
| Go | `pnpm check` |

Canvas additionally checks docs, cross-references and file shape:

```sh
pnpm docs:check     # links, fences, prose, generated indexes
pnpm docs:symbols   # backticked paths, scripts, ADR references
pnpm shape          # file length, observe sites, raw Loro writes
```

The per-app gates do not run Playwright. The root gate runs Start's e2e suite after the checks, under
`xvfb-run` when there is no display; `--no-e2e` skips it. Other Playwright suites run when the owner
asks for a run or names a milestone.

## Signing keys

```sh
pnpm keys status            # presence, fingerprint, and whether each pin accepts the key
pnpm keys status --strict   # also fail when a key is absent
pnpm keys generate pack     # a new pack signing keypair
pnpm keys generate update   # a new update signing keypair
```

The private halves live outside the repository, and each public half is pinned in the source that
verifies it. [Manage signing keys](../how-to/keys.md) has the directory, the rotation order and what
a backup has to preserve.

## Docs

```sh
mise exec -- node scripts/docs-check.mjs
```

Checks relative links, that each `docs/` section index lists its pages, and a short list of retired
phrases. It is not part of the gate yet; run it with any documentation change.

The local reader renders `docs/` at <http://localhost:3001>. It is not deployed and is not part of
the gate or a release.

```sh
mise exec -- pnpm docs:index     # index every file and declaration into tools/docs/public/data
mise exec -- pnpm docs:index:check # resolve notes, walks and tours; fail on stale generated data
mise exec -- pnpm docs:dev       # index, sync docs/ and start the dev server (foreground)
mise exec -- pnpm docs:dev:bg    # the same, detached; log in .dev/docs.log
mise exec -- pnpm docs:status    # TCP check on the docs port
mise exec -- pnpm docs:logs      # follow the background dev log
mise exec -- pnpm docs:stop      # stop whatever listens on the docs port
mise exec -- pnpm docs:build     # index, sync and build the static pages
mise exec -- pnpm docs:start     # serve the last build
mise exec -- pnpm docs:clean     # remove .next, .generated, .source and public/data
```

`docs:index` runs `tools/docs/scripts/index-code.mjs`: every file and declaration becomes a node,
modules are package roots plus `src/` children, and config files become `config:*` modules. It writes
`tools/docs/public/data/` and is not committed. `docs:index:check` resolves every note heading, walk
step and composed-tour target and compares the generated files with the ones on disk; it exits
nonzero on an unknown ID or stale data. `docs:dev` and `docs:build` also run
`tools/docs/scripts/sync-docs.mjs`, which mirrors `docs/` into `.generated/docs/` with the frontmatter
and sidebar Fumadocs expects.

Open `/explore` for the three-mode explorer. `/docs` remains the reference site. `docs:start` serves
the last build; run `docs:build` first. `docs:stop` uses the docs port, so it also stops a server
started by `pnpm docs:dev` in another terminal.

## The independent gate

`git push vm main` queues the same `--fresh` gate on the `suite-dev` machine, in a memory-capped
unit. The result is in `~/ci/status.json` there:

```sh
ssh suite-dev cat ~/ci/status.json
ssh suite-dev tail -f ~/ci/logs/<sha>.log
```

See `scripts/ci/` and [Run the gate](../how-to/run-the-gate.md).
