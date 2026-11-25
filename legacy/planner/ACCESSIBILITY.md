# Accessibility

Suite Planner is pre-alpha. This page says where accessibility stands, and what has actually been
checked, rather than what is intended.

The target is **WCAG 2.2 level AA**. That is 55 of the 86 success criteria in the standard. The full
breakdown is in
[`docs/reference/accessibility/wcag-22-map.md`](../../docs/reference/accessibility/wcag-22-map.md).

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
  [`theme/styles.css`](src/renderer/src/theme/styles.css), and the shared primitives reuse the same
  ring token.

**There is no axe run in Planner's gate.** The suite's manual-testing page describes an automated
start-screen audit, but Planner has no axe or Playwright accessibility sweep configured. The checks
above do not cover painted contrast or what a screen reader actually says, and should not be read as
if they did.

## What is verified by hand

**None of it yet.** This section will list the passes below once they have been done and written
down.

The protocol is written and ready to run:
[`docs/reference/accessibility/manual-testing.md`](../../docs/reference/accessibility/manual-testing.md).
It covers six passes per screen:

1. Keyboard only, including that focus is never hidden behind a sticky region.
2. A screen reader, with what it actually said written down.
3. Zoom to 200% and 400%, and reflow at 320 CSS pixels.
4. Reduced motion.
5. Contrast measured in the running app, not only in the palette.
6. Greyscale, to catch anything told apart by colour alone.

## Known gaps

| Area            | What is missing                                                                                                                                                                                                                      | Level |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| Status messages | Week moves announce through a persistent `role="status"` region. Other confirmations use the shared `Toast`, which mounts `role="status"` at the same moment it fills it; whether a screen reader hears it has not been listened to. | AA    |

The criterion map's SC 4.1.3 row records the status-message question. The keyboard fixes in this
change — row actions visible on focus, and a `<main>` landmark around the active screen — are in
the tree; the landmarks have component tests, and none of it has had a manual pass.

## What does not apply

Listed because a statement that admits nothing is not a statement.

- **No accounts.** There is nothing to sign in to, so the accessible-authentication criteria
  (SC 3.3.8 and 3.3.9) do not apply. Sync pairs devices with a code.
- **No audio and no video.** The time-based media criteria (SC 1.2.1 to 1.2.9) do not apply.
- **No time limits.** Nothing expires while you are working (SC 2.2.1).
- **No flashing content.** Nothing animates at a rate that could trigger a seizure (SC 2.3.1).
- **No single-key shortcuts.** Planner's shortcuts use a modifier (`Ctrl N` for capture, `Alt` +
  arrow keys in the week), so SC 2.1.4 does not apply.
- **No drag without an equivalent.** The week view is the only drag surface, and every move it
  offers also has `Alt` + arrow keys and a menu item.
- **Parsing is obsolete.** SC 4.1.1 was removed in WCAG 2.2.

## Telling us about a barrier

Open an issue describing what you were doing, what you expected, and what happened. A description
of the barrier is more useful than a suggested fix, and both are welcome.

## What this runs on

Electron with Chromium, React 19, on Linux. Orca is the screen reader these manual passes will use.
