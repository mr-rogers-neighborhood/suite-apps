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
| `suite-help` | `apps/help/AGENTS.md` and `README.md` | `node scripts/gate.mjs --only help` |

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

Suite Help is the reader: Browser, Modules and Tours over one generated index of every file and
declaration. Module narratives live in `docs/modules/`; tours in `docs/tours/`; the older pages under
`docs/` are the handbook and notes archive. Each app keeps its own `apps/<app>/docs/` beside its
code.

- One module MDX, not one file MDX. A module narrative plus `## <node-id>` sections.
- A tour is an ordered list of real node IDs. A composed `.tour.mjs` exists only when a path
  crosses targets or needs an overlay.
- Run `pnpm docs:index:check` with any docs change; `pnpm docs:coverage` reports gaps without
  failing. `pnpm docs:explain <node-id>` scaffolds one note.
- Prose is generated until a person reviews it. Only a person adds `reviewed: human`; an agent must
  never add that marker to its own prose.
- Do not launch `pnpm docs:dev`, Electron or Playwright in a headless session. Build and the
  `index:check` are headless.
- One fact has one home. Fix the owning page, link from the rest, and never restate a version.
- Current rules are in `docs/reference/decisions.md`, with one page per app. There is no ADR archive
  in the reading path.

Every change lands through a branch or worktree and a pull request; a direct push to `main` is an
explicit owner checkpoint.

## Cross-app flow

The build and release commands live at the root:

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
- Conventional commits; a decision that changes the shape updates the owning
  app's `docs/reference/decisions.md`.
