# Status

What works, per subsystem. "Working" means a test fails if it breaks. This page describes the tree at
the commit that contains it; each app's `CHANGELOG.md` is the dated record of changes.

| Area | State | Notes |
| --- | --- | --- |
| Help | Frozen | Explorer and handbook over the generated index and `docs/`; its last Flatpak artifact stays and its code gets no new release. Its pack source is built and open; see Help pack |
| Canvas | Frozen (alpha) | Cards, boards, editor, library and views; opt-in sync through a host; no account or share link, and still changing shape. Code and last artifact stay, and no new release is published until it becomes a pack |
| Planner | Frozen (pre-alpha) | Day and week views, inbox, capture and estimates; Upcoming, Projects, Tags, Focus and Rituals views; a task detail dialog with rich task notes; sync through a user-run relay ([Planner's Sync](../../apps/planner/docs/reference/sync.md)); the [alpha bar](../../apps/planner/docs/reference/alpha.md) is the closing checklist. Code and last artifact stay, and no new release is published until it becomes a pack |
| Budget | Frozen (pre-alpha) | Launcher, accounts, register, month grid, rollover, reconcile, backups, targets, rules, schedules, CSV/QIF import, reports; no network. The [beta bar](../../apps/budget/docs/reference/beta-bar.md) is written and its machine gaps are closed; a person's review and manual accessibility pass are open. Code and last artifact stay, and no new release is published until it becomes a pack |
| Help pack | Built and open | A signed `.suitepack` builds from Help's own renderer, the generated index and the compiled handbook pages into `apps/help/.dev/pack`; it declares no host capability and reads only its archive. The pack entry uses hash routing over one `index.html`, the explorer and handbook render headlessly from the bundled data, and two builds of one commit produce the same path list and file hashes. A person's window pass, release-archive install and a manual handbook read remain |
| Sync | Working (retired) | Protocol, membership, invite/join, relay, CLI and the Canvas and Planner clients work, and their tests still run in the sync gate row. The relay is no longer a shipped app: no new `run.suite.sync` build is published and the tray app is not the target surface, so the host is where sync state belongs; the signed remote keeps the last published ref for anyone who already has it. It stores sealed frames, not a document; loopback by default, and a reachable relay serves `wss://` with a pinned self-signed certificate. The relay becomes a host capability, and its shape inside the host is still owed ([Decisions](decisions.md#retiring-the-sync-tray-app-315)) |
| Sync: invite and join | Working | An invitation link in the Sync dialog; the relay records the joining device's key and spends the invitation; a relay code can carry the address, pin and a live invitation |
| Sync: friends | Working | Each app shows a 16-symbol friend code and keeps a local contacts file; invitations carry a signed envelope, a known contact connects without a second certificate question, and an unknown code is refused with the code to add; neither the relay nor the host stores a contact |
| Sync: blind relay | Working | One append-only file per workspace: sealed frames, roles, invites, pinned keys and removals; no code path reads a document |
| Go | v0 container | Android debug build installs; Scratch proves capture and documents, Canvas is a placeholder, and an installed pack appears on home; the app catalogue reads the desktop's signed index and installs, updates, reinstalls and removes a pack, with the index and archive paths unit-tested but not yet walked on a phone; [Planner's state](../../apps/go/docs/reference/planner.md); iOS simulator builds unsigned in CI; no sync transport |
| Suite Shell (host) | Alpha | Packaged as the `run.suite.shell` Flatpak; the signed remote carries it when published. It is the only desktop host and the way in: Home/Screen tabs, the Screens manager and the pack catalogue work, and a person can install, update, remove and reinstall a verified pack from the catalogue or from a `.suitepack` file. A host-owned reminder queue survives a pack closing and a host restart, asks for permission once, shows a denial, and routes a click back to the pack; removing a pack removes its rows. Capture, contributions, Screen export/import and sync are not built; unsigned directories need `SUITE_SHELL_DEV_PACKS=1` |
| Screens | Working | The shell renders Home from a `suite.screen` document: order, size and settings persist, and inline edit adds, removes, moves and resizes. The host's Screens manager creates, renames, duplicates and deletes a Screen and sets Home; an unknown widget stays as a named placeholder. No portable `.screen` file, Screen sync or app capture handoff yet |
| Budget pack | Built and open | A signed `.suitepack` builds from Budget's own renderer, installs into the host data root and verifies against the pin; the pack declares its document at schema 1, snapshots cross the host envelope unchanged, and the bridge's export re-imports as a working budget. The entry resolves over `suite-pack://`, the prelude installs the bridge and the renderer mounts in the headless gate; a person's window pass and release-archive install remain, `reveal` is a notice, and there is no sync |
| Planner pack | Built and open | A signed `.suitepack` builds from Planner's own renderer into `apps/planner/.dev/pack` and verifies against the pin; the manifest declares the workspace at schema 2, a task and a day page cross the host envelope unchanged, and export re-imports with the same content. The loader and `suite-pack://` entry are covered headlessly. The pack declares `documents`, `files` and `notifications`, and its `reminders` projection returns display rows to the host; the pack no longer polls or schedules. Sync and commands are still host gaps, so sync stays in the frozen desktop app; the host's recent list exists but Planner does not declare `recents` yet. A person's window pass and release-archive install remain |
| Canvas pack | Built and open | A signed `.suitepack` builds from Canvas's own renderer into `apps/canvas/.dev/pack` and verifies against the pin; the manifest declares the `.canvas` workspace at schema 6 and the host envelope carries the whole export envelope, images included. A board opens, edits, saves, exports and re-imports in the headless pack test, and the pack asks only for `documents`, `files` and `recents`; the host now provides reveal, the recent list, the document watch and folder import, so the pack calls those instead of inventing a path. There is no relay service, so collaboration is unavailable in the pack. A person's window pass and release-archive install remain |
| Pack contract | Working | `@suite/pack` parses manifests, capabilities and contributions and verifies Ed25519 signatures and file hashes; the shell and Go both read archives through `@suite/pack-host/archive`, while each keeps its own manifest over the shared pin; Go re-verifies every installed file on load; tested in the shell and Go gates |
| Pack files | Working | `@suite/pack-host` enforces a scoped root with relative paths, symlink refusal, atomic writes, expected-mtime conflicts, backups and locks; the shell exposes it as `files/<container>/<pack>` per pack and keeps installed packs at `<dataRoot>/packs/<id>/<version>`, with locks released when a view dies. The external picker keeps the path in the host and gives the pack an opaque handle |
| Shared packages | Working | `@suite/contracts`, `files`, `desktop`, `theme`, `ui`, `pack`, `pack-runtime` and `pack-host` are consumed as workspace packages |
| Linux packaging | Working | Flatpak for the host, Canvas, Planner, Budget and Help; `run.suite.sync` is retired as a shipped app and the remote keeps its last published ref; no AppImage or Arch package |
| Release channels | Working | `slop`, `nightly`, `preview` and `stable` on the superapp (Suite Shell and Suite Go); product maturity is separate, so a stable-channel build can be alpha; packs carry signed versions, and legacy Canvas, Planner, Budget and Help are frozen; [Channels](../explanation/channels.md) owns the model |
| Flatpak | Working | Signed local store and a published public remote at `flatpak.suite.run`, with `suite-dev` as the local test host: the host and the frozen Canvas, Planner, Budget and Help install and update through Flatpak, and the retired `run.suite.sync` ref stays published without being updated; [Packaging channels](packaging-channels.md#flatpak) owns the remote |
| macOS and Windows | Test builds only | Unsigned test artifacts build nightly in `platforms.yml` and are not published, because there is no signing identity |
| Accessibility | Partial | Contrast is machine-checked in the desktop apps; Canvas runs axe over its Storybook stories, Planner has no axe gate, Budget's Storybook panel does not fail the build, and the relay's loopback console has no axe; no full manual pass recorded. The statements own the detail: [Canvas](../../apps/canvas/ACCESSIBILITY.md), [Planner](../../apps/planner/ACCESSIBILITY.md), [Budget](../../apps/budget/ACCESSIBILITY.md), [Sync](../../apps/sync/ACCESSIBILITY.md) |
| The gate | Working | Local, at the root; `--fresh` proves a commit rather than a working tree. A pull request runs the rows its diff can break and `main` runs the full fresh gate; no row marks an e2e suite after Start's retirement |

## Reading the table

"Partial" and "Missing" are listed so their absence is a fact rather than a discovery. A feature that
moves between states updates this table and the owning app's README in the same change.

"Frozen" is a release state, not a deletion. A frozen app keeps its code and its last artifact, and it
is not on a channel; Canvas, Planner, Budget and Help stay frozen until they become packs. A maturity
in parentheses (`Frozen (alpha)`) is the product label the app carried when it froze, separate from
the release channels the superapp uses.

A retired app is a delivery state, not a deletion either: its code and tests stay and its last
published ref stays on the signed remote, but it is not a shipped artifact and no new build is
published. Sync is retired as an app (#315); the relay becomes a host capability.

The gate is one command, and CI runs that command rather than a second path. A pull request runs the
rows its diff can break and `main` runs the full fresh gate. The nightly run adds the full gate,
builds the host Flatpak and the Go debug APK, and attests both; with the release keys and `NIGHTLY_PUBLISH` configured it publishes the nightly channel as its
own pre-release page (`suite-nightly-<date>`), keeping the newest 14. The GitHub mirror is a draft →
attach → publish flow, safe for immutable releases. The VM gate is
retired; the evidence is a command that can be run, and CI runs it. See [Commands](commands.md).

## Where to go next

- [The superapp specification](../spec/README.md) is the target contract, and its
  [ledger](../spec/ledger.md) says which clauses the tree implements.
- [Local-first](../explanation/local-first.md) records which local-first ideals are met and which are
  partial.
- Each app's `README.md` says what that app does and what it does not.
- Each app's `CHANGELOG.md` says what changed, in a person's words.
