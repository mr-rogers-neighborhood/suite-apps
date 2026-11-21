# Data model

The schema is `packages/core/src/schema.ts`. Zod is the source of truth; types are `z.infer`. Every
write is parsed before it reaches the CRDT.

## Roots

One Loro document holds these roots. Only `BudgetDocument` mutates them.

| Root              | Key                  | Record                                                     |
| ----------------- | -------------------- | ---------------------------------------------------------- |
| `meta`            | —                    | budget id, name, schema version, created timestamp         |
| `settings`        | —                    | currency, scale, first day of week, upcoming window, theme |
| `accounts`        | account id           | `account`                                                  |
| `categoryGroups`  | group id             | `categoryGroup`                                            |
| `categories`      | category id          | `category`                                                 |
| `targets`         | target id            | `target`                                                   |
| `monthlyBudgets`  | `yyyy-MM:categoryId` | `monthlyBudget`                                            |
| `transactions`    | transaction id       | `transaction`                                              |
| `payees`          | payee id             | `payee`                                                    |
| `rules`           | rule id              | `rule`                                                     |
| `schedules`       | schedule id          | `schedule`                                                 |
| `scheduleBatches` | batch id             | `scheduleBatch`                                            |
| `reconciliations` | reconciliation id    | `reconciliation`                                           |
| `dashboards`      | dashboard id         | `dashboard`                                                |
| `widgets`         | widget id            | `widget`                                                   |

Every record is a mergeable map, so a field write is a leaf write. No record contains a whole list that
two clients would overwrite; splits are child records, transfers are paired records, and widgets are
their own records.

## Records

### account

`id`, `name`, `type` (`checking` \| `savings` \| `cash` \| `credit` \| `loan`), `onBudget`, `note`,
`creditLimitMinor` (nullable), `loan` (`{ originalBalanceMinor, interestRateBps, minimumPaymentMinor }`
or null), `closedAt` (nullable), `createdAt`, `updatedAt`.

An on-budget account must reach a zero balance before it can close. Off-budget accounts may close with a
balance. Type and budget membership are immutable after creation.

### categoryGroup and category

- `categoryGroup`: `id`, `name`, `order`, `hidden`, `createdAt`.
- `category`: `id`, `groupId`, `name`, `order`, `hidden`, `note`, `createdAt`, `updatedAt`.

Deleting a category removes its targets and assignments and sets its transactions to uncategorized.
Deleting a group requires it to be empty.

### target

A versioned suggestion, not a stored monthly amount.

`id`, `categoryId`, `kind` (`monthly` \| `needed_for_spending` \| `savings_balance` \| `debt_payoff`),
`amountMinor`, `dueMonth` (nullable), `accountId` (nullable, required for debt), `startsOn`, `endsOn`
(nullable), `createdAt`, `updatedAt`.

Editing a target closes the current record at the previous month and opens a new one at the current
month. Past months recompute against the target that applied then.

### monthlyBudget

`month` (`yyyy-MM`), `categoryId`, `assignedMinor`, `updatedAt`. Sparse: a category with no allocation
has no record, which is different from a record with zero.

### transaction

`id`, `accountId`, `date` (`yyyy-MM-dd`), `payeeId` (nullable), `payeeName`, `categoryId`
(category id, `"rta"`, or null), `amountMinor` (signed, account perspective), `memo`, `cleared`
(`uncleared` \| `cleared` \| `reconciled`), `flag` (nullable colour), `transferId` (nullable),
`transferAccountId` (nullable), `parentId` (nullable), `scheduledId` (nullable), `imported`
(`{ source, externalId, importedAt, originalPayee }` or null), `createdAt`, `updatedAt`.

- A split parent has `categoryId: null` and children with `parentId` set. The parent's amount is the sum
  of its children; the parent is a grouping row, never a category write.
- A transfer pair shares a `transferId` and opposite amounts. Both on-budget: no category. One
  off-budget: the on-budget side carries a category, because money left the budget.
- `categoryId: "rta"` is income to Ready to Assign. A positive amount adds money; a starting balance
  uses the same category.
- `categoryId: null` is uncategorized. It affects the on-budget balance and therefore Ready to Assign,
  and the Plan shows a review banner.
- A reconciled row is read-only until the reconciliation is unlocked.

### payee

`id`, `name`, `defaultCategoryId` (nullable), `lastCategoryId` (nullable), `learn`, `archivedAt`
(nullable), `createdAt`.

`learn` gates the learned category rule: with it off, changing a transaction's category records
`lastCategoryId` but writes no `payee is <name> → set category` rule. Renaming a payee moves the name
on every transaction that carries its id, retargets its learned category rule, and writes an
`importedPayee contains <old name> → set payee <new name>` rule for the next import. Renaming does not
change a transaction's category, and a name another payee already holds is refused rather than making
name-typed rules ambiguous.

### rule

`id`, `stage` (`pre` \| `default` \| `post`), `enabled`, `conditions` (`{ field, op, value }[]`),
`actions` (`{ field, value }[]`), `source` (`user` \| `learned`), `createdAt`, `updatedAt`.

Fields: `importedPayee`, `payee`, `account`, `category`, `date`, `memo`, `amount`, `cleared`. Operators:
`is`, `isNot`, `contains`, `doesNotContain`, `matches`, `oneOf`, `notOneOf`. Actions: `setPayee`,
`setCategory`, `setMemo`, `setFlag`, `setCleared`.

`category` and `account` conditions compare both the record id and the name a person typed, so a
condition written before the editor offered a picker keeps working. An `amount` condition parses to
minor units; `oneOf`/`notOneOf` take a `|`-separated list. `importedPayee` is the bank's original text
and is empty for a row that was never imported, so a learned rename rule cannot rewrite history.

### schedule

`id`, `accountId`, `payeeId` (nullable), `payeeName`, `categoryId` (nullable), `amountMinor`, `memo`,
`flag`, `frequency` (`daily` \| `weekly` \| `monthly` \| `yearly`), `interval`, `anchorDate`,
`nextDate`, `endDate` (nullable), `autoEnter`, `createdAt`, `updatedAt`. `autoEnter` defaults to
false; a schedule with it on posts its own due occurrences.

### scheduleBatch

`id`, `createdAt`, `transactionIds` (string[]), `totalAmountMinor`, `runs`, `undoneAt` (nullable).
Each run is `{ scheduleId, nextDateBefore, postedCount }`. The record is the audit trail for one
automatic-entry pass, so the notice and its Undo survive a restart; `undoneAt` stops an undo from
being applied twice.

### reconciliation

`id`, `accountId`, `statementDate`, `statementBalanceMinor`, `adjustmentTransactionId` (nullable),
`createdAt`.

### dashboard and widget

- `dashboard`: `id`, `name`, `order`, `createdAt`.
- `widget`: `id`, `dashboardId`, `kind` (`ready_to_assign`, `net_worth`, `spending`, `income_expense`,
  `cash_flow`, `budget_vs_actual`, `age_of_money`, `text`), `order`, `range`, `accountId` (nullable),
  `categoryGroupId` (nullable), `text`, `createdAt`.

### settings

`currency`, `currencyScale`, `firstDayOfWeek`, `upcomingDays`, `theme`, `privacyAmounts` (reserved).
The scale follows the currency: creating a budget in JPY starts at zero decimals and KWD at three,
unless the caller states a scale. Changing the currency later moves the scale with it.

## Derived, never stored

- Month state: per category `assigned`, `activity`, `available`; month totals and Ready to Assign.
- Carry-in: the previous month's positive Available; zero for the budget's first month.
- Account balance through a date: starting balance plus every transaction on the account.
- Transfer activity: zero when both sides are on budget; the categorized side when one is off.
- Split parent total: sum of child records.
- Target suggestion and funded state.
- Upcoming entries: schedule expansion over `upcomingDays`.
- Duplicates: exact import-id matches and fuzzy candidates at import time.
- Report series: net worth, spending, income vs expense, cash flow, budget vs actual, age of money.
- Dashboard layout order.

A derived value may be cached only if it can be thrown away and rebuilt from the document. The
renderer's snapshot is exactly that.

## Month math

For each category `c` and month `M`:

```
carryIn(c, M)  = M is first month ? 0 : max(0, available(c, M - 1))
activity(c, M) = sum(amountMinor of categorized transactions dated in M belonging to c)
available(c, M) = carryIn(c, M) + assigned(c, M) + activity(c, M)
readyToAssign(M) = onBudgetBalanceAtEnd(M) - sum(available(c, M))
```

Notes that matter:

- **First month** is the earliest month that has a transaction, an allocation, or a target. Before it,
  nothing exists.
- **A negative Available is shown in its month**, then closed at the boundary: the next month starts the
  category at zero and Ready to Assign drops by the deficit. Assigning money to the negative category in
  the same month covers it explicitly, and then nothing is deducted.
- **Income** is a transaction with `categoryId === "rta"`; it raises Ready to Assign through the
  on-budget balance.
- **Refunds** are positive categorized transactions; they raise the category's Available.
- **Credit card spending** is a negative transaction on an on-budget card. It reduces the category and
  the on-budget balance at the same time, so the invariant holds with no payment category.
- **Transfers between on-budget accounts** net to zero and carry no category.
- **Transfers to an off-budget account** carry a category on the on-budget side and count as activity.
- **Split children** are the transactions that count toward activity; the parent is invisible to math.
- **Reconciliation adjustments** are transactions categorized to `rta` (on budget) or uncategorized
  (off budget), with payee `Reconciliation Balance Adjustment`.
- **Hidden categories** still count; hiding is a display choice.

### The invariant

```
sum(available for every category) + readyToAssign = onBudgetBalance
```

The property test in `packages/core/src/plan/invariant.test.ts` generates documents and asserts it. A
hand-computed month in `monthState.test.ts` covers income, assigned, an overspend, a credit card, an
on/off-budget transfer, a split, a refund, and an uncategorized row.

## Targets

| Kind                  | Suggestion for month `M`                                  | Funded when                              |
| --------------------- | --------------------------------------------------------- | ---------------------------------------- |
| `monthly`             | `amountMinor − available`, ≥ 0                            | `available ≥ amountMinor`                |
| `needed_for_spending` | `(amountMinor − available) / monthsRemaining`, rounded up | `available ≥ amountMinor` by `dueMonth`  |
| `savings_balance`     | `(amountMinor − available) / monthsRemaining`, rounded up | `available ≥ amountMinor` by `dueMonth`  |
| `debt_payoff`         | `linkedAccountDebt / monthsRemaining`, rounded up         | linked account balance ≤ 0 by `dueMonth` |

`monthsRemaining` counts the current month through the due month. A debt payoff's suggestion is still
the balance divided by those months; the projection does not change it or the funding check, which
reads the linked account's balance.

The target editor projects that fixed payment against the linked account's `loan.interestRateBps`
(zero when the account has no loan terms) and shows the months to payoff, the month the balance
reaches zero, total interest and total paid. The projection is an estimate, not a second suggestion:
new charges and rate changes are not modelled. Amounts stay integer minor units and the rate integer
basis points; monthly interest is rounded half up to the nearest minor unit, and the final payment is
clamped to the balance plus that month's interest, so it never charges more than the debt. A payment
at or below the monthly interest is reported as never paying off, as is a balance still open after
100 years.

## Auto-assign

Each action is a pure function returning `Map<categoryId, deltaMinor>`; the view applies the deltas in
one document mutation and reports the total and any shortfall.

| Action               | Behavior                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `underfunded`        | Assign each category's suggestion, in category order, until Ready to Assign is exhausted; report the shortfall    |
| `last_month`         | Copy the previous month's `assignedMinor` per category                                                            |
| `average_spent`      | Assign the 3-month average of absolute activity per category, excluding the current month                         |
| `cover_overspending` | Assign exactly the negative Available total into the negative categories from Ready to Assign; report a shortfall |

Manual money moves pick a source (any category with positive Available, or Ready to Assign) and a
destination, then apply the deltas in one mutation; the dialog shows the current Available beside each
choice.

## Rules

Rules run in three stages (`pre`, `default`, `post`). Within a stage they are ranked broad to specific —
`matches`, then `contains`/`doesNotContain`, then `oneOf`/`notOneOf`, then `is`/`isNot` — with more
conditions scoring higher, then by creation time, then by id, so the result is deterministic. Broad
rules run first; the last matching action for a field wins. Rules run on import and when the user
chooses "Run rules" on the document.

Learned rules: when the user sets a category on a transaction with a known payee whose `learn` toggle
is on, a learned `payee is <name> → set category` rule is created or updated. The comparison is
case-insensitive, so one payee has one learned rule. A payee with learning off still records its last
category, but no rule. Renaming a payee retargets that rule and updates the transaction rows; it does
not change a category. A learned `importedPayee contains <old name> → set payee <new name>` rule maps
the bank's text on the next import. A learned rule is a normal record the user can edit or disable.
"When you ask" runs rules over the document, but never over a reconciled row or an internal transfer.

## Schedules

A schedule stores its anchor day, so a monthly bill on the 31st clamps to the last day of short months
and returns to the 31st afterwards. `nextDate` is the next occurrence; entering it creates a transaction
with `scheduledId` and advances `nextDate`. Upcoming entries are derived for `settings.upcomingDays`.

`autoEnter` is off by default, so a schedule stays advisory until a person ticks **Automatically add
transaction**. With it on, the app catches up from `nextDate` through today on open and while it stays
open. The catch-up covers at most the last 90 days per schedule (`AUTO_ENTER_HORIZON_DAYS`); an older
occurrence advances `nextDate` without posting, rather than filling the budget with years of history.
Each occurrence goes through the same entry path as the Enter button and becomes its own transaction,
with the schedule's category, payee, memo and `scheduledId`. A manual entry past the end date is
refused, so a stale window cannot post beyond the plan.

One pass that posts anything writes a `scheduleBatch` record with the transaction ids, the total and
one run per schedule (`nextDateBefore`, `postedCount`). Undo deletes exactly those transactions and
restores each run's `nextDate`, then marks the batch `undoneAt`; it refuses if any transaction is
reconciled. Because the batch is a document record, the notice and its undo survive a restart. A
schedule with a zero amount is skipped, because a zero transaction is invalid, and nothing posts
while the app is closed: the next open is the catch-up.

## Imports

All parsers are pure and return `Result<ImportBatch, ImportError>`; the renderer presents the mapping,
preview, and review.

| Format       | v1       | Notes                                                                                                                                                  |
| ------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CSV          | Yes      | mapping wizard: delimiter, header row, skipped leading rows, date format, payee, memo, amount or inflow/outflow, category, sign flip; RFC 4180 quoting |
| QIF          | Yes      | `!Type:Bank` records, splits (`S`/`E`/`$`), transfers (`[Account]`), cleared flag, category names, `N` reference id                                    |
| Native JSON  | Yes      | `suite.budget.records`, Zod-validated, opens as a new budget                                                                                           |
| `.budget`    | Yes      | opens the snapshot as a new budget in the library                                                                                                      |
| OFX/QFX/CAMT | Deferred | the adapter seam exists; no parser ships                                                                                                               |

Stored metadata: an imported transaction records `imported`: `source` (`csv` or `qif`),
`externalId` (the QIF `N` reference, otherwise null), `importedAt`, and `originalPayee` (the payee text
as read, before rules). Split parents carry it too; the two legs of a matched transfer do not.

Ready to Assign is a reserved category name. An export writes `Ready to Assign` for a transaction
categorized to `rta`, and an import maps that name, case-insensitively, back to `rta` instead of
creating a category. A `categoryId` of `"rta"` is income; it is not a category record.

A QIF row belongs to the register being imported into, so its amount's sign gives a transfer's
direction: negative leaves the account, positive enters it. A QIF export writes both legs of a
transfer; the leg naming the account being imported into is the other side and is skipped, which is
why a QIF is imported into one account rather than as a whole budget. QIF is line-based, so an export
flattens a line break in a payee, memo, category or account name to a space. A transfer that crosses
the budget boundary needs a category, and one QIF line cannot carry both that category and an
`[Account]` target; the import reports that row instead of inventing the missing side.

Import uses the destination budget's currency and scale. A value with more decimal places than the
scale is rounded once, at parse time; a `.budget` or records import instead opens as a new budget and
keeps the currency and scale it was written with.

Dedupe: an import row with an `externalId` that matches an existing transaction's `imported.externalId`
in the same account is an exact duplicate, whatever its date, amount, or payee. Otherwise candidates are
transactions in the same account with an equal amount, a date within ±3 days, and normalized payee
similarity. The review list offers skip or import, per row and in bulk.

Import order: parse → map → dedupe → review → rules → commit as one document mutation. Rules run at
commit, after the review, not before it.

## File formats

A `.budget` file is a JSON envelope:

```json
{
  "format": "suite.budget",
  "formatVersion": 1,
  "schemaVersion": 1,
  "exportedAt": "2026-01-05T09:00:00.000Z",
  "snapshot": "<base64 Loro snapshot>"
}
```

`decodeBudgetFile` returns a `Result` and rejects bad JSON, another app's JSON, a newer format, and a
snapshot that will not decode. Import then builds a fresh document and validates every record before it
is written.

The records export is `suite.budget.records` and contains every root as plain arrays plus `meta`,
`settings`, `format`, `formatVersion`, `schemaVersion`, and `exportedAt`. It is the "nothing is trapped"
artifact. CSV and QIF exports carry transactions only: CSV writes a split as its child rows and a
transfer as two rows, and a CSV import reads date, payee, memo, amount and category; QIF keeps splits,
cleared state, transfer targets and the `N` reference.

The live file is the same envelope. A `.budget` file is readable by anyone who has it; use OS disk
encryption. The app adds no passphrase.
