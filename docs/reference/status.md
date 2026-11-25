---
audience: developer
---

# Status

What works, per subsystem. "Working" means a test fails if it breaks. This page describes the tree at
the commit that contains it; each app's `CHANGELOG.md` is the dated record of changes.

| Area | State | Notes |
| --- | --- | --- |
| Help | Frozen | Explorer and handbook over the generated index and `docs/`; its last Flatpak artifact stays and its code gets no new release. Its pack source is built and open; see Help pack |
| Canvas | Frozen (alpha) | Cards, boards, editor, library and views; opt-in sync through a host; no account or share link, and still changing shape. Code and last artifact stay, and no new release is published until its pack passes the shipping bar |
| Planner | Frozen (pre-alpha) | Day and week views, inbox, capture and estimates; Upcoming, Projects, Tags, Focus and Rituals views; a task detail dialog with rich task notes; sync through a user-run relay ([Planner's Sync](../../legacy/planner/docs/reference/sync.md)); the [alpha bar](../../legacy/planner/docs/reference/alpha.md) is the closing checklist. Code and last artifact stay, and no new release is published until its pack passes the shipping bar |
| Budget | Frozen (pre-alpha), ships as a pack | Launcher, accounts, register, month grid, rollover, reconcile, backups, targets, rules, schedules, CSV/QIF import, reports; no network. The [beta bar](../../legacy/budget/docs/reference/beta-bar.md) is written and its machine gaps are closed; a person's review and manual accessibility pass are open. Code and the last `run.suite.budget` Flatpak stay published, and no new app release is built; install `Suite Budget` from the Desk catalogue, and export a `Documents/Suite/Budget` document from the frozen app to import it there |
| Help pack | Built and open | A signed `.suitepack` builds from Help's own renderer, the generated index and the compiled handbook pages into `packs/help/.dev/pack`; it declares no host capability, reads only its archive, and declares `desktop` and `mobile`, so it is available on Go. The pack entry uses hash routing over one `index.html`, the explorer and handbook render headlessly from the bundled data, and two builds of one commit produce the same path list and file hashes. Its card uses Help's own headset mark. A person's window pass, release-archive install and a manual handbook read remain |
| Sync | Working (retired) | Protocol, membership, invite/join, relay, CLI and the Canvas and Planner clients work, and their tests still run in the sync gate row. The relay is no longer a shipped app: no new `run.suite.sync` build is published and the tray app is not the target surface, so the host is where sync state belongs; the signed remote keeps the last published ref for anyone who already has it. It stores sealed frames, not a document; loopback by default, and a reachable relay serves `wss://` with a pinned self-signed certificate. The relay becomes a supervised child of the host; the decision is recorded but the child is not built ([Decisions](decisions.md#the-relay-becomes-a-supervised-child-of-the-host)) |
| Sync: invite and join | Working | An invitation link in the Sync dialog; the relay records the joining device's key and spends the invitation; a relay code can carry the address, pin and a live invitation |
| Sync: friends | Working | Each app shows a 16-symbol friend code and keeps a local contacts file; invitations carry a signed envelope, a known contact connects without a second certificate question, and an unknown code is refused with the code to add; neither the relay nor the host stores a contact |
| Sync: blind relay | Working | One append-only file per workspace: sealed frames, roles, invites, pinned keys and removals; no code path reads a document |
| Go | v0 container | Android debug build installs; Scratch proves capture and documents, Canvas is a placeholder, and an installed pack appears on home; the app catalogue reads the desktop's signed index and installs, updates, reinstalls and removes a pack, with the index and archive paths unit-tested but not yet walked on a phone; a pack declaring `files` reads and writes its own scoped root and is refused another pack's, through the same path rules the desktop uses. All four packs declare `mobile`, so their catalogue rows are platform-available on Go. [Planner's state](../../hosts/go/docs/reference/planner.md); iOS simulator builds are parked, so no CI artifact is produced; no sync transport |
| Suite Desk (host) | Alpha | Packaged as the `run.suite.desk` Flatpak; the signed remote carries it when published. It is the only desktop host and the way in: Home/Screen tabs, the Screens manager and the pack catalogue work, and a person can install, update, remove and reinstall a verified pack from the catalogue or from a `.suitepack` file. A host-owned reminder queue survives a pack closing and a host restart, asks for permission once, shows a denial, and routes a click back to the pack; removing a pack removes its rows. Capture, contributions, Screen export/import and sync are not built; unsigned directories need `SUITE_DESK_DEV_PACKS=1` |
| Screens | Working | The host renders Home from a `suite.screen` document: order, size and settings persist, and inline edit adds, removes, moves and resizes. The host's Screens manager creates, renames, duplicates and deletes a Screen and sets Home; an unknown widget stays as a named placeholder. No portable `.screen` file, Screen sync or app capture handoff yet |
| Budget pack | Working | The first catalogue pack: a signed `.suitepack` builds from the pack's own renderer, declares `ring: stable`, `minHost: 1` and its `documents` + `files` capabilities, installs into the host data root from the catalogue and verifies against the pin. The pack declares its document at schema 1, and the headless pack test opens, edits, saves, exports and re-imports a budget. The frozen Electron app stays for the last `run.suite.budget` artifact and its `Documents/Suite/Budget` files, but its Flatpak lane is retired. A person's window pass remains, `reveal` is a notice, and there is no sync |
| Planner pack | Built and open | A signed `.suitepack` builds from Planner's own renderer into `packs/planner/.dev/pack` and verifies against the pin; the manifest declares the workspace at schema 2, a task and a day page cross the host envelope unchanged, and export re-imports with the same content. The loader and `suite-pack://` entry are covered headlessly. The pack declares `documents`, `files` and `notifications`, and its `reminders` projection returns display rows to the host; the pack no longer polls or schedules. Sync and commands are still host gaps, so sync stays in the frozen desktop app; the host's recent list exists but Planner does not declare `recents` yet. A person's window pass and release-archive install remain |
| Canvas pack | Built and open | A signed `.suitepack` builds from Canvas's own renderer into `packs/canvas/.dev/pack` and verifies against the pin; the manifest declares the `.canvas` workspace at schema 6 and the host envelope carries the whole export envelope, images included. A board opens, edits, saves, exports and re-imports in the headless pack test, and the pack asks only for `documents`, `files` and `recents`; the host now provides reveal, the recent list, the document watch and folder import ([host decisions](../../hosts/desk/docs/reference/decisions.md#the-persons-files-and-library)), so the pack calls those instead of inventing a path. There is no relay service, so collaboration is unavailable in the pack. A person's window pass and release-archive install remain |
| Pack contract | Working | `@suite/pack` parses manifests, capabilities and contributions and verifies Ed25519 signatures and file hashes; Desk and Go both read archives through `@suite/pack-host/archive`, while each keeps its own manifest over the shared pin; Go re-verifies every installed file on load. Canvas, Planner, Budget and Help declare `desktop` and `mobile`, and each publish writes a card sidecar beside the archive without changing the strict index entry; tested in the Desk, Go and scripts gates |
| Pack files | Working | `@suite/pack-host` enforces a scoped root with relative paths, symlink refusal, atomic writes, expected-mtime conflicts, backups and locks; the host exposes it as `files/<container>/<pack>` per pack and keeps installed packs at `<dataRoot>/packs/<id>/<version>`, with locks released when a view dies. The external picker keeps the path in the host and gives the pack an opaque handle. Suite Go serves the same capability over Capacitor's Filesystem plugin, importing the shared path rules and lock table from `@suite/pack-host/files/core` because the Node-backed store cannot enter a WebView; a pack's root is `pack-files/<pack>` for the first-party publisher and `pack-files/<publisher>~<pack>` otherwise, under the app's data directory, and the frame bridge maps each frame to the manifest it was mounted with |
| Shared packages | Working | `@suite/contracts`, `files`, `document-runtime`, `screens`, `desktop`, `theme`, `ui`, `pack`, `pack-runtime`, `pack-host` and `sync-desktop` are consumed as workspace packages |
| Linux packaging | Working | Flatpak for the host, Canvas, Planner and Help; Budget's Flatpak lane is retired, its last `run.suite.budget` ref stays published and the pack is its install path; `run.suite.sync` is retired as a shipped app and the remote keeps its last published ref; no AppImage or Arch package |
| Release channels | Working | `slop`, `nightly`, `preview` and `stable` on the superapp (Suite Desk and Suite Go), each pre-release with its own id and data root, so all four install and update side by side; product maturity is separate, so a stable-channel build can be alpha; packs carry signed versions; Canvas, Planner and Help are frozen until their packs pass the shipping bar, and Budget is frozen with its pack as the install path; slop publishes from every code push to `main` that changes a host, with the merge queue as its proof, never Latest and kept for seven builds; [Channels](../explanation/channels.md) owns the model |
| Flatpak | Working | Signed local store and a published public remote at `flatpak.suite.run`, with `suite-dev` as the local test host: the host and the frozen Canvas, Planner and Help install and update through Flatpak; Budget's last `run.suite.budget` ref stays available while its app lane is retired, and the retired `run.suite.sync` ref stays published without being updated; [Packaging channels](packaging-channels.md#flatpak) owns the remote |
| macOS and Windows | Test builds only | Unsigned test artifacts build nightly in `platforms.yml` and are not published, because there is no signing identity |
| Accessibility | Partial | Contrast is machine-checked in the desktop apps; Canvas runs axe over its Storybook stories, Planner has no axe gate, Budget's Storybook panel does not fail the build, and the relay's loopback console has no axe; no full manual pass recorded. The statements own the detail: [Canvas](../../legacy/canvas/ACCESSIBILITY.md), [Planner](../../legacy/planner/ACCESSIBILITY.md), [Budget](../../legacy/budget/ACCESSIBILITY.md), [Sync](../../services/relay/ACCESSIBILITY.md) |
| The gate | Working | Local, at the root; `--fresh` proves a commit rather than a working tree. A pull request runs the rows its diff can break, the merge queue proves the exact SHA, and `main` on push runs the prelude only; no row marks an e2e suite after Start's retirement |

## Reading the table

"Partial" and "Missing" are listed so their absence is a fact rather than a discovery. A feature that
moves between states updates this table and the owning app's README in the same change.

"Frozen" is a release state, not a deletion. A frozen app keeps its last published artifact and it
is not on a channel; Canvas, Planner and Help stay frozen until their packs pass the shipping bar, and
Budget is frozen with its pack as the install path. Its source stays until the pack passes the bar and
the retirement checklist moves what remains ([Decisions](decisions.md#retiring-a-frozen-shell)). A maturity
in parentheses (`Frozen (alpha)`) is the product label the app carried when it froze, separate from
the release channels the superapp uses.

All four packs are pack-owned: Budget (#454), Help (#456), Canvas (#457, #459) and Planner (#458) build
from `packs/<app>`. Shell retirement is the next delivery step; the order is Budget, Help, Planner and
Canvas, and no shell has retired yet.

A retired app is a delivery state, not a deletion either: its code and tests stay and its last
published ref stays on the signed remote, but it is not a shipped artifact and no new build is
published. Sync is retired as an app (#315); the relay becomes a supervised child of the host.

The gate is one command, and CI runs that command rather than a second path. A pull request runs the
rows its diff can break, the merge queue proves the exact SHA, and `main` on push runs the prelude only.
The nightly run is the full gate, builds the host Flatpak and the Go debug APK, and attests both; with the release keys and `NIGHTLY_PUBLISH` configured it publishes the nightly channel as its
own pre-release page (`suite-nightly-<date>`), keeping the newest 14. Slop publishes on every code
push to `main` after the merge queue, with no fresh gate, e2e, clean install, SBOM, attestation or
pack index; its page says merge-queue-proven, and the newest seven stay
([Channels](../explanation/channels.md#slop-publication)). The GitHub mirror is a draft → attach →
publish flow, safe for immutable releases. The VM gate is retired; the evidence is a command that can
be run, and CI runs it. See [Commands](commands.md).

## Where to go next

- [The superapp specification](../spec/README.md) is the target contract, and its
  [ledger](../spec/ledger.md) says which clauses the tree implements.
- [Local-first](../explanation/local-first.md) records which local-first ideals are met and which are
  partial.
- Each app's `README.md` says what that app does and what it does not.
- Each app's `CHANGELOG.md` says what changed, in a person's words.
