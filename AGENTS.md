# suite-apps

This is one workspace, not seven repositories. The product rules still belong to
each app:

| Before editing | Read | Gate |
| --- | --- | --- |
| `legacy/canvas` | `legacy/canvas/AGENTS.md` | `node scripts/gate.mjs --only canvas` |
| `legacy/planner` | `legacy/planner/AGENTS.md` | `node scripts/gate.mjs --only planner` |
| `legacy/budget` | `legacy/budget/AGENTS.md` | `node scripts/gate.mjs --only budget` |
| `hosts/go` | `hosts/go/AGENTS.md` | `node scripts/gate.mjs --only go` |
| `services/relay` | `services/relay/README.md` and `docs/` | `node scripts/gate.mjs --only sync` |
| `legacy/help` | `legacy/help/AGENTS.md` and `README.md` | `node scripts/gate.mjs --only help` |
| `hosts/desk` | `hosts/desk/AGENTS.md` and `README.md` | `node scripts/gate.mjs --only desk` |

The full gate is `node scripts/gate.mjs`; `--fresh` proves the commit rather
than the working tree. Use `mise exec --` so the Node and pnpm versions pinned
in `package.json` resolve.
A frozen app's row runs its shell in `legacy/` and then its pack in `packs/`,
sequentially. The gate runs a row's e2e suite after the repository checks pass,
under `xvfb-run` when there is no display; no row marks one today, so `--no-e2e`
changes nothing until the first host suite.
Desktop Proof of Changes (`@proof` specs, `scripts/proof-of-changes.mjs`, and
artifact paths) is documented in
[docs/reference/desktop-proof.md](docs/reference/desktop-proof.md).

CI is the independent proof: the merge queue runs the affected rows and proves
the exact SHA, `main` on push runs the prelude only to confirm the trunk SHA
resolves, and the nightly keeps the full gate. A full `--fresh` run stays
available by dispatch. The old `vm` remote, its
`scripts/ci/` hook and the `suite-dev` gate are retired; `suite-dev` remains only the LAN Flatpak test
host.

## Publishing and archives

- `origin` is <https://github.com/mrrnbhd/suite-apps>. It is the
  renamed `suite-canvas` repository: the stars and Canvas's 0.1.0–0.1.9 releases
  moved with it. `legacy/canvas` holds Canvas's pre-import history.
- `suite-apps-1` is the bootstrap snapshot from before the rename. Not canonical.
- `suite-dev` is archived on GitHub; this repository is its successor and owns the
  build and release scripts. `suite-go` is archived too.
- `suite-planner`, `suite-budget` and `suite-sync` are still active repositories. Desktop apps now
  ship as Flatpaks from the signed OSTree remote. `suite-sync` is retired as a shipped app (#315): the
  signed remote keeps its last published ref, and the relay is still the server's separate trust
  boundary, becoming a host capability.
- Archiving a repository **keeps its release assets downloadable**; it only
  stops new releases. There are no per-app `latest-linux.yml` feeds to preserve:
  the Flatpak remote is the update path. The `sync-v<version>` relay tarballs are
  retired history.

## Releases and pull requests

The signed Flatpak remote is the update path. GitHub Releases are a human mirror:
the rolling `suite-YYYY.MM.DD` release is marked Latest, and the pre-release channel pages
(`suite-nightly-*`, `suite-preview-*`, `suite-slop-*`) are history rather than candidates.
Per-app tags and releases are retired: an app's version lives in its `package.json` and the rolling
release carries it. `RELEASES.md` is generated from the same versions by
`scripts/release-status.mjs`. There is no GitHub Packages channel for the Flatpaks; a relay
container, if it ever exists, is a separate decision.

Every change lands through a branch or worktree and a pull request. A review-only agent reviews the
diff and runs headless checks; it may comment or request changes but never merges. The coordinator
runs the owning gate and enqueues the pull request; the merge queue is the last check. A direct push
to `main` is only an explicit owner checkpoint.

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
  the older pages as a notes archive. Each app keeps its `docs/` beside its code
  under `hosts/`, `legacy/` or `services/`.
- One fact has one home. Fix the owning page and link from the rest. Never restate a version; link
  to `package.json` or the changelog.
- Docs describe the tree as it is. The flattened layout is a proposal in
  `docs/reference/decisions.md`, not something a page may instruct today.
- Run `node scripts/docs-check.mjs` with any docs change. For the explorer's authored layer, run
  `pnpm docs:index:check`; `pnpm docs:coverage` reports the remaining gaps without failing. Canvas
  also runs its own `docs:check`, `docs:symbols` and `shape`.

If a change needs another app edited to work, stop and coordinate; changing a
sibling to make one app pass is not the fix.
