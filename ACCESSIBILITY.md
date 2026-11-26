# Accessibility

Suite is alpha and pre-1.0. This page owns the suite target and the honest current state: what is
checked by machine, what still needs a person, and where each app records its own evidence. Canvas,
Planner, Budget and Sync keep app statements; Desk, Go and Help have no separate statement, and this
page makes no claim about them.

## Target

The target is **WCAG 2.2 Level AA**, which is 55 of the 86 success criteria. It is a target, not a
claim. [The criterion map](docs/reference/accessibility/wcag-22-map.md) records every criterion as
gated, partial, manual, N/A or a known gap. A statement here or in an app may only claim what that
map supports.

## What is machine-checked, and what is not

One suite-level check holds every `@suite/theme` preset to 4.5:1 for text and 3:1 for focus rings and
component boundaries. It lives in `packages/theme/src/presets.test.ts` and runs in the root gate for
every app that draws its presets from that package. It measures the palette, not the painted window.

Beyond that, coverage is uneven:

- **Canvas** runs axe over its Storybook stories.
- **Planner** has no axe gate.
- **Budget** enables Storybook's accessibility panel, which reports without failing the build.
- **Sync** has no axe run against its loopback console.

Painted contrast, focus order, reflow, motion and screen-reader output are manual steps in
[Manual accessibility testing](docs/reference/accessibility/manual-testing.md). **No full manual pass
has been recorded for any app.** The six-step protocol is written and ready; a green machine check is
not coverage of the interface.

## App statements

| App | Statement | What it covers |
| --- | --- | --- |
| Canvas | [legacy/canvas/ACCESSIBILITY.md](legacy/canvas/ACCESSIBILITY.md) | axe over Storybook, palette contrast, Canvas's known gaps |
| Planner | [legacy/planner/ACCESSIBILITY.md](legacy/planner/ACCESSIBILITY.md) | palette contrast, focus behaviour tests, no axe gate |
| Budget | [legacy/budget/ACCESSIBILITY.md](legacy/budget/ACCESSIBILITY.md) | palette contrast, register/plan/report component tests, Storybook panel, known gaps |
| Sync | [services/relay/ACCESSIBILITY.md](services/relay/ACCESSIBILITY.md) | the console's structure, no axe, known gaps |

## Known gaps

These are real and tracked; none is claimed as working. The [criterion map](docs/reference/accessibility/wcag-22-map.md#the-gaps-in-one-place)
is the full record and names the order of work.

- **SC 2.1.4 (A):** Canvas single-key shortcuts are not remappable or disableable.
- **SC 2.4.12 (AAA):** a sticky region may overlap focused content in edge cases.
- **SC 2.5.5 (AAA):** targets are 24px, not the 44px the enhanced criterion asks for.
- **Canvas:** the board has no complete keyboard model for moving between cards, and three drag
  actions lack a non-drag path: arbitrary section resize, section link endpoints and connector bend
  handles. Status-message markup is correct but unlistened.
- **Planner:** whether a screen reader hears a `Toast` confirmation has not been listened to.
- **Budget:** no screen-reader pass; nested controls in a register row, split child rows and the
  reconciliation blocks still need a reader's judgment; zoom and reflow are unmeasured.
- **Sync:** the console reloads every five seconds and cannot be paused (SC 2.2.2); contrast and
  reflow are unmeasured; there is no axe run and no manual pass.

The map puts SC 2.1.4 first, then the three remaining 2.5.7 items, then the AAA rows.

## What does not apply

There are no accounts to sign in to (SC 3.3.8 and 3.3.9), no audio or video (SC 1.2.1 to 1.2.9), no
time limits (SC 2.2.1), no flashing content (SC 2.3.1), and SC 4.1.1 Parsing was removed in WCAG 2.2.
The [criterion map](docs/reference/accessibility/wcag-22-map.md) gives the reason for every N/A row;
Budget and Planner note an app-specific exception in their statements.

## How to report a barrier

Open an issue that says what you were doing, what you expected and what happened, and apply the
`accessibility` label. A description of the barrier is more useful than a suggested fix; both are
welcome. If it is in an app, name the app. There is no accessibility mailbox; the issue is the
channel.

## What this runs on

- **Linux x86_64:** Suite Desk, Canvas, Planner, Budget and Help, on Electron with Chromium and
  React 19.
- **Android arm64:** Suite Go.
- **Sync:** no desktop window; its console is a loopback page in the browser on the machine running
  the relay.

These are the only published targets. Orca on Linux is the screen reader the manual protocol tests
against; no recorded pass has used it yet.
