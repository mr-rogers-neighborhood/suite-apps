# Migration record

This repository is a fresh import of the seven `suite-*` repositories. History
was not rewritten; each source tree was imported from the commit below with
`git archive`, which carries tracked files only. The original repositories remain
at `~/Projects/suite/` as read-only archives.

The published repository at <https://github.com/mr-rogers-neighborhood/suite-apps>
is the **renamed `suite-canvas` repository**. On 2026-11-20 `suite-canvas` was
renamed to `suite-apps` and this monorepo's `main` replaced its contents, so the
stars and the Canvas releases stayed with the project. The repository first
published as `suite-apps` is now `suite-apps-1`, a bootstrap snapshot. Canvas's
pre-import history is kept on the `legacy/canvas` branch at `d93ebb7`.

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

- Canvas's doc indexes were regenerated after the import. `git log` now has one
  commit for every imported page, so the generator can only report the import
  date; the original per-page dates remain in the archived repositories under
  `~/Projects/suite/`.
- The per-repo `pnpm-lock.yaml` files are vestigial. The root lockfile is the
  only one that should be installed or committed.
- Committed `dist/` output under the shared packages can be removed once the
  root build order is proven.
- `harness/` still contains `suite-dev`'s sibling-repo scripts; those become
  root scripts as the monorepo workflow settles.

## Publishing and archive state (2026-11-20)

- Canonical: <https://github.com/mr-rogers-neighborhood/suite-apps>. It is the
  renamed `suite-canvas` repository, so its stars and its 0.1.0–0.1.9 releases
  came with it. `legacy/canvas` holds Canvas's pre-import `main` (`d93ebb7`).
- `suite-apps-1` is the bootstrap snapshot: the first monorepo publish, before the
  rename. It is not canonical and needs no releases.
- Archived on GitHub: `suite-dev` (replaced by `harness/`) and `suite-go` (no
  releases and no feed references).
- Still active: `suite-planner`, `suite-budget`, `suite-start` (their
  `releases/latest/download` URLs are the update feeds compiled into installed
  apps) and `suite-sync` (the server's separate release and trust boundary).
- Archiving a feed repository does **not** stop downloads: release assets stay
  available, which was verified before archiving anything. It only stops new
  releases. The four feed repositories can therefore be archived once the
  monorepo publishes its own feeds; until then they are the last published
  version, not a live pipeline.
- A monorepo `releases/latest` cannot serve four different `latest-linux.yml`
  files; per-app feeds need per-app tags or a static feed host.
