---
name: Suite Workspace
description: Cross-app workflow for the Suite monorepo (canvas, planner, budget, start, go, sync). Use when a task spans more than one app, when running the gate, or when deciding which app's AGENTS.md and checks apply.
---

# Suite workspace

One repository, `suite-apps`, with the six apps under `apps/`. Each app still
owns its rules and its gate; this skill routes you there.

## Read the owning app first

| App | Read before editing | Per-change check |
| --- | --- | --- |
| `suite-canvas` | `apps/canvas/AGENTS.md` | `node scripts/gate.mjs --only canvas` |
| `suite-planner` | `apps/planner/AGENTS.md` | `node scripts/gate.mjs --only planner` |
| `suite-budget` | `apps/budget/AGENTS.md` | `node scripts/gate.mjs --only budget` |
| `suite-go` | `apps/go/AGENTS.md` | `node scripts/gate.mjs --only go` |
| `suite-sync` | `apps/sync/README.md`, `docs/` | `node scripts/gate.mjs --only sync` |
| `suite-start` | `apps/start/README.md`, `docs/` | `node scripts/gate.mjs --only start` |

If a change needs a sibling app edited, stop and coordinate.

## The gate

```sh
mise exec -- node scripts/gate.mjs
mise exec -- node scripts/gate.mjs --fresh
```

Run heavy gates under a memory cap; the first monorepo check fanned out across
all packages before the scripts were scoped:

```sh
systemd-run --user --scope -p MemoryHigh=10G -p MemoryMax=15G \
  --setenv=NODE_OPTIONS=--max-old-space-size=3072 \
  mise exec -- node scripts/gate.mjs
```

`git push vm main` is the independent gate: a push to the VM's bare repository
runs the same `--fresh` gate there in a capped unit. Results are in
`~/ci/status.json` on `suite-dev`; see `scripts/ci/`.

## Documentation

Cross-app docs are in `docs/`: tutorials, how-to, reference and explanation. Each app keeps its own
`apps/<app>/docs/` beside its code.

- One fact has one home. Fix the owning page, link from the rest, and never restate a version.
- Run `node scripts/docs-check.mjs` with any docs change; Canvas also runs `pnpm docs:check`,
  `docs:symbols` and `shape`.
- Current rules are in `docs/reference/decisions.md`, with one page per app. There is no ADR archive
  in the reading path.

## Cross-app flow

The old `suite-dev` harness is `harness/` and is reference only. The build and
release commands now live at the root:

- `pnpm --filter @suite/start run package:dir` builds the hub.
- `pnpm --filter @suite/start exec electron-builder --linux AppImage` builds
  the AppImage.
- `node scripts/flatpak.mjs` packages Canvas for Flatpak and publishes it to
  the local OSTree repo `~/suite-flatpak/repo` (remote `suite-local`). The hub
  is not a Flatpak while it still manages AppImages; see `package.md`.
- The local install, desktop entry and `suite://` handler are described in
  `README.md`.

## Product constraints

- Local-first: no account, no telemetry, no hosted dependency. Data stays in a
  user-owned file.
- `suite-budget`: no bank sync, no network client, no analytics; money is
  integer minor units.
- `suite-go`: the container never reads a document and never learns a domain
  name.
- Document truth goes through each repo's document layer; never raw Loro in a
  component, never document state in Zustand, React state or localStorage.
- Keep the renderer sandboxed (`contextIsolation`, `sandbox`, no
  `nodeIntegration`).
- Conventional commits; an architectural decision gets an ADR in the owning
  app.
