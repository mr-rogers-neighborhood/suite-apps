# Accessibility

Suite Start is the hub, and this page says where its accessibility stands, and what has actually been
checked, rather than what is intended.

The target is **WCAG 2.2 level AA**. That is 55 of the 86 success criteria in the standard. The full
breakdown is in
[`docs/reference/accessibility/wcag-22-map.md`](../../docs/reference/accessibility/wcag-22-map.md).

## What is verified by machine

One accessibility check runs on every change and a failure stops the work.

- **Colour contrast in every theme.** Each preset in `@suite/theme` is measured: 4.5:1 for body text
  on every surface it can sit on, 4.5:1 for faint text, and 3:1 for focus rings and component
  boundaries. A preset that fails cannot be merged. A colour that cannot be measured, such as a
  gradient or a `color-mix()`, is not allowed in a preset, because an unmeasurable colour cannot be
  checked.

**Start runs no axe.** There is no axe or Playwright accessibility sweep in Start's gate. The
end-to-end suite exercises the launcher, not an accessibility rule set; painted contrast, focus order
and screen-reader output still need the manual pass.

The contrast check found a real problem the moment it was written: faint text was 3.42:1 against
white at 11px. It is fixed.

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

## Known gaps

Start has no axe or Playwright accessibility sweep, and no manual pass has been recorded. The gaps
below are the ones a code review can name; the manual protocol is what would confirm them. Each has a
row in the [criterion map](../../docs/reference/accessibility/wcag-22-map.md) naming its success
criterion.

| Area | What is missing | Level |
| --- | --- | --- |
| Reflow | The rail is a fixed 208px column and an app card has a 320px minimum, with no breakpoint. At a 320 CSS px viewport the content column is narrower than a card and the page overflows instead of reflowing (SC 1.4.10). | AA |
| Status messages | Install progress is a `role="status"` region created and filled at the same moment. Install failures, launch errors and the update-check result are plain text with no live region, and the copy-link confirmation is only a button label change, so a screen reader may miss them (SC 4.1.3). | AA |

## What does not apply

Listed because a statement that admits nothing is not a statement.

- **No accounts.** There is nothing to sign in to, so the accessible-authentication criteria
  (SC 3.3.8 and 3.3.9) do not apply. Sync pairs devices with a code.
- **No audio and no video.** The time-based media criteria (SC 1.2.1 to 1.2.9) do not apply.
- **No time limits.** Nothing expires while you are working (SC 2.2.1).
- **No flashing content.** Nothing animates at a rate that could trigger a seizure (SC 2.3.1).
- **Parsing is obsolete.** SC 4.1.1 was removed in WCAG 2.2.

## Telling us about a barrier

Open an issue describing what you were doing, what you expected, and what happened. A description
of the barrier is more useful than a suggested fix, and both are welcome.

## What this runs on

Electron with Chromium, React 19, on Linux. Orca is the screen reader these manual passes will use.
