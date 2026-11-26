# Accessibility

Suite is alpha software. This statement covers Canvas; the suite target, the summary and the
reporting channel are in the root [ACCESSIBILITY.md](../../ACCESSIBILITY.md). The full breakdown is
in [`docs/reference/accessibility/wcag-22-map.md`](../../docs/reference/accessibility/wcag-22-map.md).

## What is verified by machine

Two checks run on every change, and a failure stops the work.

- **Colour contrast in every theme.** Each preset in `@suite/theme` is measured: 4.5:1 for body text
  on every surface it can sit on, 4.5:1 for faint text, and 3:1 for focus rings and component
  boundaries. A preset that fails cannot be merged. A colour that cannot be measured, such as a
  gradient or a `color-mix()`, is not allowed in a preset, because an unmeasurable colour cannot be
  checked.
- **axe over the Storybook stories.** Every story is audited against the WCAG 2.2 A and AA rule sets
  through the a11y addon, and a violation fails the story test in the gate. This covers the stories
  that exist, not the running window; painted contrast, focus order and screen-reader output still
  need the manual pass.

The contrast check found a real problem the moment it was written: faint text was 3.42:1 against
white at 11px. It is fixed.

## What is verified by hand

**No manual pass has been recorded.** The six-step protocol in
[`docs/reference/accessibility/manual-testing.md`](../../docs/reference/accessibility/manual-testing.md)
is ready to run; it covers keyboard only, a screen reader, zoom and reflow, reduced motion, painted
contrast and greyscale.

## Known gaps

These are real and tracked. Each has a row in the
[criterion map](../../docs/reference/accessibility/wcag-22-map.md) naming its success criterion.

| Area | What is missing | Level |
|---|---|---|
| Shortcuts | Canvas single-key shortcuts are not remappable or disableable (SC 2.1.4). | A |
| Board navigation | The Canvas board has no complete keyboard model for moving between cards. | AA |
| Dragging | Most drag actions have a menu or arrow-key equivalent. Three do not: resizing a section to an arbitrary size, re-pointing a section link, and bending a connector. | AA |
| Status messages | The markup is correct. Whether a screen reader hears a confirmation has not been listened to yet. | AA |

## Telling us about a barrier

Report a barrier through the root [accessibility policy](../../ACCESSIBILITY.md#how-to-report-a-barrier):
open an issue and apply the `accessibility` label.
