# Suite Budget

> **Frozen.** Suite Budget now runs as a signed pack: install **Suite Budget** from the Desk
> catalogue. This Electron app keeps its code and its last `run.suite.budget` Flatpak artifact, and
> gets no new release or pre-release lane. To move a budget: open it here, export a `.budget` file,
> install the pack, and import that file there. The last Flatpak stays published, so an existing
> install still updates to its final ref; `flatpak update --user` is the only path for it.

**A local-first envelope budget.** Give every dollar a job, import transactions from your bank's CSV,
and keep the ledger in one file you own. The Electron app is frozen; the signed pack is the app now.
Both open without a network and have no account, no server, and no telemetry.

Suite Budget is the money app in the Suite family, alongside
[Suite Canvas](../canvas/README.md) and
[Suite Planner](../planner/README.md).

> Suite Budget is pre-alpha. The core loop works: a launcher, accounts, transactions, the month grid,
> rollover, reconcile, undo, and a `.budget` file with rolling backups. Targets, rules, schedules,
> CSV/QIF import, and reports are in place as well; the frozen app no longer changes shape.

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
  absent. The pack updates from the Desk catalogue; a frozen Flatpak, if it is still installed,
  updates through the Flatpak remote, and no Suite process replaces it.
- **One live form, one frozen one.** Budget ships as the signed pack from the Desk catalogue. The
  last shipped artifact is the Flatpak `run.suite.budget`; it stays published and gets no new build.
  There is no Budget pre-release lane.

## Run the frozen app

Node and pnpm (pinned in the root `package.json`) and a display (Electron). pnpm is the only package manager.
This starts the frozen app for reference or for exporting a budget; it is not the release path.

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
- The pack keeps budgets in the host's document store. To move one, export a `.budget` here and
  import it there; the frozen app's `~/Documents/Suite/Budget` files stay where they are.
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
| `../../packs/budget`          | The signed pack: its own renderer copy, prelude, manifest and build                 |
| `docs/reference`              | Architecture, conventions, data model, interface                                    |
| `docs/reference/decisions.md` | The rules that shape Budget                                                         |

Read [AGENTS.md](AGENTS.md) before contributing (human or agent), and
[docs/reference/architecture.md](docs/reference/architecture.md) for the longer version.

## As a desktop pack

`packs/budget` builds Budget as a signed `.suitepack`. The pack owns its renderer copy under
`packs/budget/pack/src/renderer`; this frozen app keeps the last copy and is not an input to the
build. Install **Suite Budget** from the Desk catalogue, or build the archive yourself:

```sh
pnpm budget:pack                 # renderer + prelude + signature
pnpm budget:pack --out /tmp/budget.suitepack
```

The build writes `packs/budget/.dev/pack`, puts the prelude before the app script, and signs the
directory with the pack key pinned in `packages/pack/src/pinnedKey.ts`. A key that does not match the
pin is refused before anything is signed; `pnpm keys status` compares them. The archive lands in
`packs/budget/.dev/` by default.

Inside the pack the renderer still talks only through `BudgetBridge`. The prelude owns the
`BudgetDocument`, applies the renderer's CRDT updates, and writes a snapshot when the page is hidden,
on `pagehide`, and on the host's flush. Documents are identified by their pack document id; the
`path` on a library entry is a display value, never a filesystem path. External `.budget`, JSON, CSV
and QIF files go through the host's `pickOpen`/`pickSave` handles.

The host integration is proven headlessly: the pack test opens, edits, saves, exports and re-imports
a budget, and a signed archive installs and verifies in the host catalogue. A person's window pass
remains. The host has no "show in folder", so reveal is a notice, and the pack has no sync.

## Security

Report a vulnerability per [SECURITY.md](SECURITY.md). The app makes no network calls and does not
encrypt the budget file; use OS disk encryption.

## Licence

MIT, © Suite contributors.
