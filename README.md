# Suite Apps

One workspace for the Suite. The seven `suite-*` repositories were imported here
from their 2026-11-18 HEADs; see [MIGRATION.md](MIGRATION.md) for the exact
commits and the changes made at import.

## Layout

```
apps/
  suite-canvas/    Canvas: the app, its Electron shell, @suite/graph
  suite-planner/   Planner: the app and @suite/planner-core
  suite-budget/    Budget: the app and @suite/budget-core
  suite-start/     The hub, @suite/contracts, @suite/desktop, @suite/files,
                   @suite/theme, @suite/ui
  suite-sync/      @suite/sync protocol, @suite/host, the sync server
  suite-go/        Capacitor container and @suite/go
harness/           the old suite-dev orchestrator, kept for reference
scripts/gate.mjs   the one gate
```

Shared packages resolve with `workspace:*`. A local edit is the edit that
builds; there are no git-tag pins and no sibling-checkout `link:` paths.

## The gate

```sh
mise exec -- node scripts/gate.mjs                 # this working tree
mise exec -- node scripts/gate.mjs --only suite-canvas
mise exec -- node scripts/gate.mjs --fresh         # this commit, clean install
```

The gate runs each repository's own `check:full`, in dependency order:
sync, start, canvas, planner, budget, go. Before that it builds the twelve
`apps/*/packages/*` libraries once: their consumers resolve `@suite/*` through
`dist/`, which is the old repos' turbo `typecheck: dependsOn ["^build"]`. It writes
`.dev/gate-status.json`. `--fresh` exports `HEAD` with `git archive`, installs
from the lockfile, and runs the same order in that clean tree.

Run heavy checks under a memory cap on this machine; the monorepo's first
attempt fanned out across all 28 packages and took the desktop with it:

```sh
systemd-run --user --scope -p MemoryHigh=10G -p MemoryMax=15G \
  --setenv=NODE_OPTIONS=--max-old-space-size=3072 \
  mise exec -- node scripts/gate.mjs
```

## Toolchain

Node 22 and pnpm 12.17 are pinned in `package.json` and the mise config. Biome
and Vitest stay at each repository's locked version: Biome 2.6 formats Markdown
that 2.5 left alone, and Vitest 5.1.1 changes `rejects.toThrow` enough that
Canvas's custom-error assertions lose their message. Do not "upgrade everything"
without running the owning repo's gate.

## Installing Suite Start locally

The hub is built from `apps/suite-start/apps/start`:

```sh
pnpm --filter @suite/start run package:dir
pnpm --filter @suite/start exec electron-builder --linux AppImage --publish never
```

The unpacked build is installed at `~/Applications/Suite/Start/0.3.12/unpacked`
with a desktop entry at `~/.local/share/applications/suite-start.desktop` and
the `suite://` handler in `~/.config/mimeapps.list`. The AppImage needs
`--no-sandbox` because its `chrome-sandbox` cannot be setuid on a read-only
mount; the unpacked build keeps the sandbox. A Flatpak build uses zypak and
avoids that tradeoff.

## The gate on the VM

`suite-dev` is the independent machine. `scripts/ci/bootstrap-vm.sh` prepares it
(idempotent), and from then on a push to `main` is the trigger:

```sh
node scripts/ci/bootstrap-vm.sh     # once, and safe to re-run
git push vm main                    # queues one gate run for that commit

ssh suite-dev cat ~/ci/status.json          # last result
ssh suite-dev tail -f ~/ci/logs/<sha>.log   # one log per commit
```

The bare repository lives at `~/git/suite-apps.git`. Its `post-receive` hook
starts a transient system unit that runs as `aurora` with `MemoryHigh=5G` and
`MemoryMax=6G`; the runner takes a lock, so a second push waits rather than
doubling memory. The run is `node scripts/gate.mjs --fresh`, so the tree under
test is a `git archive` of the commit with a lockfile install.

The VM has 4 vCPU, 8 GiB RAM, and a 4 GiB swapfile; Canvas's gate is the heavy
one. It also needs Docker (Canvas's secret scan runs gitleaks in a container;
the unit gets `SupplementaryGroups=docker`), Xvfb, Electron's GTK libraries and
a Playwright Chromium (`pnpm exec playwright install chromium`) for the story
tests. e2e is installed but not wired into the gate yet.

## Orca memory

Orca keeps a headless terminal emulator with its own scrollback per PTY. On
2026-11-19 a spike (the kernel log names `pacquet-startup`) plus 50,000-row
scrollback took the desktop into OOM.

- Scrollback is back at 5,000 rows (`terminalScrollbackRows`); Orca clamps it at
  50,000 and the buffers are per pane.
- `~/.local/bin/orca-capped` starts Orca in a scope capped at `MemoryHigh=10G`
  and `MemoryMax=16G`, and `orca.desktop` now points at it. A leaked Orca is
  reclaimed inside Orca instead of freezing the machine. The pre-cap entry is at
  `orca.desktop.pre-cap`; an Orca update that rewrites its desktop entry will
  drop the wrapper, so re-check `Exec=` after an update.
- Run heavy checks under the same idea: `systemd-run --user --scope -p
  MemoryMax=… mise exec -- …` rather than at the desktop's mercy.

## Orca

Open `~/Projects/suite-apps` as the project. The old `~/Projects/suite` folder
is the archive of the pre-monorepo checkouts. `harness/` still describes the
sibling-repo workflow; the root gate replaces it.
