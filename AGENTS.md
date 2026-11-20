# suite-apps

This is one workspace, not seven repositories. The product rules still belong to
each app:

| Before editing | Read | Gate |
| --- | --- | --- |
| `apps/suite-canvas` | `apps/suite-canvas/AGENTS.md` | `node scripts/gate.mjs --only suite-canvas` |
| `apps/suite-planner` | `apps/suite-planner/AGENTS.md` | `node scripts/gate.mjs --only suite-planner` |
| `apps/suite-budget` | `apps/suite-budget/AGENTS.md` | `node scripts/gate.mjs --only suite-budget` |
| `apps/suite-go` | `apps/suite-go/AGENTS.md` | `node scripts/gate.mjs --only suite-go` |
| `apps/suite-sync` | `apps/suite-sync/README.md` and `docs/` | `node scripts/gate.mjs --only suite-sync` |
| `apps/suite-start` | `apps/suite-start/README.md` and `docs/` | `node scripts/gate.mjs --only suite-start` |

The full gate is `node scripts/gate.mjs`; `--fresh` proves the commit rather
than the working tree. Use `mise exec --` so Node 22 and pnpm 12.17 resolve.

The independent gate runs on `suite-dev`: pushing `main` to the `vm` remote
queues the same gate there, in a memory-capped unit. Results are in
`~/ci/status.json` on the VM and `ssh suite-dev cat ~/ci/status.json` from here.
See `scripts/ci/` and the README.

## Publishing and archives

- `origin` is <https://github.com/mr-rogers-neighborhood/suite-apps>.
- `vm` is the independent gate. Push the commit you want gated:
  `git push origin main && git push vm main`.
- `suite-dev` is archived on GitHub; the import replaced it under `harness/`.
- The five `suite-canvas`, `suite-planner`, `suite-budget`, `suite-start` and
  `suite-sync` repositories are **still active on purpose**. Their
  `releases/latest/download` URLs are the update feeds in every `suite.app.json`
  and in Start's own builder config. Archiving them now would stop new releases
  on the path installed apps actually read.
- Retire them only after the monorepo publishes per-app feeds and the manifests
  point at the new location. A single monorepo `releases/latest` cannot serve
  four different `latest-linux.yml` files; use per-app release tags or a static
  feed host.

## Monorepo rules

- Shared packages are `workspace:*`. Never reintroduce a `git+https://…#vX`
  pin or a `link:../suite-*` path.
- A repository-root script must name its own packages. Bare `pnpm -r` now means
  all 28 projects and recurses through every app. `typecheck` and `build` are
  already scoped; keep them that way.
- `@suite/desktop` is the shared Electron policy package. Canvas's shell is
  `@suite/canvas-desktop`.
- Biome and Vitest versions are per-repo on purpose. Do not hoist a newer one
  without running the owning app's gate.
- `harness/` is the old suite-dev orchestrator. Do not add new work there.

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
- Conventional commits. A decision that changes the shape gets an ADR in the
  owning repo.

If a change needs another app edited to work, stop and coordinate; changing a
sibling to make one app pass is not the fix.
