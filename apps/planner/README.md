# Suite Planner

**A local-first daily planner.** A day view that puts your task list beside a calendar, a week view
across seven days, time estimates against daily capacity, quick capture, rituals and a focus timer —
in one Electron app that opens without a network and keeps your plan in a file you own.

There is no account, no server and no telemetry. Export a `.planner` file whenever you want a copy;
the app keeps an autosaved workspace and one rolling backup on this machine.

Suite Planner is the planning app in the Suite family, alongside
[Suite Canvas](../canvas/README.md) and [Suite Budget](../budget/README.md).

> Suite Planner is pre-alpha. The core loop works; editing surfaces and rituals are being built. The
> closing conditions for leaving pre-alpha are the [alpha checklist](docs/reference/alpha.md).

---

For the product story and the influences behind it, read
[What Suite is](../../docs/explanation/why-suite-exists.md).

## Run it

Node and pnpm are pinned in the root `package.json`.

```sh
pnpm install
pnpm dev        # Electron window, Vite renderer with hot reload
```

Other commands:

```sh
pnpm check      # the edit loop: biome, tsc, changed tests, shape check
pnpm verify     # lint, typecheck, all tests, shape, knip, build, Storybook build
pnpm test       # every Vitest project
pnpm storybook  # component workshop on :6006
pnpm e2e:smoke  # Playwright smoke journey; on request, not part of the gate
pnpm package    # electron-builder targets for this platform
```

On Linux, Planner ships as the Flatpak `run.suite.planner`, and syncs through the relay a person
runs. A pre-release build is a separate Flatpak branch, `slop`, `canary` or `beta`, and keeps its
workspace in `~/Documents/Suite Slop/Planner`.

## Working in the monorepo

The apps, the hub and the sync server share one repository and one gate. Start with the
[root README](../../README.md), then [Commands](../../docs/reference/commands.md) for the gate and
[Repository layout](../../docs/reference/repo-layout.md) for where each package lives.

## What it does

- **A day is the unit.** Today opens to an ordered task list with a capacity meter and a local
  calendar beside it.
- **The week at a glance.** Seven day columns share the same tasks and per-day capacity; move work by
  dragging it or with `Alt` + `←` / `Alt` + `→`, and carry-over waits until you choose it. See
  [Week](docs/reference/week.md).
- **Every surface in the rail.** Today, Week, Inbox, Upcoming, Projects, Tags, Focus and Rituals.
- **Estimates, not guesswork.** Every task carries an estimate; the meter says whether the day fits.
- **Capture in one line.** `Draft the plan tomorrow ~45m #Planner @deep-work !1 9:30` becomes a
  scheduled task with a project, tag, estimate, priority and due time.
- **Inbox, then plan.** Captured work waits in the inbox until you give it a day.
- **It is a document, not a service.** One Loro CRDT document, autosaved atomically, exportable at
  any time.

What changed, in a person's words rather than commits: [CHANGELOG.md](CHANGELOG.md).
Where accessibility stands, and what is checked by hand: [ACCESSIBILITY.md](ACCESSIBILITY.md).

## How it is built

React 19 on Electron, one Loro CRDT document per workspace, Zod-validated records, Tailwind v4 with
Radix primitives. The main process holds the authoritative document and the reminder scheduler; the
renderer keeps a replica and streams CRDT deltas over a narrow, validated IPC bridge.

| Path                          | What lives there                                                           |
| ----------------------------- | -------------------------------------------------------------------------- |
| `src`                         | Electron main, preload bridge, React renderer, Storybook, Playwright       |
| `packages/core`               | Schema, `WorkspaceDocument`, pure projections, capture parser, file format |
| `docs/reference`              | Architecture, conventions, data model                                      |
| `docs/reference/decisions.md` | The rules that shape Planner                                               |

Read [AGENTS.md](AGENTS.md) before contributing (human or agent), and
[docs/reference/architecture.md](docs/reference/architecture.md) for the longer version.

## Licence

MIT, © Suite contributors.
