# Budget's pack source

Budget's renderer built as a signed desktop pack. The layout is the convention in
[docs/spec/repo-structure.md R2.2](../../../docs/spec/repo-structure.md#2-packs), and the authoring
steps live in [the pack authoring reference](../../../docs/reference/pack-authoring.md).

- `manifest.json` is the source manifest. Its `version` tracks Budget's app version, and its
  `documents` entry declares the snapshot format at `SCHEMA_VERSION` from `@suite/budget-core`.
  It also names its `ring` (`stable`), the `minHost` it needs and the capabilities it uses.
- `src/renderer/` is Budget's one renderer source: styles, tests and test setup. The frozen Electron
  shell under `legacy/budget/` builds this same source and keeps the last artifact, so there is no
  second copy. `../packages/core` is `@suite/budget-core`, the schema and document layer both this
  pack and the frozen shell consume.
- `src/` also holds the prelude and the bridge, with their tests. The bridge is the adapter over
  `@suite/pack-runtime`'s shared save, boundary, picker and notice runtime: it keeps Budget's
  library entries, snapshot policy and file codec. `src/PackRender.test.tsx` mounts the pack renderer
  over the prelude and opens, edits, saves, exports and re-imports a budget.
- `vite.config.ts` builds into `packs/budget/.dev/pack`, outside this source tree.
- `pnpm --dir ../.. run budget:pack` builds and signs the archive.

Nothing generated belongs here: `node scripts/pack-shape.mjs` fails the gate if a `dist/` or
`node_modules/` appears under `pack/`.

## Chrome and the shared shells

The frame is `@suite/ui`'s, not Budget's:

| Region | Owner |
| --- | --- |
| Frame, desktop rail column, content region | `AppShell`. The rail is `--shell-nav-width` (236px), so the column's width is the shared shell's, not a local flex child. |
| Top bar | The shared `MenuBar`, passed as `AppShell`'s `header`. The command bar, undo/redo, import, add transaction, save status and view menu stay where they were. |
| Rail lists | `ListView` for the three everyday views, the on/off-budget accounts, the closed-account disclosure and the tools. One listbox pattern for views, account selection and tools. |
| Phone bar and Tools sheet | Still Budget's own `MobileNav`: four primary tabs and one sheet for schedules, payees, rules, import and export. |

Below `md` the shell is asked for **no** navigation: `useWideViewport` omits the rail and the bottom
bar carries the phone's destinations, so a phone spends its height on the register and the plan.
The rail's budget name, account balances, `Export` menu and `PrivacyLine`, the closed-account
disclosure, `ViewMenu`, `MobileNav`, and every view remain app-specific. `DetailView` is not used:
the selected account's header owns a responsive action row that the shared pane would put in its
title bar, so that pane stays Budget's own shape rather than bending the shared one.


## Phone width (360–430px)

The desktop layout is unchanged at `md` and above. Below it, the same views rearrange rather than
shrink:

| Surface | Phone shape |
| --- | --- |
| Navigation | The 236px rail is `hidden`; a bottom bar carries Plan, Accounts, Reports and Tools, with schedules, payees, rules, import, export and All budgets in the Tools sheet. |
| Plan | Month controls wrap; Ready to Assign spans the summary row and the other three figures sit two-up. A category is a two-line card: name and row actions first, Assigned/Activity next, Available and target progress last. |
| Register | The eight-column table becomes a two-column card per transaction with Out/In/Bal labels, so payee, category, memo and cleared stay readable. |
| Accounts | The account header and action row stack and wrap; the balance moves under the name. |
| Dialogs | Form grids collapse to one column, the footer wraps, and the panel follows the dynamic viewport (`100dvh`) so a phone keyboard does not push the actions off screen. |
| Reports | Stats go one-up, tabs wrap, and the budget-vs-actual table scrolls inside its own panel. |

Controls under `md` get a 44px minimum in `theme/styles.css`; the schedule and payee tables and
the import preview scroll inside their own panel rather than widening the page.

### What still needs a person's device or window pass (#358)

- Measure the 44px targets and the bottom bar with TalkBack in Suite Go, including the category
  row's Assigned input and the register's cleared control.
- Open the transaction, target, rules and schedules dialogs with the on-screen keyboard and
  confirm the footer and the last field stay reachable.
- Add a transaction, switch month, import a CSV and re-import the export on a phone and a tablet.
- Check the desktop pack at Desk widths after the responsive classes; the desktop proof is the
  independent run.
