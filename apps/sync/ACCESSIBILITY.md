# Accessibility

Suite Sync is a headless relay with one small piece of interface: a read-only console page on
loopback. This page says what has been checked for it rather than what is intended.

The target is **WCAG 2.2 level AA**. The shared criterion map is in
[`../../docs/reference/accessibility/wcag-22-map.md`](../../docs/reference/accessibility/wcag-22-map.md).

## What it is

The relay moves encrypted documents between devices on a local network. It has no desktop window:
Canvas, Planner and Start are where a person works. `serve` also opens a metadata console on
`127.0.0.1`, prints its URL with a token, and Start's Sync tab opens that page in the browser. The
page lists the relay address, transport, store size, workspaces, members and a join code. It never
opens a frame and shows no keys.

## What is verified by machine

Nothing reads the console's markup. The relay's gate runs Biome, the protocol and host tests, and a
typecheck; none of that is an accessibility check. What the page has by construction:

- `<html lang="en">` and a document title.
- One `<h1>`, `<h2>` sections and `<dt>`/`<dd>` pairs, so there is structure to navigate.
- The join-code QR is an image with an accessible name (`role="img"`, `aria-label`).

## Known gaps and unverified areas

| Area     | What is missing                                                                                                                                                                                                 | Level |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Reload   | **Known gap.** The page reloads itself every five seconds so its counts stay current. It cannot be paused, and a reader part-way through the page loses its place (SC 2.2.2).                                  | A     |
| Reflow   | Not measured. The page is a single column with a 52rem maximum, so it should reflow, but nobody has tested it at 320 CSS px (SC 1.4.10).                                                                         | AA    |
| Contrast | Not measured. Secondary text is `color-mix()` at 60–65% of `currentColor`, which the palette gate cannot measure (SC 1.4.3).                                                                                    | AA    |
| Testing  | No axe run and no manual pass. Keyboard order, screen-reader output and focus visibility on the console are unverified.                                                                                          | —     |

## What does not apply

Listed because a statement that admits nothing is not a statement.

- **No accounts.** There is nothing to sign in to, so the accessible-authentication criteria
  (SC 3.3.8 and 3.3.9) do not apply. Sync pairs devices with a code.
- **No audio and no video.** The time-based media criteria (SC 1.2.1 to 1.2.9) do not apply.
- **No time limits.** Nothing expires while you are reading the console (SC 2.2.1).
- **No flashing content.** Nothing animates at a rate that could trigger a seizure (SC 2.3.1).
- **Parsing is obsolete.** SC 4.1.1 was removed in WCAG 2.2.

## Telling us about a barrier

Open an issue describing what you were doing, what you expected, and what happened. A description of
the barrier is more useful than a suggested fix, and both are welcome. If the barrier was in an app
rather than the console, say which app; that leads to the right statement.
