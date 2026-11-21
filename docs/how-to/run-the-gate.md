# Run the gate

The gate is local. Every claim about a change being verified names the command that produced it.

## A normal change

Start with the owning app's check while you edit:

```sh
cd apps/canvas
pnpm check
```

Run the root gate before you commit when the change touches a shared package, more than one app, the
workspace configuration, or a script:

```sh
mise exec -- node scripts/gate.mjs
```

`--only` runs one app's checks:

```sh
mise exec -- node scripts/gate.mjs --only canvas
```

## Prove the commit, not the tree

`--fresh` exports `HEAD` with `git archive`, installs from the lockfile, and runs the same order in
that clean tree:

```sh
mise exec -- node scripts/gate.mjs --fresh
```

Use it when uncommitted files could be hiding a dependency, or when you are about to publish.

`--no-e2e` skips the cross-app Playwright suite for a quick loop. It does not make the run equivalent
to a full gate; say that the e2e suite was skipped.

## Export retention

A passing `--fresh` run keeps its own export and the previous proof under `.dev/gate/`; older export
directories are deleted once `.dev/gate-status.json` has been written. The export in use is never
removed, and tarballs or entries that do not look like a commit sha are left alone.

A failed run keeps every export, because the tree it ran in is the evidence for the failure. A
`--dry` run deletes nothing.

## Memory

The first monorepo gate fanned out across every package and took the desktop down. Cap heavy runs:

```sh
systemd-run --user --scope -p MemoryHigh=10G -p MemoryMax=15G \
  --setenv=NODE_OPTIONS=--max-old-space-size=3072 \
  mise exec -- node scripts/gate.mjs
```

## Docs

```sh
mise exec -- node scripts/docs-check.mjs
```

Run it with any documentation change. It checks relative links, section index coverage, and retired
phrases.

## When a check fails

1. Read the exact command and the first error, not the last line of the fan-out.
2. Re-run that app's check alone.
3. If the failure is in another app, report it rather than editing that app to make this one pass.

## The independent gate

`git push vm main` queues the same `--fresh` gate on the `suite-dev` machine in a capped unit. Read the
result with:

```sh
ssh suite-dev cat ~/ci/status.json
ssh suite-dev tail -f ~/ci/logs/<sha>.log
```

The run is capped at 5 GiB high and 6 GiB max, and takes a lock so a second push waits rather than
doubling memory. See `scripts/ci/` for the setup.
