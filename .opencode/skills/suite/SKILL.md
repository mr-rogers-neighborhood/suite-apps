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
| `suite-canvas` | `apps/suite-canvas/AGENTS.md` | `node scripts/gate.mjs --only suite-canvas` |
| `suite-planner` | `apps/suite-planner/AGENTS.md` | `node scripts/gate.mjs --only suite-planner` |
| `suite-budget` | `apps/suite-budget/AGENTS.md` | `node scripts/gate.mjs --only suite-budget` |
| `suite-go` | `apps/suite-go/AGENTS.md` | `node scripts/gate.mjs --only suite-go` |
| `suite-sync` | `apps/suite-sync/README.md`, `docs/` | `node scripts/gate.mjs --only suite-sync` |
| `suite-start` | `apps/suite-start/README.md`, `docs/` | `node scripts/gate.mjs --only suite-start` |

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

## Cross-app flow

The old `suite-dev` harness is `harness/` and is reference only. The build and
release commands now live at the root:

- `pnpm --filter @suite/start run package:dir` builds the hub.
- `pnpm --filter @suite/start exec electron-builder --linux AppImage` builds
  the AppImage.
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
