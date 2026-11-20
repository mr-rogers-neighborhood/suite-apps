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
mise exec -- node scripts/gate.mjs --no-e2e        # skip the cross-app browser suite
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

Playwright is not part of any per-change gate. Run it when the owner asks for a run or names a
milestone.

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

## The independent gate

`git push vm main` queues the same `--fresh` gate on the `suite-dev` machine, in a memory-capped
unit. The result is in `~/ci/status.json` there:

```sh
ssh suite-dev cat ~/ci/status.json
ssh suite-dev tail -f ~/ci/logs/<sha>.log
```

See `scripts/ci/` and [Run the gate](../how-to/run-the-gate.md).
