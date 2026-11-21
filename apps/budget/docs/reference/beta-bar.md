# The beta bar

`beta` is a promise, not a version bump: **shaped as it will ship — reviewed, documented, and with
no irreversible step left in it** ([Channels](../../../../docs/explanation/channels.md#the-three-boundaries)).
This page turns that sentence into checks. A box is ticked only when the evidence is in this tree and
the command was run on this commit; "it should work" is not evidence.

The bar belongs to Budget. It is not a second roadmap: [ideas.md](../../../../docs/reference/ideas.md)
owns what comes later, and [architecture.md](architecture.md#not-settled) lists what is deliberately
not settled.

## 1. A person reviewed the shape

- [ ] Someone other than the author opened a built Budget and used the core loop end to end: create a
  budget, add an account, assign, spend, split, transfer, reconcile, undo, export, re-import, and
  read the reports.
- [ ] The same person read [README.md](../../README.md), [architecture.md](architecture.md),
  [conventions.md](conventions.md), [data-model.md](data-model.md), [ui.md](ui.md) and
  [decisions.md](decisions.md), and said the app matches them.
- [ ] Every entry under "Not settled" is a later thing, not a hole in the shape that ships.

| Date | Reviewer | Build | What was tried | Findings                                                 |
| ---- | -------- | ----- | -------------- | -------------------------------------------------------- |
| —    | —        | —     | Not run yet    | The boxes above stay open until a person fills this row. |

This is the one boundary an agent cannot satisfy. The machine checks below make the review short; they
do not replace it.

## 2. The docs describe the shape

- [x] [README.md](../../README.md) says what the app does, what it deliberately does not, where the
  file lives, and that it is pre-alpha and still changing shape.
- [x] The reference pages describe the model as it is: [architecture.md](architecture.md),
  [conventions.md](conventions.md), [data-model.md](data-model.md), [ui.md](ui.md).
- [x] [ACCESSIBILITY.md](../../ACCESSIBILITY.md) says what is machine-checked, what was checked by
  hand, and what has not been.
- [x] The import and export tables name the source formats, the round-trip limits, and the reserved
  `Ready to Assign` name ([data-model.md](data-model.md#imports)).
- [x] [CHANGELOG.md](../../CHANGELOG.md) says what changed in a person's words.
- [x] `node scripts/docs-check.mjs` finds no broken link, anchor, inline path or retired phrase.

## 3. The decision record says what binds

- [x] [decisions.md](decisions.md) states the rules a later change must not quietly break: one Loro
  document and one writer, integer minor units, envelope budgeting, sparse months, paired
  transfers and child splits, targets, rules, schedules, backups, and the absence of a network.
- [x] The import and money rules added by this wave are recorded there: an export re-imports as the
  same money, the destination currency governs an import, and a separator-only amount is an error.
- [x] A change that alters the shape adds its decision in the same commit
  ([conventions.md](conventions.md#docs)).

## 4. Nothing the build writes is irreversible

- [x] **No schema migration ships in this change.** `SCHEMA_VERSION` stays `1`. A later migration
  bumps it, ships a migration and a fixture from the previous release, and is tested by opening
  that fixture; a build older than the file refuses it instead of downgrading it
  ([budgetFile.ts](../../packages/core/src/file/budgetFile.ts)).
- [x] A save is atomic (temp file → rename), keeps the previous copy, keeps seven daily backups, and
  never overwrites a damaged file ([budgetStore.ts](../../src/main/budgetStore.ts),
  [recovery.ts](../../src/main/recovery.ts)).
- [x] A pre-release build copies a stable budget into its own folder before opening it and refuses to
  export back into the stable folder ([budgetLocation.ts](../../src/main/budgetLocation.ts),
  [library.ts](../../src/main/library.ts)).
- [x] An import writes a copy into the library; it never replaces an existing budget, and an exported
  file is never mutated by exporting.
- [x] Deleting a category moves its transactions to uncategorized and removes its targets and
  assignments; deleting a budget removes the library entry but leaves the file. A schedule
  batch's Undo is a document record, so it survives a restart.
- [x] Reconciliation locks a row until the reconciliation is unlocked; the lock is document data,
  not a UI flag.

## 5. Import and export tell the truth

- [x] A `.budget` file round-trips every root through `encodeBudgetFile` → `decodeBudgetFile` →
  `BudgetDocument.fromSnapshot` ([file.test.ts](../../packages/core/src/file/file.test.ts)).
- [x] A records export round-trips every root and refuses a broken reference
  ([file.test.ts](../../packages/core/src/file/file.test.ts)).
- [x] A CSV file this app wrote re-imports its dates, payees, memos, amounts, categories and the
  reserved `Ready to Assign` name, and writes a split as its child rows
  ([export.test.ts](../../packages/core/src/file/export.test.ts)).
- [x] A QIF file this app wrote re-imports splits, cleared state, the `N` reference and the
  `L[Account]` transfer target. A transfer's direction comes from the importing register's amount
  sign, and the leg naming that register is skipped
  ([export.test.ts](../../packages/core/src/file/export.test.ts),
  [resolve.ts](../../packages/core/src/import/resolve.ts)).
- [x] Currency is one per budget. An import uses the destination's currency and scale and rounds once
  at parse time; a `.budget` or records import opens as a new budget with the currency it was
  written with. Zero-, two- and three-decimal currencies round-trip
  ([export.test.ts](../../packages/core/src/file/export.test.ts),
  [money.test.ts](../../packages/core/src/money.test.ts)).
- [x] Empty and malformed input is reported, not guessed: an empty file is an error; a bad row names
  its line and the good rows still import; a file with no readable row is refused with the first
  reason; a separator-only amount is refused instead of becoming zero; a BOM, CRLF and a quoted
  line break read correctly ([import.test.ts](../../packages/core/src/import/import.test.ts)).
- [x] The limits are stated rather than hidden: CSV carries transactions only and does not re-import
  cleared state or flag, a split is flattened to its child rows, and a QIF flattens a line break
  in a name or memo to a space. The `.budget` and records formats are the lossless ones
  ([data-model.md](data-model.md#file-formats)).

## 6. The interface is accessible, and the record says how far

Machine-checked on every change:

- [x] Contrast in every theme and both modes, in `@suite/theme`.
- [x] The register's cleared and split-expand controls keep focus after they act; a row opens the
  editor with Enter or Space while a control inside it does not; each cleared control names its
  own row ([Register.test.tsx](../../src/renderer/src/accounts/Register.test.tsx)).
- [x] Enter in an assigned amount commits and moves to the next envelope, and Escape restores the
  previous amount instead of assigning the cancelled text
  ([PlanView.test.tsx](../../src/renderer/src/plan/PlanView.test.tsx)).
- [x] A group control's expanded state matches its action, and row actions name the envelope they act
  on ([PlanView.test.tsx](../../src/renderer/src/plan/PlanView.test.tsx)).
- [x] The report range has a label, a tab exposes whether it is selected, a chart has a name and a
  data table, and Budget vs actual is a real table
  ([ReportsView.test.tsx](../../src/renderer/src/reports/ReportsView.test.tsx)).
- [x] Overspent, Funded, Left and Reconciled are words, not colour alone.
- [x] Storybook's a11y panel reports violations in the workshop; it does not fail the build.

Needs a person:

- [ ] The six-pass manual protocol in
  [manual-testing.md](../../../../docs/reference/accessibility/manual-testing.md): keyboard only,
  a screen reader with what it said written down, 200% zoom and 320 CSS-pixel reflow, reduced
  motion, contrast in the running app, and greyscale.
- [ ] The known gaps in [ACCESSIBILITY.md](../../ACCESSIBILITY.md#known-gaps) are either fixed or
  accepted in writing with their success criterion: the register row's nested controls, a split
  child's visual-only indent, reconciliation's visual blocks, and unmeasured zoom/reflow.

`beta` does not require zero known gaps. It requires that none is unrecorded.

## 7. The money model survives a regression test

- [x] Amounts are signed integer minor units; `parseFloat` and `toFixed` are banned outside
  [money.ts](../../packages/core/src/money.ts) and tests, and `pnpm shape` enforces it.
- [x] The cash-basis invariant `sum(available) + readyToAssign = onBudgetBalance` holds over generated
  budgets ([invariant.test.ts](../../packages/core/src/plan/invariant.test.ts)).
- [x] A hand-computed month covers income, an overspend, a credit card, an on/off-budget transfer, a
  split, a refund and an uncategorized row
  ([monthState.test.ts](../../packages/core/src/plan/monthState.test.ts)).
- [x] Parsing and formatting round-trip, round half up at the boundary, and refuse misplaced signs,
  broken grouping and separator-only input ([money.test.ts](../../packages/core/src/money.test.ts)).
- [x] An export and its re-import agree on every amount at the budget's scale
  ([export.test.ts](../../packages/core/src/file/export.test.ts)).
- [x] Two replicas from one snapshot converge after concurrent edits
  ([document.test.ts](../../packages/core/src/loro/document.test.ts)).
- [x] There is no bank sync, no network client, no updater and no analytics. `pnpm shape` bans
  `fetch`, `XMLHttpRequest` and `WebSocket` in `apps/`.

## The gate

Run from this repository root:

```sh
mise exec -- node scripts/gate.mjs --only budget --no-e2e   # lint, types, tests, shape, knip, build
node scripts/docs-check.mjs                                  # links, anchors, paths, retired phrases
```

The Playwright journey launches the built app and runs on request, not in the gate
([AGENTS.md](../../AGENTS.md)). `--fresh` proves the commit rather than the working tree.

## What the open boxes mean

Budget should not be offered as `beta` while the two boxes in section 1 and the manual pass in section
6 are open. The rest of the checklist is the evidence a reviewer needs; it is not a substitute for the
review.
