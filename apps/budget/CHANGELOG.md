# Changelog

Written for people, not commits: what you can do now that you could not before, and what changed
underneath enough to matter.

Versions here are Budget's own, tagged `budget-v<version>`. The rules are in
[Version ownership](../../docs/how-to/package-and-release.md#version-ownership).

## [Unreleased]

### Fixed

- **A transfer's unlocked side cannot rewrite a reconciled one.** Editing or deleting the other leg
  of a transfer now checks both legs, so a reconciliation stays locked. The same guard covers a split
  whose children are locked, and a transfer amount must be a whole positive number of minor units.
- **A payee rename moves history and its learned rule, not its categories.** The register and the
  payee list agreed only after a rules pass before. A rename now updates every row that carries the
  payee, retargets the learned category rule, and keeps the import mapping; renaming into a name
  another payee holds is refused instead of making name-typed rules ambiguous.
- **Category and account rule conditions match what the editor shows.** A condition typed as
  `category is Groceries` compared against the category id and never matched. Both the id and the
  visible name now count, a negative condition needs every name to differ, and an `amount is one of`
  list parses each value instead of only the first.
- **Run rules leaves internal transfers alone.** A rule that set a category on a transfer between two
  on-budget accounts turned a moved dollar into spending; those rows are skipped. The learned rename
  rule also reads only an imported row's bank text, so it cannot rewrite a hand-entered row.
- **A scheduled occurrence on a month end keeps its anchor.** A bill on the 31st posts on the 28th or
  29th in February and returns to the 31st afterwards, including across a year boundary and a horizon
  skip. Entering a schedule past its end date is refused.
- **Malformed amounts are refused.** A misplaced minus (`12-34`) or broken grouping (`1.2.3`,
  `1,23,456`) used to be stripped into a larger amount. Rounding at the currency scale is covered at
  the half-up boundary and for zero- and three-decimal currencies.
- **The currency decides the scale when the caller does not.** A budget created in JPY no longer
  starts with two decimal places, and changing the currency moves the scale with it.
- **A transfer between two of your accounts no longer asks for a category.** Moving money from
  checking to savings counted as two uncategorized transactions in the Plan banner. It is one
  movement, and the banner now names only rows that really need a category.
- **Editing a schedule no longer skips a due occurrence.** Changing the payee, amount or memo of a
  schedule whose next date had passed reset that date to a future one. The stored date now stays put
  unless the repeat itself changed.

### Changed

- **The reports and register say their state out loud.** Report tabs expose which one is selected,
  the closed-account group says whether it is open, and a register row's cleared control is a
  labelled pressed state rather than a colour. A dashboard widget's move, remove and range controls
  name the widget they act on.
- **A hub that lists Budget sees the version it actually runs.** The manifest beside the executable
  had stayed at the previous release's number.

### Accessibility

The register's cleared control names its row, and component tests hold the focus after a cleared
toggle, a split expand, and an amount commit. See [ACCESSIBILITY.md](ACCESSIBILITY.md) for what is
machine-checked, what is still unverified, and the remaining known gaps.

## [0.4.0] - 2026-11-21

### Added

- **A schedule can add its own transaction.** Each schedule now has an _Automatically add
  transaction_ checkbox, off by default. When it is on, due occurrences post themselves through the
  same path as the Enter button, so the category, payee, memo and `scheduledId` match a manual entry.
  Missed occurrences catch up when the budget opens or while it stays open, ninety days deep; older
  ones are skipped rather than posting years of history in one go.
- **Automatic entries come with one undo.** A notice names how many entries posted and their total.
  Undo removes exactly that batch and puts each schedule's next date back. The batch is a record in
  the budget, so the notice and its undo survive a restart.

### Changed

- **The choice is per schedule.** A schedule with the box off stays advisory and waits for you to
  enter it; only the ones you tick post themselves.

## [0.3.0] - 2026-11-21

### Added

- **A debt payoff target now estimates its interest.** The target editor shows how long the current
  monthly need takes, the month the balance reaches zero, and the total interest, using the rate
  stored in the linked account's loan terms (zero when it has none). The panel says it is only an
  estimate: new charges and rate changes are not modelled. A payment that cannot cover the monthly
  interest is called out instead of pretending the debt clears.

### Changed

- **Interest rounds half up, and the last payment is smaller.** Each month's interest rounds to the
  nearest minor unit, and the final payment is clamped to the balance plus that month's interest, so
  the estimate never charges more than the debt. A balance still open after 100 years is reported as
  never paying off.

## [0.2.5] - 2026-11-20

### Added

- **Imports remember where a row came from.** A CSV or QIF row keeps its source, bank id, import
  time and original payee, so importing the same export twice recognises what is already there by
  id instead of guessing from the date and payee. The CSV mapping can skip leading rows.
- **A renamed payee teaches the next import.** Renaming a payee writes a learned rule from the name
  the bank used to the one you chose.

### Fixed

- **Turning learning off on a payee now means it.** The toggle was stored but never read; it now
  stops a learned category rule from being written.

### Changed

- **One top bar, the same as Canvas and Planner.** The mark, budget name, view menu, actions and
  theme control ride in the shared bar.

## [0.2.4] - 2026-11-20

### Changed

- **Rebuilt to trust the rotated update key.** Nothing in the budget changes; the binary verifies the
  feed Suite Start reads with the current publishing key. An install that keeps the previous build
  will not see this release through its own updater, so Suite Start replaces it.
- **The feed is read from the repository's raw file host.** GitHub Pages needs Actions to build and
  Actions is unavailable, so the signed manifest is served from `main` directly.

## [0.2.2] - 2026-11-08

### Changed

- The start screen is the shared one, the same centred card as Canvas and Planner. Import is a plain
  button because Budget has one import path: a bank export.
- The theme picker and the privacy line moved into the card's footer, where they sit under the
  actions instead of competing with them.
- Space and type come from `@suite/theme` tokens.

## [0.2.1] - 2026-11-07

### Changed

- The interface wears the Budget glyph now, on the suite's accent tile, instead of a gradient
  square.
- **The theme control is on the first screen.** It was in the sidebar, which does not exist
  until a budget is open, so the one screen everybody sees had no way to change the theme.

### Fixed

- The privacy claim uses the suite's shared sentence: "Local file. No account, no server, no
  telemetry."

## [0.2.0] - 2026-11-07

### Added

- **Three colour themes, each in light and dark.** Suite, Solarized in its two official variants,
  and Warm. The sidebar offers a Theme list and a Brightness toggle, and the choice is remembered.
- **A light mode that works.** The app could follow the desktop before, but had no way to be told
  to.

### Changed

- The interface draws from the suite's shared palette. The chart series and the money colours are
  theme roles now, so a preset decides them together with the rest of the interface.

### Fixed

- A primary button's label was hardcoded near-black, tuned to this app's own green — unreadable
  on several presets.
- A `Toast` component that was never rendered has been removed.

## [0.1.2] - 2026-11-07

### Fixed

- The app's mark is where the package looks for it. 0.1.0 shipped Electron's default icon because
  the artwork was in `build/` and this app's build resources are `resources/`.
- The window's desktop name carries the `.desktop` suffix, so a panel groups the running window with
  its menu entry instead of drawing a second, generic icon.

## [0.1.1] - 2026-11-07

### Added

- The app has its own icon, on the window and in the menu entry the system draws.

### Changed

- An update now arrives from Suite Start. An app the hub launched leaves its own update check
  alone; a copy run from a folder keeps its own updater.
- The update report is written even on a first launch, so the hub can say "not checked" rather than
  showing a stale answer.

### Fixed

- One artifact-name shape across the suite, with no spaces in it.

## [0.1.0] - 2026-11-06

### Added

- First packaged release: an envelope budget in a file you own.
