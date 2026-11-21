# Status

What works, per subsystem. "Working" means a test fails if it breaks. This page describes the tree at
the commit that contains it; each app's `CHANGELOG.md` is the dated record of changes.

| Area | State | Notes |
| --- | --- | --- |
| Hub: install | Working | Signed feed, checksum, binary placed, menu entry written |
| Hub: update and rollback | Working | Replaces the managed copy and relaunches; one step back from disk |
| Hub: uninstall | Working | Versions, entry, icon and record removed; documents untouched |
| Hub: routing | Working | `suite://` links and document files open the owning app |
| Hub: Flatpak | Working | Lists, installs from the store, updates, launches and removes Flatpak installs |
| Canvas | Alpha | Cards, boards, editor, library and views; opt-in sync through a host; no account or share link, and still changing shape |
| Planner | Pre-alpha | Day view, inbox, capture and estimates; Upcoming, Projects, Tags, Focus and Rituals views; a task detail dialog; no sync transport |
| Budget | Pre-alpha | Launcher, accounts, register, month grid, rollover, reconcile, backups, targets, rules, schedules, CSV/QIF import, reports; no network |
| Sync | Working | Phase 4 demo: protocol, membership, invite/join, relay, CLI and Canvas client work; the relay is a separate `suite-sync` service Start supervises when installed; it stores sealed frames, not a document; loopback by default, no TLS |
| Sync: invite and join | Working | An invitation link in the Sync dialog; the relay records the joining device's key and spends the invitation |
| Sync: blind relay | Working | One append-only file per workspace: sealed frames, roles, invites, pinned keys and removals; no code path reads a document |
| Go | v0 container | Android debug build installs; Scratch proves capture and documents, Canvas is a placeholder, and an installed pack appears on home; [Planner's state](../../apps/go/docs/reference/planner.md); iOS unbuilt; no sync transport |
| Shared packages | Working | `@suite/contracts`, `files`, `desktop`, `theme`, `ui` are consumed as workspace packages |
| Linux packaging | Working | AppImage and Arch package for the hub; app AppImages through Start |
| Flatpak | Experimental | Local signed store: install and update proven end to end through Start; no published remote |
| macOS and Windows | Not built | No signing identity, so nothing is published |
| Accessibility | Partial | Contrast and start screens are machine-checked; no full manual pass recorded |
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
