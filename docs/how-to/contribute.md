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
intent. Do not commit a `dist/` directory, a lockfile from a nested app, or secrets.

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

Playwright runs on request, not by default. If you ran it, say which command. If you did not, say that
too; a claim without a command is not a verification.

## Records

An ADR is written once and then left alone. A later decision supersedes it and both records say so.
Never renumber or delete a record.

## Security

Report a vulnerability per the owning app's `SECURITY.md`. Do not open a public issue with details.

## Licence

MIT. By contributing you agree the change is available under that licence.
