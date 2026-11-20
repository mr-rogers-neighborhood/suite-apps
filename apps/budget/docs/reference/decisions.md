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
- Targets are versioned. Rules are staged before they apply. Schedules are projections.
- There is no bank sync, no network client, no updater and no analytics.
- Accounting is cash basis.
- A damaged file is never overwritten. Saves are atomic, the previous copy is kept, and seven daily
  backups sit beside the document.
- The library index and `recovered/` live in the application directory, not the documents folder.
- Charts are SVG. The interface shows age of money.
- The gate is local: `pnpm check` to edit, `pnpm verify` for the full gate. There is no Turborepo.
