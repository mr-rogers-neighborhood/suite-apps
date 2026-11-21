# suite-apps

This is one workspace, not seven repositories. The product rules still belong to
each app:

| Before editing | Read | Gate |
| --- | --- | --- |
| `apps/canvas` | `apps/canvas/AGENTS.md` | `node scripts/gate.mjs --only canvas` |
| `apps/planner` | `apps/planner/AGENTS.md` | `node scripts/gate.mjs --only planner` |
| `apps/budget` | `apps/budget/AGENTS.md` | `node scripts/gate.mjs --only budget` |
| `apps/go` | `apps/go/AGENTS.md` | `node scripts/gate.mjs --only go` |
| `apps/sync` | `apps/sync/README.md` and `docs/` | `node scripts/gate.mjs --only sync` |
| `apps/start` | `apps/start/README.md` and `docs/` | `node scripts/gate.mjs --only start` |
| `apps/help` | `apps/help/AGENTS.md` and `README.md` | `node scripts/gate.mjs --only help` |

The full gate is `node scripts/gate.mjs`; `--fresh` proves the commit rather
than the working tree. Use `mise exec --` so the Node and pnpm versions pinned
in `package.json` resolve.
The gate runs suite-start's e2e suite after the repository checks pass, under
`xvfb-run` when there is no display; `--no-e2e` skips it for a quick loop.

The independent gate runs on `suite-dev`: pushing `main` to the `vm` remote
queues the same gate there, in a memory-capped unit. Results are in
`~/ci/status.json` on the VM and `ssh suite-dev cat ~/ci/status.json` from here.
See `scripts/ci/` and the README.

## Publishing and archives

- `origin` is <https://github.com/mr-rogers-neighborhood/suite-apps>. It is the
  renamed `suite-canvas` repository: the stars and Canvas's 0.1.0–0.1.9 releases
  moved with it. `legacy/canvas` holds Canvas's pre-import history.
- `suite-apps-1` is the bootstrap snapshot from before the rename. Not canonical.
- `vm` is the independent gate. Push the commit you want gated:
  `git push origin main && git push vm main`.
- `suite-dev` is archived on GitHub; this repository is its successor and owns the
  build and release scripts. `suite-go` is archived too (no releases, no feed
  references).
- `suite-planner`, `suite-budget`, `suite-start` and `suite-sync` are still
  active. The first three carry the `releases/latest/download` URLs compiled into
  installed apps; `suite-sync` is the server's separate trust boundary.
- Archiving a repository **keeps its release assets downloadable**; it only
  stops new releases. That was verified before proposing any archive. So the
  feed repositories can be archived once the monorepo publishes its own feeds,
  and doing so does not break an installed app's update path.
- A single monorepo `releases/latest` cannot serve four different
  `latest-linux.yml` files. Per-app feeds need per-app tags or a static feed
  host, and the manifests must point at the new location.

## Monorepo rules

- Shared packages are `workspace:*`. Never reintroduce a `git+https://…#vX`
  pin or a `link:../suite-*` path.
- A repository-root script must name its own packages. Bare `pnpm -r` now means
  every workspace project and recurses through every app. `typecheck` and
  `build` are already scoped; keep them that way.
- `@suite/desktop` is the shared Electron policy package. Canvas's shell is
  `@suite/canvas-desktop`.
- Biome and Vitest versions are per-repo on purpose. Do not hoist a newer one
  without running the owning app's gate.

## Product constraints

These still hold, from the old workspace skill:

- Local-first: no account, no telemetry, no hosted dependency; data stays in a
  user-owned file.
- `suite-budget`: no bank sync, no network client, no analytics; money is integer
  minor units.
- `suite-go`: the container never reads a document and never learns a domain
  name.
- Document truth goes through each repo's document layer; never raw Loro in a
  component, never document state in Zustand, React state or localStorage.
- Keep the renderer sandboxed (`contextIsolation`, `sandbox`, no
  `nodeIntegration`).
- Conventional commits. A decision that changes the shape updates the owning app's
  `docs/reference/decisions.md`, or [docs/reference/decisions.md](docs/reference/decisions.md)
  when it spans apps.

## Documentation

- Cross-app docs live in `docs/`: module narratives in `docs/modules/`, tours in `docs/tours/`, and
  the older pages as a notes archive. Each app keeps `apps/<app>/docs/` beside its code.
- One fact has one home. Fix the owning page and link from the rest. Never restate a version; link
  to `package.json` or the changelog.
- Docs describe the tree as it is. The flattened layout is a proposal in
  `docs/reference/decisions.md`, not something a page may instruct today.
- Run `node scripts/docs-check.mjs` with any docs change. For the explorer's authored layer, run
  `pnpm docs:index:check`; `pnpm docs:coverage` reports the remaining gaps without failing. Canvas
  also runs its own `docs:check`, `docs:symbols` and `shape`.

If a change needs another app edited to work, stop and coordinate; changing a
sibling to make one app pass is not the fix.
