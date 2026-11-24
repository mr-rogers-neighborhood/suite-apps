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
  absent. Updates arrive through the Flatpak remote; Flatpak owns the deployment, and no Suite
  process replaces it.
- **One shipped form.** Budget ships as the Flatpak `run.suite.budget`. A pre-release is a separate
  branch with its own id and data folder.

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

The host, the apps and the sync server share one repository and one gate. Start with the
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
Where Budget stands against the `beta` promise, and what still needs a person:
[docs/reference/beta-bar.md](docs/reference/beta-bar.md).

## How it is built

React 19 on Electron, one Loro CRDT document per budget, Zod-validated records, Tailwind v4 with Radix
primitives. The main process owns the authoritative document, the file store, backups, and recovery;
the renderer keeps a replica and streams CRDT deltas over a narrow, validated IPC bridge. Pure
projections compute the month, targets, rules, reports, and imports.

| Path                          | What lives there                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `src`                         | Electron main, preload bridge, React renderer, Storybook, Playwright                |
| `packages/core`               | Schema, `BudgetDocument`, month math, rules, importers, exports, reports, templates |
| `pack`                        | The signed desktop pack: renderer build, `window.suiteBudget` prelude, manifest     |
| `docs/reference`              | Architecture, conventions, data model, interface                                    |
| `docs/reference/decisions.md` | The rules that shape Budget                                                         |

Read [AGENTS.md](AGENTS.md) before contributing (human or agent), and
[docs/reference/architecture.md](docs/reference/architecture.md) for the longer version.

## As a desktop pack

`pack/` builds the same renderer with a bridge prelude, for a host that carries the app as a signed
`.suitepack` instead of shipping Budget as its own Electron window.

```sh
pnpm budget:pack                 # renderer + prelude + signature
pnpm budget:pack --out /tmp/budget.suitepack
```

The build writes `apps/budget/pack/dist`, puts the prelude before the app script, and signs the
directory with the pack key pinned in `packages/pack/src/pinnedKey.ts`. A key that does not match the
pin is refused before anything is signed; `pnpm keys status` compares them. The archive lands in
`apps/budget/.dev/` by default.

Inside the pack the renderer still talks only through `BudgetBridge`. The prelude owns the
`BudgetDocument`, applies the renderer's CRDT updates, and writes a snapshot when the page is hidden,
on `pagehide`, and on the host's flush. Documents are identified by their pack document id; the
`path` on a library entry is a display value, never a filesystem path. External `.budget`, JSON, CSV
and QIF files go through the host's `pickOpen`/`pickSave` handles.

What is not built yet: the host has no "show in folder", so reveal is a notice; the pack has no sync;
and the shell integration is not claimed until the host half lands and installs this pack.

## Security

Report a vulnerability per [SECURITY.md](SECURITY.md). The app makes no network calls and does not
encrypt the budget file; use OS disk encryption.

## Licence

MIT, © Suite contributors.
