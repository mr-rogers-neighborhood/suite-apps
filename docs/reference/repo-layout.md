# Repository layout

One pnpm workspace at the root. Seven shipped apps under `apps/`, a host spike beside them, shared
packages under `packages/`, and one lockfile for all of them.

```
apps/
  canvas/       @suite/canvas renderer; desktop/ shell;
                packages/graph, packages/import-obsidian; e2e, docs, handbook, internal
  planner/      @suite/planner desktop app; pack/; packages/core; docs
  budget/       @suite/budget desktop app; pack/; packages/core; docs
  start/        @suite/start hub; docs, e2e
  help/         @suite/help documentation app: explorer and handbook
  sync/         @suite/sync-server; packages/protocol, packages/host; deploy, docs
  go/           @suite/go-app mobile container; packages/go contract; docs
  shell/        @suite/shell host spike: one window, sandboxed packs, space document
packages/       contracts, files, document-runtime, screens, desktop, theme, ui,
                pack, pack-runtime, pack-host
docs/           Cross-cutting documentation
packaging/      Flatpak manifests
scripts/        gate.mjs, flatpak.mjs, ci/, docs-check.mjs
```

`apps/help` renders the explorer over `docs/modules/`, `docs/tours/` and the generated index, and
renders `docs/` as the handbook. It is offline, ships through Flatpak, and never owns a documentation
fact: the code and `docs/` are the source of truth.

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
| `@suite/planner-core` | `apps/planner/packages/core` | Planner schema and document layer |
| `@suite/budget` | `apps/budget` | Budget |
| `@suite/budget-core` | `apps/budget/packages/core` | Budget schema and document layer |
| `@suite/start` | `apps/start` | Hub |
| `@suite/help` | `apps/help` | Documentation app: explorer and handbook |
| `@suite/sync-server` | `apps/sync` | Sync server |
| `@suite/sync-app` | `apps/sync/app` | Sync tray app and its embedded relay |
| `@suite/sync` | `apps/sync/packages/protocol` | Sync protocol |
| `@suite/host` | `apps/sync/packages/host` | Sync host |
| `@suite/go-app` | `apps/go` | Go container |
| `@suite/go` | `apps/go/packages/go` | Go module contract |
| `@suite/shell` | `apps/shell` | Desktop host spike |
| `@suite/contracts` | `packages/contracts` | Shared app and deployment contracts |
| `@suite/files` | `packages/files` | Shared file envelopes |
| `@suite/document-runtime` | `packages/document-runtime` | Shared document replica and atomic store |
| `@suite/screens` | `packages/screens` | Shared Screens contract: `suite.screen` shape, Loro document, widget registry and Start's dashboard migration |
| `@suite/desktop` | `packages/desktop` | Shared Electron policy |
| `@suite/theme` | `packages/theme` | Shared theme variables |
| `@suite/ui` | `packages/ui` | Shared chrome |
| `@suite/pack` | `packages/pack` | Pack manifest, capabilities, contributions and signature |
| `@suite/pack-runtime` | `packages/pack-runtime` | Pack-side service types |
| `@suite/pack-host` | `packages/pack-host` | Scoped pack file store, locks and backups |

## App-private and shared

An app's private packages stay with it: `apps/canvas/packages/graph` is Canvas's, even though it is a
workspace package. Only `@suite/contracts`, `@suite/files`, `@suite/document-runtime`,
`@suite/screens`, `@suite/desktop`, `@suite/theme`, `@suite/ui`, `@suite/pack`,
`@suite/pack-runtime` and `@suite/pack-host` are shared; they live at the root.

## Two names that look alike

`@suite/desktop` is the shared Electron policy package. Canvas's own shell is
`@suite/canvas-desktop`.
