# Suite Budget

**A local-first envelope budget.** Give every dollar a job, import transactions from your bank's CSV,
and keep the ledger in one file you own — in an Electron app that opens without a network and has no
account, no server, and no telemetry.

Suite Budget is the money app in the Suite family, alongside
[Suite Canvas](../canvas/README.md) and
[Suite Planner](../planner/README.md).

> Suite Budget is pre-alpha. The core loop works: a launcher, accounts, transactions, the month grid,
> rollover, reconcile, undo, and a `.budget` file with rolling backups. Targets, rules, schedules,
> CSV/QIF import, and reports are in place as well; the app still changes shape between releases.

---

For the product story and the influences behind it, read
[What Suite is](../../docs/explanation/why-suite-exists.md).

## What it does

- **Envelopes, not forecasts.** Only money that exists in on-budget accounts can be assigned. Positive
  Available carries forward; a negative envelope is shown, closed at the month boundary, and deducted
  from the next month's Ready to Assign.
- **Credit cards are accounts.** A card is an on-budget account with a negative balance. There is no
  hidden payment category and no automatic money movement.
- **A real register.** Splits, transfers, payees, memos, flags, cleared and reconciled rows. A transfer
  is a pair of linked records; a split is a parent with child records.
- **Nothing is trapped.** Export a `.budget` file, plain JSON records, transactions as CSV, or QIF.
  Import CSV, QIF, native JSON, or another `.budget`.
- **Offline by design.** No network client, no updater, no analytics. Bank sync is deliberately
  absent; Start's catalogue is what checks Budget's feed.
- **Two shipped forms.** Budget ships as an AppImage and as the Flatpak `run.suite.budget`.

## Run it

Node and pnpm (pinned in the root `package.json`) and a display (Electron). pnpm is the only package manager.

```sh
pnpm install
pnpm dev        # Electron window, Vite renderer with hot reload
```

Other commands:

```sh
pnpm check      # the edit loop: biome, tsc, changed tests, shape
pnpm verify     # lint, types, all tests, shape, knip, build, Storybook build
pnpm test       # every Vitest project
pnpm storybook  # component workshop on :6006
pnpm build      # required before the Playwright journey, which launches the built app
pnpm e2e:smoke  # Playwright Electron journey; on request, not part of the gate
pnpm package    # electron-builder targets for this platform
```

If there is no display (CI or a container), run the smoke test under Xvfb:

```sh
pnpm build
xvfb-run -a pnpm e2e:smoke
```

## Working in the monorepo

The apps, the hub and the sync server share one repository and one gate. Start with the
[root README](../../README.md), then [Commands](../../docs/reference/commands.md) for the gate and
[Repository layout](../../docs/reference/repo-layout.md) for where each package lives.

## Your file

- Budgets live in `~/Documents/Suite/Budget`, the suite's file-location convention, with the daily
  backups beside them under `.backups/`. The library index (`library.json`) and `recovered/` stay in
  the application directory, because they describe this machine rather than the documents.
  `SUITE_BUDGET_LIBRARY` and `SUITE_BUDGET_DATA` move the two roots for a test or a portable install.
- A pre-release build keeps budgets in `~/Documents/Suite Slop/Budget`. A stable budget handed to it
  is copied there first and never opened in place; export refuses the stable folder.
- A `.budget` file is JSON containing a base64 Loro snapshot and its format/schema versions. It is
  readable by anyone who has the file. **Use OS disk encryption**; the app does not add a passphrase.
- Every save is atomic (temp file → rename), keeps the previous copy, and keeps seven daily backups.
- A damaged file is never overwritten: the app tries the newest backup, then opens recovery mode with a
  copy in `recovered/`.

What changed, in a person's words rather than commits: [CHANGELOG.md](CHANGELOG.md).
Where accessibility stands, and what is checked by hand: [ACCESSIBILITY.md](ACCESSIBILITY.md).

## How it is built

React 19 on Electron, one Loro CRDT document per budget, Zod-validated records, Tailwind v4 with Radix
primitives. The main process owns the authoritative document, the file store, backups, and recovery;
the renderer keeps a replica and streams CRDT deltas over a narrow, validated IPC bridge. Pure
projections compute the month, targets, rules, reports, and imports.

| Path                          | What lives there                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `src`                         | Electron main, preload bridge, React renderer, Storybook, Playwright                |
| `packages/core`               | Schema, `BudgetDocument`, month math, rules, importers, exports, reports, templates |
| `docs/reference`              | Architecture, conventions, data model, interface                                    |
| `docs/reference/decisions.md` | The rules that shape Budget                                                         |

Read [AGENTS.md](AGENTS.md) before contributing (human or agent), and
[docs/reference/architecture.md](docs/reference/architecture.md) for the longer version.

## Security

Report a vulnerability per [SECURITY.md](SECURITY.md). The app makes no network calls and does not
encrypt the budget file; use OS disk encryption.

## Licence

MIT, © Suite contributors.
