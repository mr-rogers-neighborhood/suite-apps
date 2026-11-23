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
| Help | Frozen | Explorer and handbook over the generated index and `docs/`; it ships through Flatpak and Start shows it as a card, but its code stays and it gets no new release until it becomes a pack |
| Canvas | Frozen (alpha) | Cards, boards, editor, library and views; opt-in sync through a host; no account or share link, and still changing shape. Code and last artifact stay, and no new release is published until it becomes a pack |
| Planner | Frozen (pre-alpha) | Day and week views, inbox, capture and estimates; Upcoming, Projects, Tags, Focus and Rituals views; a task detail dialog with rich task notes; sync through a user-run relay ([Planner's Sync](../../apps/planner/docs/reference/sync.md)); the [alpha bar](../../apps/planner/docs/reference/alpha.md) is the closing checklist. Code and last artifact stay, and no new release is published until it becomes a pack |
| Budget | Frozen (pre-alpha) | Launcher, accounts, register, month grid, rollover, reconcile, backups, targets, rules, schedules, CSV/QIF import, reports; no network. The [beta bar](../../apps/budget/docs/reference/beta-bar.md) is written and its machine gaps are closed; a person's review and manual accessibility pass are open. Code and last artifact stay, and no new release is published until it becomes a pack |
| Sync | Working | Phase 4 demo: protocol, membership, invite/join, relay, CLI and the Canvas and Planner clients work; the relay is the `run.suite.sync` Flatpak, whose tray app Start installs and opens like any other app; it stores sealed frames, not a document; loopback by default, a reachable relay serves `wss://` with a pinned self-signed certificate, and the tray app shows the address, relay code and fingerprint |
| Sync: invite and join | Working | An invitation link in the Sync dialog; the relay records the joining device's key and spends the invitation; a relay code can carry the address, pin and a live invitation |
| Sync: friends | Working | Each app shows a 16-symbol friend code and keeps a local contacts file; invitations carry a signed envelope, a known contact connects without a second certificate question, and an unknown code is refused with the code to add; the relay and Start store neither |
| Sync: blind relay | Working | One append-only file per workspace: sealed frames, roles, invites, pinned keys and removals; no code path reads a document |
| Go | v0 container | Android debug build installs; Scratch proves capture and documents, Canvas is a placeholder, and an installed pack appears on home; [Planner's state](../../apps/go/docs/reference/planner.md); iOS simulator builds unsigned in CI; no sync transport |
| Suite Shell (host) | Alpha | Packaged as the `run.suite.shell` Flatpak; the signed remote carries it when published. Home/Screen tabs and the pack catalogue work, and a person can install a `.suitepack` from Home. It is not the default host, and capture, contributions, Screen export/import and sync are not built; unsigned directories need `SUITE_SHELL_DEV_PACKS=1` |
| Screens | Working | Start and the shell render Home from a `suite.screen` document: order, size and settings persist, and inline edit adds, removes, moves and resizes. Start's host-owned manager creates, renames, duplicates and deletes a Screen and sets Home; an unknown widget stays as a named placeholder, and `dashboard.json` migrates once with a visible backup. No portable `.screen` file, Screen sync or app capture handoff yet |
| Budget pack | Built | A signed `.suitepack` builds from Budget's own renderer, installs into the host data root and verifies against the pin; the bridge covers documents, export/import and the library. It has not been launched in a window, `reveal` is a notice, and there is no sync |
| Pack contract | Working | `@suite/pack` parses manifests, capabilities and contributions and verifies Ed25519 signatures and file hashes; the shell and Go both read archives through `@suite/pack-host/archive`, while each keeps its own manifest over the shared pin; Go re-verifies every installed file on load; tested in the shell and Go gates |
| Pack files | Working | `@suite/pack-host` enforces a scoped root with relative paths, symlink refusal, atomic writes, expected-mtime conflicts, backups and locks; the shell exposes it as `files/<container>/<pack>` per pack and keeps installed packs at `<dataRoot>/packs/<id>/<version>`, with locks released when a view dies. The external picker keeps the path in the host and gives the pack an opaque handle |
| Shared packages | Working | `@suite/contracts`, `files`, `desktop`, `theme`, `ui`, `pack`, `pack-runtime` and `pack-host` are consumed as workspace packages |
| Linux packaging | Working | Flatpak for Canvas, Planner, Budget, Help, Start and Sync (the relay); no AppImage or Arch package |
| Release channels | Working | `slop`, `nightly`, `preview` and `stable` on the superapp (Suite Shell and Suite Go); product maturity is separate, so a stable-channel build can be alpha; packs carry signed versions, and legacy Canvas, Planner, Budget and Help are frozen; [Channels](../explanation/channels.md) owns the model |
| Flatpak | Working | Signed local store and a published public remote at `flatpak.suite.run`, with `suite-dev` as the local test host: Canvas, Planner, Budget, Help and Start install and update through Flatpak; Start compares a deployment with its own origin; [Packaging channels](packaging-channels.md#flatpak) owns the remote |
| macOS and Windows | Not built | No signing identity, so nothing is published |
| Accessibility | Partial | Contrast is machine-checked in the desktop apps; Canvas runs axe over its Storybook stories, Planner and Start have no axe gate, Budget's Storybook panel does not fail the build, and the relay's loopback console has no axe; no full manual pass recorded. The statements own the detail: [Canvas](../../apps/canvas/ACCESSIBILITY.md), [Planner](../../apps/planner/ACCESSIBILITY.md), [Budget](../../apps/budget/ACCESSIBILITY.md), [Start](../../apps/start/ACCESSIBILITY.md), [Sync](../../apps/sync/ACCESSIBILITY.md) |
| The gate | Working | Local, at the root; `--fresh` proves a commit rather than a working tree. A pull request runs the rows its diff can break, `main` runs the full fresh gate, and the merge queue adds Start's e2e |

## Reading the table

"Partial" and "Missing" are listed so their absence is a fact rather than a discovery. A feature that
moves between states updates this table and the owning app's README in the same change.

"Frozen" is a release state, not a deletion. A frozen app keeps its code and its last artifact, and it
is not on a channel; Canvas, Planner, Budget and Help stay frozen until they become packs. A maturity
in parentheses (`Frozen (alpha)`) is the product label the app carried when it froze, separate from
the release channels the superapp uses.

The gate is one command, and CI runs that command rather than a second path. A pull request runs the
rows its diff can break, `main` runs the full fresh gate, and the merge queue adds Start's e2e. The
nightly run adds the full gate with e2e, builds the host Flatpak and the Go debug APK, and attests
both; it does not publish. `suite-dev` remains the independent full gate. The evidence is a command
that can be run; see [Commands](commands.md).

## Where to go next

- [The superapp specification](../spec/README.md) is the target contract, and its
  [ledger](../spec/ledger.md) says which clauses the tree implements.
- [Local-first](../explanation/local-first.md) records which local-first ideals are met and which are
  partial.
- Each app's `README.md` says what that app does and what it does not.
- Each app's `CHANGELOG.md` says what changed, in a person's words.
