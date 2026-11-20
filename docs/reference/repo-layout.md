# Repository layout

One pnpm workspace at the root. Six apps under `apps/`, shared packages under `packages/`, and one
lockfile for all of them.

```
apps/
  canvas/       @suite/canvas renderer; desktop/ shell;
                packages/graph, packages/import-obsidian; e2e, docs, handbook, internal
  planner/      @suite/planner desktop app; pack/; packages/core; docs
  budget/       @suite/budget desktop app; packages/core; docs
  start/        @suite/start hub; packaging/arch; docs, e2e
  sync/         @suite/sync-server; packages/protocol, packages/host; deploy, docs
  go/           @suite/go-app mobile container; packages/go contract; docs
packages/       contracts, files, desktop, theme, ui
docs/           Cross-cutting documentation
packaging/      Flatpak manifests
scripts/        gate.mjs, flatpak.mjs, ci/, docs-check.mjs
```

`pnpm-workspace.yaml` includes `apps/*`, `apps/*/*`, `apps/*/packages/*` and `packages/*`. It also
owns the overrides, patches and build permissions the apps need.

## Packages

| Package | Directory | Owner |
| --- | --- | --- |
| `@suite/canvas` | `apps/canvas` | Canvas renderer |
| `@suite/canvas-desktop` | `apps/canvas/desktop` | Canvas Electron shell |
| `@suite/graph` | `apps/canvas/packages/graph` | Canvas schema and document layer |
| `@suite/import-obsidian` | `apps/canvas/packages/import-obsidian` | Canvas import |
| `@suite/planner` | `apps/planner` | Planner |
| `@suite/planner-pack` | `apps/planner/pack` | Planner as a Go pack |
| `@suite/planner-core` | `apps/planner/packages/core` | Planner schema and document layer |
| `@suite/budget` | `apps/budget` | Budget |
| `@suite/budget-core` | `apps/budget/packages/core` | Budget schema and document layer |
| `@suite/start` | `apps/start` | Hub |
| `@suite/sync-server` | `apps/sync` | Sync server |
| `@suite/sync` | `apps/sync/packages/protocol` | Sync protocol |
| `@suite/host` | `apps/sync/packages/host` | Sync host |
| `@suite/go-app` | `apps/go` | Go container |
| `@suite/go` | `apps/go/packages/go` | Go module contract |
| `@suite/contracts` | `packages/contracts` | Shared app and deployment contracts |
| `@suite/files` | `packages/files` | Shared file envelopes |
| `@suite/desktop` | `packages/desktop` | Shared Electron policy |
| `@suite/theme` | `packages/theme` | Shared theme variables |
| `@suite/ui` | `packages/ui` | Shared chrome |

## App-private and shared

An app's private packages stay with it: `apps/canvas/packages/graph` is Canvas's, even though it is a
workspace package. Only `@suite/contracts`, `@suite/files`, `@suite/desktop`, `@suite/theme` and
`@suite/ui` are shared; they live at the root.

## Two names that look alike

`@suite/desktop` is the shared Electron policy package. Canvas's own shell is
`@suite/canvas-desktop`.
