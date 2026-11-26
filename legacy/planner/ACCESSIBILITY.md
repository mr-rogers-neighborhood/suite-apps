# Accessibility

Suite Planner is pre-alpha. This statement covers Planner; the suite target, the summary and the
reporting channel are in the root [ACCESSIBILITY.md](../../ACCESSIBILITY.md). The full breakdown is
in [`docs/reference/accessibility/wcag-22-map.md`](../../docs/reference/accessibility/wcag-22-map.md).

## What is verified by machine

- **Colour contrast in every preset.** Planner uses the presets in `@suite/theme`, and that package's
  tests measure each one: 4.5:1 for body and faint text on every surface, 3:1 for focus rings and
  component boundaries. This checks the palette, not the pixels in a running Planner window.
- **Structure, types and behaviour.** The gate runs Biome, strict TypeScript, Vitest, the shape
  check, knip and the production build. The shared `Button`, `IconButton`, `Field` and `Modal`
  primitives use native elements or Radix. Planner's task-detail and drawer tests cover focus order,
  the dialog's focus trap and returning focus to the opener.
- **Focus after an inline edit.** A task title committed with Enter or cancelled with Escape returns
  focus to the row, and **Back to today** moves focus to the new day's heading instead of dropping it.
- **One visible focus ring.** The renderer defines `*:focus-visible` once in
  [`theme/styles.css`](../../packs/planner/pack/src/renderer/theme/styles.css), and the shared primitives reuse the same
  ring token.

**There is no axe run in Planner's gate.** Planner has no axe or Playwright accessibility sweep
configured. The checks above do not cover painted contrast or what a screen reader actually says, and
should not be read as if they did.

## What is verified by hand

**No manual pass has been recorded.** The six-step protocol in
[`docs/reference/accessibility/manual-testing.md`](../../docs/reference/accessibility/manual-testing.md)
is ready to run; it covers keyboard only, a screen reader, zoom and reflow, reduced motion, painted
contrast and greyscale.

## Known gaps

| Area            | What is missing                                                                                                                                                                                                                      | Level |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| Status messages | Week moves announce through a persistent `role="status"` region. Other confirmations use the shared `Toast`, which mounts `role="status"` at the same moment it fills it; whether a screen reader hears it has not been listened to. | AA    |

The criterion map's SC 4.1.3 row records the status-message question. Row actions visible on focus
and a `<main>` landmark around the active screen are in the tree; the landmarks have component tests,
and none of it has had a manual pass.

## What does not apply here

Planner's shortcuts use a modifier (`Ctrl N` for capture, `Alt` + arrow keys in the week), and every
week-view drag has an `Alt` + arrow and a menu equivalent, so SC 2.1.4 and SC 2.5.7 do not apply. The
suite-wide N/A rows are in the [criterion map](../../docs/reference/accessibility/wcag-22-map.md).

## Telling us about a barrier

Report a barrier through the root [accessibility policy](../../ACCESSIBILITY.md#how-to-report-a-barrier):
open an issue and apply the `accessibility` label.
