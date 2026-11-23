# Run the gate

The gate is local, and CI runs the same command. Every claim about a change being verified names the
command that produced it.

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

## What CI runs

CI selects rows from the diff, it does not guess: the `detect` job calls the same helper a person can
call, then each row runs the gate above.

```sh
mise exec -- node scripts/affected.mjs --base origin/main
```

A docs-only change selects no app; a shared-package change selects every app that depends on it; a
path the map does not understand selects every row. Run it before pushing to see what the pull request
will run.

## Prove the commit, not the tree

`--fresh` exports `HEAD` with `git archive`, installs from the lockfile, and runs the same order in
that clean tree:

```sh
mise exec -- node scripts/gate.mjs --fresh
```

Use it when uncommitted files could be hiding a dependency, or when you are about to publish.

`--no-e2e` skips the cross-app Playwright suite for a quick loop. It does not make the run equivalent
to a full gate; say that the e2e suite was skipped.

`--only <repo>` writes a status that names that repository. It is a loop, not a suite proof:
The Flatpak publisher and `release-status.mjs` refuse a publish on it, so run the full gate before a
release.

The suite launches the real Electron app, so the gate runs it under `xvfb-run` whenever that is
installed — including on a desktop session, where it would otherwise open a burst of windows over
whatever the person is doing. With no `xvfb-run`, a desktop session skips the suite and the status
file records `e2e: false`; install Xvfb, run the gate on the VM, or pass `--e2e` to accept the
windows. A headless host with neither a display nor `xvfb-run` fails the run rather than pretending
it passed.

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

## CI is the proof

`main` runs the full fresh gate on every push (`main-gate`), and the merge queue runs the affected
rows plus Start's e2e. The `vm` remote and the `scripts/ci/` hook are retired; nothing else needs to be
scheduled, and `suite-dev` remains only the LAN Flatpak test host.
