---
audience: developer
---

# Repository layout

One pnpm workspace at the root. Hosts under `hosts/`, the frozen apps and their shells under
`legacy/`, pack source under `packs/`, the relay under `services/`, shared packages under
`packages/`, and one lockfile for all of them.

```
hosts/
  desk/         @suite/desk host: one window, sandboxed packs, space document
  go/           @suite/go-app mobile container; packages/go contract; docs
legacy/
  canvas/       @suite/canvas shell and build; desktop/ Electron shell;
                e2e, docs, handbook, internal
  planner/      @suite/planner desktop app; docs (renderer and core live outside)
  budget/       @suite/budget desktop app; docs (core lives in the pack)
  help/         @suite/help Electron shell for the documentation app
packs/
  canvas/pack/  Canvas pack prelude and bridge
  canvas/src/   Canvas renderer shared with the shell
  canvas/packages/ Canvas's private graph and import-obsidian packages
  planner/pack/ Planner pack source
  budget/pack/  Budget pack source
  budget/packages/core/ Budget's core document layer, owned by the pack
  help/         @suite/help-pack: shared renderer, docs generator and pack source
services/
  relay/        @suite/sync-server; packages/protocol, packages/host; app, deploy, docs
packages/       contracts, files, document-runtime, screens, desktop, theme, ui,
                pack, pack-runtime, pack-host, planner-core
docs/           Cross-cutting documentation
packaging/      Flatpak manifests
scripts/        gate.mjs, flatpak.mjs, ci/, docs-check.mjs
```

`packs/help/pack/src/renderer` renders the explorer over `docs/modules/`, `docs/tours/` and the
generated index, and renders `docs/` as the handbook; `legacy/help` is the Electron shell around it.
It is offline, ships through Flatpak, and never owns a documentation fact: the code and `docs/` are
the source of truth.

`pnpm-workspace.yaml` includes `hosts/*`, `hosts/*/packages/*`, `legacy/*`, `legacy/*/*`,
`legacy/*/packages/*`, `packs/*`, `packs/*/packages/*`, `services/*`, `services/*/*`,
`services/*/packages/*` and `packages/*`. It
also owns the overrides, patches and build permissions the apps need.

## Packages

| Package | Directory | Owner |
| --- | --- | --- |
| `@suite/canvas` | `legacy/canvas` | Canvas shell and build |
| `@suite/canvas-pack` | `packs/canvas` | Canvas pack build |
| `@suite/canvas-desktop` | `legacy/canvas/desktop` | Canvas Electron shell |
| `@suite/graph` | `packs/canvas/packages/graph` | Canvas schema and document layer |
| `@suite/import-obsidian` | `packs/canvas/packages/import-obsidian` | Canvas import |
| `@suite/planner` | `legacy/planner` | Planner |
| `@suite/planner-pack` | `packs/planner` | Planner pack build |
| `@suite/planner-core` | `packages/planner-core` | Planner schema and document layer |
| `@suite/budget` | `legacy/budget` | Budget |
| `@suite/budget-pack` | `packs/budget` | Budget pack build |
| `@suite/budget-core` | `packs/budget/packages/core` | Budget schema and document layer |
| `@suite/help` | `legacy/help` | Help Electron shell |
| `@suite/help-pack` | `packs/help` | Help renderer, docs generator and pack build |
| `@suite/sync-server` | `services/relay` | Sync server |
| `@suite/sync-app` | `services/relay/app` | The retired relay app the last `run.suite.sync` build packaged |
| `@suite/sync` | `services/relay/packages/protocol` | Sync protocol |
| `@suite/host` | `services/relay/packages/host` | Sync host |
| `@suite/go-app` | `hosts/go` | Go container |
| `@suite/go` | `hosts/go/packages/go` | Go module contract |
| `@suite/desk` | `hosts/desk` | Desktop host |
| `@suite/contracts` | `packages/contracts` | Shared app and deployment contracts |
| `@suite/files` | `packages/files` | Shared file envelopes |
| `@suite/document-runtime` | `packages/document-runtime` | Shared document replica and atomic store |
| `@suite/screens` | `packages/screens` | Shared Screens contract: `suite.screen` shape, Loro document and widget registry |
| `@suite/desktop` | `packages/desktop` | Shared Electron policy |
| `@suite/theme` | `packages/theme` | Shared theme variables |
| `@suite/ui` | `packages/ui` | Shared chrome |
| `@suite/pack` | `packages/pack` | Pack manifest, capabilities, contributions and signature |
| `@suite/pack-runtime` | `packages/pack-runtime` | Pack-side service types |
| `@suite/pack-host` | `packages/pack-host` | Scoped pack file store, locks and backups |

## App-private and shared

An app's private packages stay with it: `packs/canvas/packages/graph` is Canvas's, even though it is a
workspace package. Only `@suite/contracts`, `@suite/files`, `@suite/document-runtime`,
`@suite/screens`, `@suite/desktop`, `@suite/theme`, `@suite/ui`, `@suite/pack`,
`@suite/pack-runtime` and `@suite/pack-host` are shared; they live at the root.

## Two names that look alike

`@suite/desktop` is the shared Electron policy package. Canvas's own shell is
`@suite/canvas-desktop`.
