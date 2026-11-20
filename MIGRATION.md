# Migration record

This repository is a fresh import of the seven `suite-*` repositories. History
was not rewritten; each source tree was imported from the commit below with
`git archive`, which carries tracked files only. The original repositories remain
at `~/Projects/suite/` as read-only archives.

| Imported as | Source | Commit | Date |
| --- | --- | --- | --- |
| `apps/suite-canvas` | `suite-canvas` | `d93ebb72f04980257bc8c1da9b75121e8b7e3087` | 2026-11-18 |
| `apps/suite-planner` | `suite-planner` | `1a8321a56f71ea9c1727e691406882fd4dae3209` | 2026-11-18 |
| `apps/suite-budget` | `suite-budget` | `59237058baf3d0f56ab2cf04743d01e23d0d9426` | 2026-11-08 |
| `apps/suite-start` | `suite-start` | `578e9d0a4be506fcb7d44bc64d031445834020fe` | 2026-11-18 |
| `apps/suite-sync` | `suite-sync` | `14c204746c5f3a55c42f477a3907406c75962ade` | 2026-11-18 |
| `apps/suite-go` | `suite-go` | `839af44acd70d1e390009fc27d976ee3b5051a96` | 2026-11-18 |
| `harness/` | `suite-dev` | `fe279fa19eadf9409e77f9469789027d63b62b35` | 2026-11-18 |

## What changed at import

- The source repositories' directory names were preserved under `apps/`, so the
  existing relative `link:` and direct `../suite-*` references still resolve.
- Every `git+https://…#vX&path:/packages/…` dependency now reads `workspace:*`.
  The shared packages are the ones already present in `apps/suite-start/packages`
  and `apps/suite-sync/packages`.
- Canvas's Electron shell package was renamed `@suite/desktop` →
  `@suite/canvas-desktop`. `@suite/desktop` now unambiguously means the shared
  policy package in `apps/suite-start/packages/desktop`.
- The root `pnpm-workspace.yaml` owns the canvas overrides, patches, and build
  permissions that used to live in `apps/suite-canvas/pnpm-workspace.yaml`.

## Known follow-up

- The per-repo `pnpm-lock.yaml` files are vestigial. The root lockfile is the
  only one that should be installed or committed.
- Committed `dist/` output under the shared packages can be removed once the
  root build order is proven.
- `harness/` still contains `suite-dev`'s sibling-repo scripts; those become
  root scripts as the monorepo workflow settles.
