# Decisions

The rules that shape Budget.

- One Loro document per budget. `BudgetDocument` is the only writer; every write is validated by the
  Zod schema in `@suite/budget-core`.
- The main process holds the authoritative document, the file store, backups and recovery. The
  renderer keeps a replica over a validated IPC bridge.
- Money is integer minor units. `parseFloat` and `toFixed` are banned outside `money.ts` and tests.
- The model is envelope budgeting: only money in on-budget accounts can be assigned. A negative
  envelope is shown, closed at the month boundary, and deducted from the next month's Ready to
  Assign.
- Months are sparse. A month exists when it has data.
- A transfer is a pair of linked records. A split is a parent with child records.
- Targets are versioned. Rules are staged before they apply. Schedules are projections; one may enter
  itself only when asked.
- A schedule enters itself only when its **Automatically add transaction** checkbox is on. The default
  is off, so an existing schedule stays advisory. Catch-up posts at most the last 90 days per schedule
  on open and while the app stays open, each occurrence as its own transaction. One batch record
  covers the run; its Undo removes exactly those transactions and restores each schedule's `nextDate`.
- There is no bank sync, no network client, no updater and no analytics.
- An export re-imports as the same money. `Ready to Assign` is reserved and maps back to `rta`; a QIF
  transfer's direction comes from the importing register's amount sign, and the opposite leg is
  dropped; a QIF line break in a name or memo becomes a space. Import uses the destination budget's
  currency and scale, and a `.budget` or records import keeps the one it was written with.
- A separator is not a number. An amount with no digit (`.`, `,`, `(,)`) is refused rather than read
  as zero, and rounding happens once at parse time at the currency scale.
- Accounting is cash basis.
- A damaged file is never overwritten. Saves are atomic, the previous copy is kept, and seven daily
  backups sit beside the document.
- The library index and `recovered/` live in the application directory, not the documents folder.
- Charts are SVG. The interface shows age of money.
- The gate is local: `pnpm check` to edit, `pnpm verify` for the full gate. There is no Turborepo.
- Budget also ships as a signed desktop pack. `scripts/budget-pack.mjs` builds the renderer and the
  `window.suiteBudget` prelude into `apps/budget/pack/dist`; the prelude owns the `BudgetDocument`
  and writes a snapshot at the visibility-hidden, `pagehide` and host-flush boundaries. The container
  never parses or writes a budget.
- A pack document id is its document-store file name. `LibraryEntry.path` is a display value with
  the same id, never an absolute path, and every library call takes the id. `listBudgets` reads at
  most the hundred most recently updated documents to recover their names and currencies.
- External files use only the host's `pickOpen`/`pickSave` handles; a missing or failing files
  service is a sentence and a cancellation, not an exception. The pack has no "show in folder" (the
  host has no reveal) and no sync. Reveal is a notice until the host offers one.
