# Contribute a change

Read the owning app's `AGENTS.md` before editing its code. It is the entry point for humans and agents,
and it names the gate that app expects.

| If you change | Read first |
| --- | --- |
| Canvas | `apps/canvas/AGENTS.md` |
| Planner | `apps/planner/AGENTS.md` |
| Budget | `apps/budget/AGENTS.md` |
| Go | `apps/go/AGENTS.md` |
| Start | `apps/start/README.md` and `docs/` |
| Sync | `apps/sync/README.md` and `docs/` |
| Docs only | [docs/README.md](../README.md) |

## One app per change

Shared packages are `workspace:*`. A change that needs a sibling app edited is coordinated, not made
from the other app. Do not change another app to make yours pass.

## Branch and commits

Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`. Keep a commit to one
intent. Do not commit a lockfile from a nested app or secrets. The shared packages under `packages/*`
commit their `dist/` output on purpose, and the Start package's `build:verify` proves it has not
drifted; other `dist/` directories stay out of git.

## Issues

The tracker follows the shape of the work, not the other way round:

- An **epic** states an outcome and why it is next. Its work is sub-issues, so progress rolls up.
- A **task** is one shippable change: context, work, done-when, and the command that proves it.
- A **bug** names what happens, what should happen, and how to reproduce it.

Labels are `kind:epic` or `kind:task`, one `area:` (`delivery`, `sync`, `mobile`, `apps`, `hygiene`),
and one `priority:` from `p0` to `p3`. The milestone names the phase, not the app; an app's state
belongs in its README and changelog.

A task that cannot name its verification command is not ready to start. A task that changes a product
claim moves the owning doc in the same change.

## Documentation

- A behaviour change updates the page that owns the fact in the same change.
- A shape change updates [Decisions](../reference/decisions.md) and the owning page.
- Do not copy a paragraph to a second page. Link to the first.
- Do not restate a version. Link to `package.json` or the changelog.
- Run `mise exec -- node scripts/docs-check.mjs`.

## Verify

```sh
cd apps/<app>
pnpm check
```

Then the root gate when the change crosses an app or a shared package:

```sh
mise exec -- node scripts/gate.mjs
```

The per-app gates do not run Playwright. The root gate runs Start's e2e suite after the checks, under
`xvfb-run` when there is no display; `--no-e2e` skips it. Other Playwright suites run on request. If
you ran one, say which command; a claim without a command is not a verification.

## Records

An ADR is written once and then left alone. A later decision supersedes it and both records say so.
Never renumber or delete a record.

## Security

Report a vulnerability per the owning app's `SECURITY.md`. Do not open a public issue with details.

## Licence

MIT. By contributing you agree the change is available under that licence.
