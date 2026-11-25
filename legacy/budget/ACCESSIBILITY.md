# Accessibility

Suite Budget is pre-alpha. This page says where accessibility stands, and what has actually been
checked, rather than what is intended.

The target is **WCAG 2.2 level AA**. That is 55 of the 86 success criteria in the standard. The full
breakdown is in
[`docs/reference/accessibility/wcag-22-map.md`](../../docs/reference/accessibility/wcag-22-map.md).

## What is verified by machine

One check runs on every change and a failure stops the work. One runs in the workshop and reports
what it finds without failing a build.

- **Colour contrast in every theme, on every change.** Each preset in `@suite/theme` is measured in
  both modes: 4.5:1 for body, secondary and faint text on every surface it can sit on, 4.5:1 for
  text on every filled role, and 3:1 for focus rings and component boundaries. A preset that fails
  cannot be merged; the test is in `packages/theme/src/presets.test.ts` and Budget draws its three
  presets from it.
- **Storybook's accessibility panel, in the workshop.** The a11y addon is enabled for every story,
  so a story opened in the workshop runs axe and reports its violations. It is the author's check,
  not the gate: a violation is visible but does not fail `pnpm verify`, and only the two stories
  (`Button`, `Charts`) exist so far.
- **The register and plan controls, on every change.** Component tests assert that a register row's
  cleared control and split expand control keep focus after they act, that a row itself opens the
  editor with Enter or Space while the controls inside it do not, that Enter in an assigned amount
  moves focus to the next envelope, that Escape restores the previous amount instead of assigning
  the cancelled text, and that each cleared control names its own row rather than repeating one
  label.
- **The reports, on every change.** Component tests assert that the range picker has a label, a report
  tab exposes whether it is selected, a chart has an accessible name and a data table, and Budget vs
  actual is a table whose headers and cells a screen reader can read.

There is no axe run against the running application. The end-to-end suite covers the launcher and
the phone widths (360, 390 and 430 CSS pixels), not an accessibility rule set.

`pnpm shape` also fails a component that imports Loro and keeps `observe()` to one call site, and the
renderer is sandboxed at build time; neither is an accessibility check, but both remove a class of
failure that would otherwise be invisible until a manual pass.

## What is verified by hand

**None of it yet.** This section will list the passes below once they have been done and written
down. Until then, do not read the machine checks above as coverage of the interface.

The protocol is written and ready to run:
[`docs/reference/accessibility/manual-testing.md`](../../docs/reference/accessibility/manual-testing.md).
It covers six passes per screen:

1. Keyboard only, including that focus is never hidden behind a sticky region.
2. A screen reader, with what it actually said written down.
3. Zoom to 200% and 400%, and reflow at 320 CSS pixels.
4. Reduced motion.
5. Contrast measured in the running app, not only in the palette.
6. Greyscale, to catch anything told apart by colour alone.

## What the interface does today

These are the deliberate choices a manual pass will check, not claims that it passed.

- Radix `Dialog`, `DropdownMenu` and `Select` carry the focus trap, Escape, and menu keyboard model.
  The amount input, the month grid, and the SVG charts are hand-rolled.
- Every icon-only control has an accessible name and a title: modal close, split expand, schedule
  delete, and the cleared toggle on a register row. A dashboard widget's move, remove and range
  controls name the widget and its position, so several widgets do not produce identical controls in
  a screen reader's list.
- The register's cleared control is a pressed state ("Cleared", pressed or not) rather than a colour
  swatch, its accessible name adds the row's payee and date so rows do not share one control name,
  and a reconciled row says it is locked in its title. The row itself is keyboard-activatable;
  its own Enter and Space are handled only on the row, so the controls inside it do not also open the
  editor.
- Report tabs carry their selected state, the closed-account group says whether it is expanded, and
  every range picker has a label.
- Charts are SVG with a role and an accessible name, and each chart has a **Data table** under it.
- Overspent, Funded, Left and Reconciled are words, not colour alone.
- The status line for an automatic-entry batch and the toast for a save or import result are
  announced (`role="status"`, or `role="alert"` for a failure).
- `prefers-reduced-motion` collapses every animation and transition.
- The focus ring is defined once in `src/renderer/src/theme/styles.css`; it is not removed from
  buttons or inputs.

## Known gaps

These are real. Each names the success criterion it touches; the suite-wide map is the fuller record.

| Area            | What is missing                                                                                                                                                                                           | Level |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Screen reader   | No pass has been listened to yet, so chart descriptions, the month grid's reading order, and every confirmation are unverified (SC 4.1.3, SC 1.3.1).                                                      | AA    |
| Register row    | A row is a `role="button"` that contains the expand and cleared buttons. Their keys no longer bubble, but the nested focusable controls remain an ARIA shape a screen reader has to interpret (SC 4.1.2). | AA    |
| Split children  | A split's child rows follow their parent in the DOM as peers; the indent is visual only, so the relationship is not in the markup (SC 1.3.1).                                                             | AA    |
| Reconciliation  | Cleared, statement and difference are three visual blocks with no table or list semantics, so a screen reader does not associate them (SC 1.3.1).                                                         | AA    |
| Zoom and reflow | The plan grid and the register use fixed column widths. 200% zoom and 320 CSS pixels reflow are unmeasured (SC 1.4.10).                                                                                   | AA    |

## What does not apply

Listed because a statement that admits nothing is not a statement.

- **No accounts.** There is nothing to sign in to, so the accessible-authentication criteria
  (SC 3.3.8 and 3.3.9) do not apply.
- **No audio and no video.** The time-based media criteria (SC 1.2.1 to 1.2.9) do not apply.
- **No time limits.** Nothing expires while you are working (SC 2.2.1).
- **No flashing content.** Nothing animates at a rate that could trigger a seizure (SC 2.3.1).
- **No single-character shortcuts.** Every shortcut is a `Cmd`/`Ctrl` combination or an editing key
  such as Enter, Escape, or an arrow, so SC 2.1.4 does not apply.
- **Parsing is obsolete.** SC 4.1.1 was removed in WCAG 2.2.

## Telling us about a barrier

Open an issue describing what you were doing, what you expected, and what happened. A description
of the barrier is more useful than a suggested fix, and both are welcome.

## What this runs on

Electron with Chromium, React 19, on Linux. No screen reader has been used for a recorded pass yet;
Orca is the screen reader named in the manual protocol.
