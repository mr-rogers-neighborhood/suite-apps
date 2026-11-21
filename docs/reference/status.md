# Status

What works, per subsystem. "Working" means a test fails if it breaks. This page describes the tree at
the commit that contains it; each app's `CHANGELOG.md` is the dated record of changes.

| Area | State | Notes |
| --- | --- | --- |
| Hub: install | Working | The signed Flatpak remote offers an app; Start asks Flatpak to install it |
| Hub: update | Working | Compares a deployment with its own origin; Flatpak replaces it; Update Start only when the hub's commit differs; no rollback copy |
| Hub: pre-release | Working | Pre-release cards sit in their own section under one caution; each uses its stable app's mark |
| Hub: uninstall | Working | Asks Flatpak to remove a deployment; a placed copy is forgotten; documents untouched |
| Hub: routing | Working | `suite://` links and document files open the owning app |
| Hub: Flatpak | Working | Start is a Flatpak; it lists, launches, updates through the store and removes Flatpak installs, including its own deployment |
| Help | Working | Explorer and handbook over the generated index and `docs/`; ships through Flatpak and Start shows it as a card; uses `@suite/theme` and the shared headset mark |
| Canvas | Alpha | Cards, boards, editor, library and views; opt-in sync through a host; no account or share link, and still changing shape |
| Planner | Pre-alpha | Day and week views, inbox, capture and estimates; Upcoming, Projects, Tags, Focus and Rituals views; a task detail dialog with rich task notes; sync through a user-run relay ([Planner's Sync](../../apps/planner/docs/reference/sync.md)) |
| Budget | Pre-alpha | Launcher, accounts, register, month grid, rollover, reconcile, backups, targets, rules, schedules, CSV/QIF import, reports; no network |
| Sync | Working | Phase 4 demo: protocol, membership, invite/join, relay, CLI and the Canvas and Planner clients work; the relay is the `run.suite.sync` Flatpak, whose tray app Start installs and opens like any other app; it stores sealed frames, not a document; loopback by default, a reachable relay serves `wss://` with a pinned self-signed certificate, and the tray app shows the address, relay code and fingerprint |
| Sync: invite and join | Working | An invitation link in the Sync dialog; the relay records the joining device's key and spends the invitation; a relay code can carry the address, pin and a live invitation |
| Sync: friends | Working | Each app shows a 16-symbol friend code and keeps a local contacts file; invitations carry a signed envelope, a known contact connects without a second certificate question, and an unknown code is refused with the code to add; the relay and Start store neither |
| Sync: blind relay | Working | One append-only file per workspace: sealed frames, roles, invites, pinned keys and removals; no code path reads a document |
| Go | v0 container | Android debug build installs; Scratch proves capture and documents, Canvas is a placeholder, and an installed pack appears on home; [Planner's state](../../apps/go/docs/reference/planner.md); iOS unbuilt; no sync transport |
| Shared packages | Working | `@suite/contracts`, `files`, `desktop`, `theme`, `ui` are consumed as workspace packages |
| Linux packaging | Working | Flatpak for Canvas, Planner, Budget, Help, Start and Sync (the relay); no AppImage or Arch package |
| Flatpak | Working | Signed local store and a published public remote at `flatpak.suite.run`, with `suite-dev` as the local test host: Canvas, Planner, Budget, Help and Start install and update through Flatpak; Start compares a deployment with its own origin; [Packaging channels](packaging-channels.md#flatpak) owns the remote |
| macOS and Windows | Not built | No signing identity, so nothing is published |
| Accessibility | Partial | Contrast is machine-checked in the desktop apps; Canvas runs axe over its Storybook stories, Planner and Start have no axe gate, Budget's Storybook panel does not fail the build, and the relay's loopback console has no axe; no full manual pass recorded. The statements own the detail: [Canvas](../../apps/canvas/ACCESSIBILITY.md), [Planner](../../apps/planner/ACCESSIBILITY.md), [Budget](../../apps/budget/ACCESSIBILITY.md), [Start](../../apps/start/ACCESSIBILITY.md), [Sync](../../apps/sync/ACCESSIBILITY.md) |
| The gate | Working | Local, at the root; `--fresh` proves a commit rather than a working tree |

## Reading the table

"Partial" and "Missing" are listed so their absence is a fact rather than a discovery. A feature that
moves between states updates this table and the owning app's README in the same change.

The gate is local by decision. Nothing checks a pull request, and nothing runs overnight. The evidence
is a command that can be run; see [Commands](commands.md).

## Where to go next

- [Local-first](../explanation/local-first.md) records which local-first ideals are met and which are
  partial.
- Each app's `README.md` says what that app does and what it does not.
- Each app's `CHANGELOG.md` says what changed, in a person's words.
