# Contributing

Suite is one workspace, not seven repositories, but each app keeps its own product rules and gate.
This page is the entry point; [Contribute a change](docs/how-to/contribute.md) is the full guide from
branch to merge, and it owns the detail rather than repeating it here.

## Where to start

Read [AGENTS.md](AGENTS.md) at the root, then the owning app's `AGENTS.md` before editing its code.
The table of which app files to read is at the top of
[Contribute a change](docs/how-to/contribute.md); use that table rather than a copy here.

## Setup

Node and pnpm are pinned in `package.json`; `mise exec --` resolves both.

```sh
mise exec -- pnpm install
```

Use pnpm. npm and yarn write a lockfile this repository does not read.

## The edit loop

A change is one intent: the code, the test that proves it, and the page that owns the fact. Run the
owning app's check while you work, then the root gate before you ask for review:

```sh
mise exec -- node scripts/gate.mjs              # every row, in dependency order
mise exec -- node scripts/gate.mjs --only desk  # one row
mise exec -- node scripts/gate.mjs --no-e2e     # skip the row's e2e suite
```

`--only` takes a gate row name from `scripts/lib/pipeline.mjs`: `canvas`, `planner`, `budget`, `go`,
`sync`, `help`, `desk` or `ui`. `--fresh` proves the commit rather than the working tree. The gate runs a row's e2e
suite after its checks, under `xvfb-run` when there is no display; no row marks one today. Read
[Commands](docs/reference/commands.md) before running a heavy check.

## Commits and branches

Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`. Keep a commit and a
branch to one intent. Branch from `main`; do not commit a lockfile from a nested app, a secret or a
private path. The shared packages under `packages/*` commit their `dist/` output on purpose: rebuild
the package and check `git diff --exit-code` before committing, and keep other `dist/` directories
out of git.

## Pull requests and review

Open a pull request with the repository template. Name the app or package, and put the exact commands
you ran and what they printed under **Checks**; a claim without a command is not evidence.

1. Ask for a review-only worker. It reads the diff and runs the owning app's headless checks. It may
   comment or request changes, and it never merges, pushes to `main` or publishes.
2. The coordinator runs the owning gate on the pull request's head and enqueues it; the merge queue is
   the last check.
3. A direct push to `main` is only an explicit owner checkpoint.

CI runs the rows a diff can break, `main` runs the prelude, and the merge queue runs the affected
rows and proves the exact SHA.

## Documentation

- One fact has one home. Fix the owning page and link from the rest; do not copy a paragraph to a
  second page.
- Do not restate a version. Link to `package.json` or the changelog.
- A behaviour change updates the page that owns the fact in the same change. A shape change updates
  [Decisions](docs/reference/decisions.md) and the owning page.
- Run `mise exec -- node scripts/docs-check.mjs`. For the Help explorer's generated index, run
  `mise exec -- pnpm docs:index:check`; `mise exec -- pnpm docs:index` regenerates it.

## Security and accessibility

Report a vulnerability privately as [SECURITY.md](SECURITY.md) describes; never open a public issue
with the details. The per-app `SECURITY.md` files keep the threat model for that surface.

Accessibility is part of a change. [ACCESSIBILITY.md](ACCESSIBILITY.md) owns the target and the
current state, and the [criterion map](docs/reference/accessibility/wcag-22-map.md) says what a
statement may claim.

## Licence

MIT, © Suite contributors. By contributing you agree the change is available under that licence.
Participation is covered by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
