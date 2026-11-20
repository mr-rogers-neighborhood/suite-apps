# Status

What works, per subsystem. "Working" means a test fails if it breaks. This page describes the tree at
the commit that contains it; each app's `CHANGELOG.md` is the dated record of changes.

| Area | State | Notes |
| --- | --- | --- |
| Hub: install | Working | Signed feed, checksum, binary placed, menu entry written |
| Hub: update and rollback | Working | Replaces the managed copy and relaunches; one step back from disk |
| Hub: uninstall | Working | Versions, entry, icon and record removed; documents untouched |
| Hub: routing | Working | `suite://` links and document files open the owning app |
| Hub: Flatpak | Partial | Lists, launches and removes Flatpak installs; does not install them yet |
| Canvas | Alpha | Cards, boards, editor, library, views, sharing and sync; still changes shape |
| Planner | Pre-alpha | Day view, inbox, capture, estimates; no sync transport |
| Budget | Pre-alpha | Launcher, accounts, register, month grid, rollover, reconcile, backups; no network |
| Sync | Phase 2 demo | Protocol, membership, room, WebSocket server and CLI work; plaintext, loopback-only |
| Sync: invite and join | Missing | Adding a device is still a CLI step |
| Sync: blind relay | Target | The room stores plaintext today; ciphertext is the design |
| Go | Shell only | Android debug build installs; no domain ships; iOS unbuilt; no sync transport |
| Shared packages | Working | `@suite/contracts`, `files`, `desktop`, `theme`, `ui` are consumed as workspace packages |
| Linux packaging | Working | AppImage and Arch package for the hub; app AppImages through Start |
| Flatpak | Experimental | Proven on Canvas; unsigned development remote |
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
