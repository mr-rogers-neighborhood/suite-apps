---
audience: developer
---

# Decisions

The rules that shape this repository. Each is current; the code follows it. Cross-boundary host, pack,
relay and catalogue behavior is owned by the [superapp specification](../spec/superapp.md); this page
owns the rationale, and [Status](status.md) owns what exists.

## Workspace

- One pnpm workspace. The root lockfile is the only one installed.
- Shared packages are `workspace:*`. Never reintroduce a git-tag pin or a `link:` path.
- Each app owns its gate. The root gate builds shared packages once, then runs each app's gate in
  dependency order.
- The gate is local and CI runs the same command. `--fresh` proves a commit, not the working tree. A
  pull request runs the rows its diff can break (`scripts/affected.mjs`); the merge queue proves that
  exact SHA and runs a row's e2e suite when one is marked (no row marks one after Start's retirement,
  #314); the nightly keeps the full gate; `main` on push runs the prelude only. The `vm` remote and
  its gate are retired.
- `@suite/desktop` is shared Electron policy. Canvas's shell is `@suite/canvas-desktop`.
- Suite Help is the documentation reader and it is a shipped app. Its renderer and docs generator
  live in `packs/help`, and the frozen Electron shell in `legacy/help` compiles the same renderer. It
  indexes every file and declaration, renders the handbook from `docs/`, and keeps module notes in
  `docs/modules/` and tours in `docs/tours/`. It is Vite + React Router + Fumadocs headless in an
  Electron shell, served from `suite-help://app/`; Flatpak owns updates. `docs/` and each app's
  `docs/` remain the source of truth.
- The reader is not organized by Diátaxis. Browser, Modules and Tours are the structure over one code
  index; reference facts are generated, and module MDX plus tours are the prose layer. Prose is
  authored only after a person reviews it and adds `reviewed: human` to the module or tour
  frontmatter; until then it is generated, whoever wrote it. The old
  tutorials, how-to, reference and explanation pages remain a notes archive; new content goes to
  `docs/modules/` or `docs/tours/`.
- The one planning page in the reference archive is [Ideas](ideas.md). It owns no fact: every row
  links to the owning page or decision, and no other new reference or Diátaxis page is added without
  an owner decision.
- A tour is one concept with two authoring forms: `docs/tours/*.mdx` for a linear prose path and
  `docs/tours/*.tour.mjs` for a composed path that crosses modules, files, symbols, tours or docs.
  The MDX preamble is the intro; `## interlude: <title>` is a chapter; `### overlay: <title>` adds a
  dismissible commentary card. The index resolves every target, so a tour cannot rot into dead links.
- Tour membership is data: the index records which curated and composed tours target a file or
  symbol, and the file view lists them. `Full descent`, interludes and overlays do not mark a file.

### The trunk stops re-running the full tree (#407, #422)

Recorded 2026-11-25.

- **`main` on push runs the prelude only** — the `libraries` build, the `scripts` checks and the
  Budget pack round-trip, about 0.4 minutes — to confirm the merged SHA resolves and the declared
  project set is intact. The merge queue's whole-row run is the proof for the exact SHA, the 02:00
  nightly is the scheduled full-tree proof, and `workflow_dispatch` keeps the full `--fresh` tree as
  a manual proof.
- **The basis is measured.** In a fixed 24-hour window of about 2,100 job records (#422), 88 of 94
  trunk pushes were already queue-proven SHAs, the trunk's full-tree export had 0 true catches in 56
  hours, and 15 of its reds were false — a `biome check .` that saw zero files. About 1,540
  job-minutes a week went to re-proving what the queue had proved.
- **Expected and re-measured.** Trunk job-minutes should fall from about 220 to about 15 a day, and
  after a week the same window should show no trunk red that the queue did not also catch.
- **The docs moved with the decision.** This rewrites "`main` runs the full fresh gate" in
  [ci.md](../spec/ci.md) (C1.2, C4.4) and the root `AGENTS.md`; the workflow edit lands separately.

### Slop builds only the hosts the push changed (#407, #422)

Recorded 2026-11-25.

- **The push diff decides.** `slop.yml` gains a `slop-targets` job that reads the push diff and the
  workspace graph: a Desk source change builds only the Desk Flatpak, a Go change only the slop APK,
  and a shared package reaches a host only through its declared dependencies. A scripts, packaging,
  lockfile or unrecognised path rebuilds both. The fallback is deliberate: a stale slop artifact is
  worse than a saved minute.
- **A docs or workflow-only push publishes nothing.** Its run is the `slop-targets` job alone, green,
  with one sentence in the step summary.
- **Measured before, expected after.** Scoping the 8 slop pushes in the #422 window
  (2026-11-24T17:39Z → 2026-11-25T14:26Z) skips 2 of 8 (`f9bd6244`, `9b04236d`) at about 4.3 minutes
  each: about 1.1 of 4.9 minutes per push. A push that touches one host saves its ~1.9-minute APK or
  ~2.5-minute Flatpak path instead.
- **actionlint moves into `fast`.** The separate always-on `workflows` job is gone. `fast` runs Go
  setup and actionlint only when the diff touches `.github/workflows/`, from the `workflows` output
  `scripts/affected.mjs` already computes. In the window's 33 merge-queue runs, 19 (58%) touched no
  workflow file, so they no longer pay its ~0.35 minutes.
- **The proof is untouched.** Neither cut changes the merge-queue row set, the nightly full gate, or
  the `ci` aggregator's assertions.
- **A scoped host build still builds its dependencies.** The first Go-only push after #448 failed
  with `Rolldown failed to resolve import "@suite/pack"`: the Go APK step had been leaning on the
  Desk Flatpak step to produce the workspace packages' `dist/`. `android-release.mjs` now builds
  `@suite/go-app^...` before the app, the same way `flatpak.mjs` already built the libraries for the
  Desk path. Fixed forward under #422; #448 was not reverted.

## Layout

- The tree has four roots. `hosts/<host>` is a host (`desk`, `go`), `packs/<app>` is a pack
  workspace package (`@suite/<app>-pack`) whose `pack/` holds the source, `legacy/<app>` is a frozen
  app and its Electron shell, and `services/relay` is the relay. Shared packages live at the root
  `packages/`, cross-app pages in `docs/`, and the Flatpak manifests in `packaging/`.
- Packages used by two or more apps live at the root `packages/`.
- Planner and Budget share `@suite/document-runtime`: one renderer replica owns the `observe` call
  site, and one main-process store owns the debounced temp-file rename. Each app keeps its document
  factory, schema, file format, directory and backup policy.
- The top bar is a host–app contract: the host keeps `mark` and `controls`, and the active app takes
  over the middle. [Menu bar](menu-bar.md) names the seven zones.

### The tree moved to hosts/, packs/, legacy/ and services/ (#408, #429)

Recorded 2026-11-25.

- **The move is one mechanical pull request, not a rename with rewrites.** It landed as #429:
  `apps/desk` → `hosts/desk`, `apps/go` → `hosts/go`, `apps/<app>/pack` → `packs/<app>/pack`, the
  rest of Canvas, Planner, Budget and Help → `legacy/<app>`, and `apps/sync` → `services/relay`.
  Package names, gate rows and commands did not change.
- **Why one PR.** A staged move keeps two path conventions alive for weeks, and every page, script
  and test that names a path is then edited twice. One reviewed diff with a green gate is cheaper
  than weeks of parallel truth. This is the recorded exception to spec R6; the rest of the migration
  stays staged.
- **What proved it.** The gate ran the same rows and stayed green, and the same change made the gate
  discover `scripts/*.test.mjs` from the directory instead of a hand-maintained list, so a moved
  script test could not silently stop running.
- **No migration.** Paths are build and working-copy facts; no user data directory names one.

### Help's renderer and docs generator live in its pack (#432)

Recorded 2026-11-25.

- **The pack owns the source.** The explorer, handbook reader, theme and renderer entry moved from
  `legacy/help/src/renderer` to `packs/help/pack/src/renderer`. The pack entry and the desktop shell
  both compile that one copy; only the router differs.
- **The generator moved with it.** `index-code.mjs`, `sync-docs.mjs` and their link helper now live
  in `packs/help/scripts`. The pack runs them directly, and the shell's `index` and `sync` commands
  call the same scripts.
- **Generated output belongs to the pack.** The code index writes `packs/help/public/data`, and the
  handbook mirror writes `packs/help/.generated/docs`; both are ignored and outside `pack/`, so the
  pack-shape rule still holds.
- **Why.** A pack that reads its source, scripts and generated files from the frozen shell keeps the
  old inversion one layer above `node_modules`. Moving the files makes the pack's build honest
  without changing what a reader sees.

## Desktop host

- **One desktop host.** `hosts/desk` (`@suite/desk`) is the desktop host. It is one Electron app
  that opens signed, sandboxed packs as tabs, and it owns the catalogue, Home, the Screens manager,
  routing and pack updates. Start is gone (#314); the frozen Flatpaks remain installable with their
  documented `flatpak install` lines. The host is alpha, and the pack bar below is still how a pack
  earns a place.
- **The shipping bar is proven by an app, not by a window.** [Shipping packs](#shipping-packs) is the
  bar, and Budget is the first witness.
- The host is not the same-process container that [Architecture](../explanation/architecture.md)
  rejects: each pack gets its own `WebContentsView`, custom-protocol origin and session partition.
  One renderer that mounts every domain is still rejected, because it loses per-app isolation,
  crash boundaries and accessibility boundaries.
- Packs are renderer-only: no Node, no raw filesystem, no network unless the manifest declares it.
  The host brokers files and documents as opaque bytes scoped by the sender's pack id, and never
  parses an app document.
- The host owns its space document. A **Space** is the user-facing grouping — not necessarily work;
  a **Container** is the local data identity; a **Session** is the local set of open windows and tabs.
  The space document is a Loro document with the host's own schema; it is container-ready, but v1
  exposes one default container and flat tabs. App documents and sync keys stay with their packs.
  A domain app may still call its own document a “workspace” in its own docs; the host does not use
  that word for host state.
- The host owns the chrome and renders pack-declared contributions (commands, menus, toolbar,
  status, widgets). A pack draws only its content; it never renders into host DOM.
- Host-only chrome is the `@suite/ui/chrome` subpath (`HostTabBar`, `NewTabPicker`). A pack imports
  the pack-safe `@suite/ui` entry; Desk and Go import the subpath. The package exports make the
  boundary visible in review, and `src/chrome/boundary.test.ts` fails if a pack crosses it.
- **A host that skips preflight owes the controls its own reset.** The shared components are Tailwind
  class names, so a host must give Tailwind their source, and Desk's legacy page cannot take the
  unlayered preflight that Go and the packs import. The first version skipped preflight and replaced
  nothing, so the island kept the browser's control defaults — an outset tab button, a grey Sync pill,
  an underlined brand link — and only Storybook, which has preflight, looked right. The host declares
  the small reset it needs (`button`/`input`/`select`/`textarea` unstyled, no anchor underline) in the
  `base` layer, below `utilities` and below the unlayered legacy rules, so a control that styles
  itself still wins. A workbench story is not proof a host renders correctly; the proof run is.
- **The host's theme sheet is `!important`, and that is the contract.** A pack ships its own `:root`
  fallbacks so it is legible before the host paints it. Electron's `insertCSS` is ordinary author CSS,
  so it loses to the pack's own `:root` on source order and the shipped palette won for every installed
  pack. The resolved sheet therefore declares every role and scale value `!important`; anything less
  is a pack that silently ignores the host's theme. Go does not share the bug because it paints inline
  style properties on the frame's root, which already outrank the document.
- A new tab asks two questions: which surface, then which document. The picker lists the five most
  recent documents first and opens a pack's second level when it declares documents; a pack that
  declares none opens directly. The word for a document is the pack's (`name.singular` /
  `name.plural` in its manifest), not the host's.
- Signed packs are the release rule. The spike loads directory packs for development and must not
  ship as a release path.
- A host agent is not built now. The host installs packs into its own data directory and leaves
  Flatpak deployments to Flatpak; it holds no host command execution grant. A D-Bus agent remains
  the alternative if a future surface needs to manage deployments, and it would be a second package
  manager until it earns its keep.
- No service owns sync membership or keys. One service owning them would collapse the sandbox
  isolation; [sync is a capability](../../services/relay/docs/reference/sync-capability.md) that moves
  sealed frames and readable membership.
- `@suite/sync-desktop` is shared mechanics, not shared trust. The group, relay pin, cursor, pending
  join, frame queue and reconnect live once for Canvas and Planner; each app injects its own data
  directory and identity, keeps its own `sync/contacts.json` decision, and keeps its capability and
  IPC surface. A shared contacts file would move a per-app trust decision across the boundary and is
  rejected here.
- The W3C MiniApp model contributed the host, the manifest, declared capabilities and the lifecycle.
  Its packaging specification is retired, so there is no compliance target.

### The desktop host is Suite Desk (#335, #392)

- The desktop host's product name is **Suite Desk**, replacing Suite Shell; Suite Go keeps its name.
  The pair reads as two places — the desk and the go — rather than two technologies.
- **Tier 1 (#335) changed the words, labels and mark.** The identity stayed `@suite/shell`,
  `apps/shell` and `run.suite.shell`, so an existing install updated in place.
- **Tier 2 retires the shell identity.** The package is `@suite/desk`, the directory is `hosts/desk`,
  and the Flatpak ids are `run.suite.desk`, `run.suite.slop.desk`, `run.suite.nightly.desk` and
  `run.suite.preview.desk`. The environment is `SUITE_DESK_*`, the host declaration is `DESK_HOST`,
  the gate row is `desk`, and release artifacts are `suite-desk-*`.
- **The new id is a fresh start.** A Flatpak id is the application identity, so an existing
  `run.suite.shell` install does not update into `run.suite.desk`; it is a second app until the old
  card is removed. The owner chose no data migration: the new id opens an empty data root, the old
  `~/.var/app/run.suite.shell` install and data are ignored, and the owner may remove them. The old
  refs are retired by a one-time fresh-start wipe of the signed remote and are not rebuilt or
  republished.
- The platform kind stays `desktop`. "Shell" remains an implementation word for the Electron chrome
  (`ShellWindow`, `ShellTab`), a POSIX shell or a shell command, never a product or install identity.
- Both hosts carry the mark Start used: `hosts/desk/build/icon.png` and its sized set under
  `hosts/desk/build/icons/` are Start's own artwork, recovered from the commit before Start's
  retirement (#314), and Go's launcher icons are generated from the same bytes. The name differs
  between the hosts; the logo does not.

## Blobs and export

- A pack's blobs belong to one of three content-addressed stores: `asset` (the person's originals,
  exported), `derived` (not exported by default) and `cache` (disposable). A manifest names a store
  and declares its class; the class is the physical store, scoped to the pack and named by the
  SHA-256 of the bytes. A read re-hashes the bytes and refuses a mismatch, and clearing `cache`
  removes only cache. The host cannot prove a cache blob is regenerable, so "never the only copy" is
  the pack's promise; backing up `asset` and `derived` is still open.
- Export is a host-owned bundle. The host picks the destination and gives the pack's declared
  `export` entry a save handle scoped to relative paths inside it; `manifest.json` and `assets/` are
  reserved for the host. The host writes every `asset` as its original bytes at `assets/<sha256>`,
  records each with its hash and length, verifies every hash, and writes the manifest last.
  `derived` and `cache` are not exported.
- A pack that declares no `export` entry is exported for its assets anyway, with `packExport: null`
  and no document entries. S6.8 says a pack declares one; refusing the whole export over a manifest
  omission would strand a person's assets, so the bundle records the omission instead. The choice is
  tested in `hosts/desk/src/exportBundle.test.ts`.

## Packs

- `identity.pack` is a per-pack key derived from the host's device key, never the device key itself
  (S2.6, S4.7). The input is the tuple `(publisher id, pack id)` under the versioned label
  `suite/pack-identity/v1`: the pack id alone would collide when two publishers hold one id, and
  the publisher id keeps the key stable across a publisher key rotation while a migration to
  another publisher starts a new identity. A host gives a pack the public half and signs only the
  pack's own data; a pack key must not sign relay frames, relay role records or membership
  changes. The host's derivation and signing guard are in
  [hosts/desk/src/packIdentityKey.ts](../../hosts/desk/src/packIdentityKey.ts) and
  [its decisions](../../hosts/desk/docs/reference/decisions.md#pack-identity-and-keys). Suite Go
  does not derive `identity.pack` yet, so one identity across both hosts is still owed.
- `@suite/pack` is the desktop pack contract: manifest, capabilities, contributions, file hashes and
  Ed25519 verification. It shares the pinned key and the capability words with Suite Go, not the
  manifest: Go requires `independent` and `isolation` and has different canonical bytes, so each
  host refuses the other's pack until the formats are unified (#202). [Status](status.md) is the
  source of truth for that split.
- `@suite/pack-runtime` is the pack-side service interface. `@suite/pack-host` is the host-side
  scoped file store, locks and backups. Neither imports Electron.
- A pack's `files` capability is a **scoped filesystem**, not an arbitrary path API: relative paths
  inside the pack's root, host-owned atomic writes, backups and locks; absolute paths, `..`,
  symlinks and non-regular files are refused. External files use a user-consented host handle, with
  open-in-place or import.
- The host may open the pinned relay socket, but it forwards opaque frames. The pack runs the sync
  protocol and holds the keys. The host sees ciphertext, not a document.
- One shared Suite pack key signs desktop and mobile packs; the pin is the one thing both hosts
  read from the same source. The manifests differ until #202, so a pack built for one host is not
  installable on the other. Pack files are the distribution path today; a signed remote index is a
  later path, and the intent is that both are first-class once the host has one. The host itself
  updates through its OS package.

### A pack is a workspace package (#408, #429)

Recorded 2026-11-25.

- **`packs/<app>` is a workspace package, `@suite/<app>-pack`.** Its `package.json` declares
  `"suite": { "pack": true }` and owns the pack's Vite and Vitest toolchain. pnpm installs it like
  any other workspace package, so there is still one dependency graph and one lockfile.
- **This departs from R2.2's earlier wording, "a pack is source, not a workspace package".** The
  source-only rule now applies to `pack/`, not to the package: `pack/` holds the manifest, `src/`,
  one Vite config, the tests and the README, and no `node_modules/` or output. The installed tree is
  `packs/<app>/node_modules/`, which pnpm creates and git ignores; the build output is
  `packs/<app>/.dev/pack`. [repo-structure.md R2.2](../spec/repo-structure.md#2-packs) carries the
  amended rule.
- **Why.** `pack/` had to reach Vite, Vitest and TypeScript through the legacy shell's installed
  tree; linking it at install time was a second, invisible dependency graph that could disagree with
  the lockfile. Making the pack a package keeps the toolchain with the source and still keeps
  `pack/` free of generated files.
- **The app version stays with the shell.** The source manifest's `version` still equals the legacy
  app's `package.json` version, and a gate row runs the shell and then the pack, so the row names and
  count do not change.

### Shipping packs

The acceptance bar for a shipping desktop pack. A real shipping app must run as a signed pack with its
documents and consented export/import; Budget is the first witness. The host installs packs; the
frozen apps remain separate Flatpaks until each passes.

- The pack owns its document format. The host brokers bytes and never parses it, so a pack's schema,
  migrations and file layout stay its own.
- A one-time import of an existing document leaves the originals untouched and keeps a copy inside the
  pack's own scoped files. Import is not a move, and the host does not rewrite the source.
- The host owns install, routing, Home and Screens ([#314](https://github.com/mrrnbhd/suite-apps/issues/314)).
  Start is retired; a feature that belongs to the host does not get a second home.
- Go's format split is [#202](https://github.com/mrrnbhd/suite-apps/issues/202); that
  issue owns the detail. The desktop pack format does not converge here.

### Retiring a frozen shell

Recorded 2026-11-25. Owner-approved.

A frozen app owes its last **published artifact**, not its source forever. The artifact stays
installable from the signed remote, and the shell may retire once the app's pack passes the
[shipping bar](#shipping-packs): a signed pack with its documents and consented export/import, proven
in a window and by a release-archive install
([#358](https://github.com/mrrnbhd/suite-apps/issues/358)).

- **Retirement is the end of a successful port, not a way to skip one.** The pack owns the renderer,
  document layer and generator; a shell that still owns a fact the pack needs is not ready.
- **The last artifact survives.** The signed remote keeps the last published ref, the same rule as the
  retired Sync app (#315). Nothing is unpublished, and a person who installed the Flatpak keeps it.
- **What moves before the directory goes.** A retirement change is one checklist:
  1. Move the shell's docs, e2e and proof specs, and its `CHANGELOG.md` into the pack.
  2. Update the row in `scripts/lib/pipeline.mjs`.
  3. Update `scripts/proof-of-changes.mjs`.
  4. Update `scripts/release-status.mjs`.
  5. Update the `docs-check.mjs` ignores.
  6. Update the `pnpm-workspace.yaml` globs.
  7. Update the Flatpak manifests in `packaging/flatpak/`.
  8. Update [Status](status.md).
- **The order is Budget → Help → Planner → Canvas.** Budget is the first witness and already ships as
  a pack; Help has the smallest shell; Planner follows the pack work that moved its renderer and core;
  Canvas is last because its shell, e2e and private packages are the largest surface.
- **A shell is retired, not erased from history.** `legacy/canvas` keeps Canvas's pre-import history;
  the retirement removes a build lane and a stale tree, not the record of what shipped.

## Retiring Start (#314)

Start was removed once the host installed a pack from the catalogue (#223, #331) and Home was the
default surface. The pieces that were still Start's moved or were dropped deliberately:

| Start responsibility | Where it went, or why it was dropped |
| --- | --- |
| Discover, install, update and remove legacy Flatpaks; update Start itself | Dropped. Flatpak owns a deployment and a frozen app or the host has one `flatpak install` line; `flatpak update --user` is the update path. The host is not a package manager. |
| Pack install, update, reinstall and remove in the catalogue | Already the host catalogue; unchanged by the removal. |
| Cards, categories, icons, pre-release tiers and update states | The host's pack tiles and catalogue own the pack shape. Start's pre-release card tiers and its own update row were about Flatpak branches and a self-updating hub; both are dropped with that surface. |
| Home composition and the inline widget edit | Already in `hosts/desk/src/home.ts`; the Start copy was deleted. |
| The Screens manager (list, create, rename, duplicate, delete, set Home) | Moved to the host: `hosts/desk/src/screens.ts` owns the set and `screens.json`, the window exposes it, and the chrome draws the manager. The manager's rules and tests moved with it. |
| The `start.recents` widget and the document index | Dropped. Start's cross-app list was fed by scanning `~/Documents`; the host never opens a document path and a pack owns its own recents. Shipping a host list would require the documents-folder service the host does not have. |
| The Sync tab's deployment states | Dropped. It showed whether the `run.suite.sync` Flatpak was installed; no host surface manages a Flatpak. The relay's delivery and tray are #315; see [Retiring the Sync tray app](#retiring-the-sync-tray-app-315). |
| The Suite Help card | The host catalogue and Home; Help is a pack source and a frozen Flatpak, not a card Start owns. |
| `suite-start-cli` | Dropped. It existed to exercise Start's routing without a window; the host's `deepLink.ts` and its tests own `suite://` routing, and there is no user CLI. |
| File associations and routing | `suite://` routing is the host's (`deepLink.ts`); the host now also claims `x-scheme-handler/suite` in its desktop entry. Extension-based file routing is dropped: a pack owns its documents and the host never receives a path for one, while a frozen Flatpak registers its own MIME type. |
| Clearing the old `hub.json` | Dropped. It cleared a stale relay report in the host home directory; the host is sandboxed and never wrote that file, so it has no host path to clear. |
| Theme, window icon, shortcuts, folder-copy records | Dropped with the Flatpak launcher: the host has its own theme, icon and window, and a pack has no folder-copy install to reveal or forget. |

Start's own suite went with it. The rules the host now owns moved to the host's tests: the Screen-set
tests (last Screen, Home replacement, rename, duplicate, persistence) are in
`hosts/desk/src/screens.test.ts`, and `suite://` parsing already lives in
`hosts/desk/src/deepLink.test.ts`. The Flatpak card, store-channel, package-backend, folder-record,
CLI and renderer tests for Start's removed surfaces were deleted with those surfaces.

A person's Start data directory (`~/.config/suite/start`: `installs.json`, `screens/`,
`screens.json`, `dashboard.json` and `hub.json`) is orphaned. Nothing in the tree reads or writes it
after this change, and this issue explicitly rules out a migration tool. The directory is left in
place, untouched; a person may delete it. Documents the frozen apps wrote under
`~/Documents/Suite` are app-owned and are not part of Start's directory, so they are unaffected.

## Retiring the Sync tray app (#315)

`run.suite.sync` stopped being a shipped artifact. It left the release table and the
`RELEASES.md`/release-body surface the way a frozen app does: no row describes a build the pipeline
will publish. `status.md` keeps a row that says it is retired rather than shipped. There is no
`CODEOWNERS` file in this repository, so that surface had nothing to remove, and no release matrix
named Sync; the gate row stays, and its tests keep running.

The delivery split is deliberate:

| What stops | What stays |
| --- | --- |
| New `run.suite.sync` builds on the signed remote | `services/relay` as the protocol, the client library and the relay implementation |
| The separate tray app as the way a person runs a relay | The headless `suite-sync` CLI and the relay's store format |
| The tray's install line as the documented path | The Canvas and Planner clients, and the sync gate row that tests them |
| The tray as the place sync state is shown | The host as the surface that carries that state |

The last published ref is the last published ref. A person who already installed it keeps what they
have and keeps updating from whatever `origin` it has; this change is about what the pipeline ships
next, not about unpublishing or removing a ref from the store.

### The relay becomes a supervised child of the host

Recorded 2026-11-25. Owner-approved.

Sync is a capability of the host, not an app a person installs. The host's tray absorbs the states and
controls the separate app owned: whether sync is on, the relay address, code and fingerprint, and
starting or stopping the relay. The chosen shape is a **supervised child** the host starts and
watches, not a module inside the host process.

- **The host owns the lifecycle.** It spawns the relay with its own store, watches its exit, applies a
  bounded restart policy, and stops it before the host exits. A crash is contained in the child; a
  relay restart is not a host restart.
- **Status crosses one IPC surface.** The host reads readiness, address, code, fingerprint,
  reachability and the last error over a status channel; it writes start, stop and reach changes back.
  The relay owns no UI, and the host parses no frame.
- **Ordering is explicit.** The host waits for readiness before it reports sync as available or opens
  a sync call. On shutdown it stops new work, flushes the relay's store, waits for the child to exit,
  then exits itself; a child that does not answer is killed after the bound.
- **The boundary is narrower than a module would give.** The child starts without a `documents` grant
  and with only its own store, so "the relay never reads a document" becomes an operating-system
  boundary where the platform allows one — the Flatpak sandbox on desktop, and the mobile host's
  process model on Android and iOS. Where the platform cannot enforce it, the same rule stays a
  code-path and test boundary. The desktop host is that case: a Flatpak carries no Node runtime, and
  its Electron binary cannot be its own Node under zypak, so the relay is a `worker_threads` thread
  in the host's process and receives only its store.
- **Frames stay opaque.** The host may open the pinned socket and forward bytes; the relay persists
  sealed frames and signed membership records and never receives a document handle, a path or a
  plaintext frame. A module inside the host was rejected because it gives the relay the host's crash
  domain and lets a relay bug take the host down.
- **State is the host's to show.** The host stores the reach choice and owns the tray surface; the
  relay reads the choice it is started with and reports status back. The relay keeps its existing
  store shape.

Implemented on 2026-11-25 in `hosts/desk` and `services/relay`:

- `services/relay/src/child.ts` is the relay entry. It takes `--store` (and optionally `--host` and
  `--port`), starts the same relay `serve` starts, and writes one JSON readiness line. `stop` closes
  the listener, console and store before it reports `stopped`; the relay refuses a document, file,
  workspace or data-root argument by name.
- `hosts/desk/src/relaySupervisor.ts` starts that entry as a `worker_threads` thread with only its
  store and a whitelisted environment, waits for readiness, applies a bounded restart policy, and
  stops it before the host exits. `hosts/desk/src/relayAdapter.ts` is the pack-facing service: one
  pinned socket to this host's relay, opaque frames and a tab-scoped token. The host never parses a
  frame.
- The relay is a thread rather than a spawned process (changed 2026-11-26). The packed host's
  executable is Electron, and under Flatpak it is zypak-wrapped: a child started with
  `ELECTRON_RUN_AS_NODE=1` aborts in zypak (`DetermineZygoteStrategy: Assertion failed: bus`) because
  the supervisor's whitelisted environment carries no session bus. The packaged host also fuses
  `runAsNode` off, so that child could not have run the relay even with one. A `worker_threads` thread
  is Node code in the host's process, never launches Electron, and keeps the status contract, the
  store and the no-documents rule. The thread's imports of `@suite/sync-server` ship in the app's
  asar, so the packaged host carries the relay instead of failing at start.
- Per-document keys, relay frame verification, the header index and gap recovery remain S7.2–S7.6
  (#304). This slice is the lifecycle and transport seam, not the document protocol.

### Android and iOS

The tray is a desktop surface. On mobile the host the person is using owns the presentation, with the
same composite quick capture and home-screen widget Go already has (#186, #227); there is no tray on
Android. A persistent notification that carries sync state and offers capture is an **idea, not a
requirement**: Android can pin one, and iOS cannot pin one the same way, so the two hosts would differ
deliberately. It stays in [Ideas](ideas.md), not in this contract.

## Packaging

- Flatpak is the only Linux desktop form for Suite Desk, Canvas, Planner and Help. Suite Budget is
  the exception: its last `run.suite.budget` Flatpak stays published for export, and its signed pack
  from the Desk catalogue is the install path. `run.suite.sync` is retired as a shipped app (#315):
  since then, no new build is published, the signed remote keeps its last published ref, and the
  relay's code runs as a host capability rather than a separate app. The last published app also runs
  the CLI headlessly with `flatpak run --command=suite-sync`. There is no AppImage, Arch package,
  `deb`, `rpm` or `snap`.
- Flatpak owns a Flatpak deployment. No Suite process writes into a deployment, replaces it or offers
  an update button; `flatpak update --user` is the path. The host is only the writer for its own
  packs.
- A deployment updates from its own `origin` remote, so a copy from `suite-local` is not measured
  against the public `suite` store. Flatpak reads that origin; the host does not compare commits.
- The channels are `slop`, `nightly`, `preview` and `stable`, and they belong to the superapp: Suite
  Desk on the desktop and Suite Go on mobile. `slop` stays the session channel; `nightly` and
  `preview` replace `canary` and `beta`, which are refused rather than aliased. A mini-app does not
  carry a channel; when it ships as a pack it carries a signed version.
- Product maturity is separate from the channel: `pre-alpha`, `alpha`, `beta` and `1.0`. A
  stable-channel build can still be labeled `alpha`.
- One identity per pre-release channel. Stable keeps `run.suite.<app>`; `slop`, `nightly` and
  `preview` are `run.suite.slop.<app>`, `run.suite.nightly.<app>` and `run.suite.preview.<app>` on the
  branch of the same name. Every channel is its own install and its own data root, so all four can be
  installed and updated side by side. Nightly and preview moved from the shared `run.suite.slop` id,
  so an install made before #380 reinstalls once under the new id; no pre-release data is migrated.
  [One identity per pre-release channel](#one-identity-per-pre-release-channel-380) records the
  change.
- Suite Go carries the same channel model in its package id: `run.suite.go` for stable and
  `run.suite.slop.go`, `run.suite.nightly.go` and `run.suite.preview.go` for the pre-release channels.
  The APK is signed by a release keystore outside the repository; its certificate digest is pinned,
  and a build refuses any other certificate. The debug key is a dev-loop signature and never a public
  artifact.
- `versionCode` is the base in `app.config.json` times ten plus a fixed channel digit (stable 0,
  slop 1, nightly 2, preview 3). It increases within a channel as the base does. Each package id grows
  on its own sequence: promotion installs a second app rather than updating a shared pre-release id,
  and a lower code on one id is refused rather than made legal by an uninstall.
- Canvas, Planner, Budget and Help are frozen legacy apps until they become packs: their last published
  artifact stays installable, and no new pre-release channel is published for them. Their source stays
  until the pack passes the [shipping bar](#shipping-packs) and the
  [retirement checklist](#retiring-a-frozen-shell) runs; then the shell may retire. Sync is retired
  rather than frozen: it is not on a channel and it is not a shipped artifact at all (#315).
- `scripts/flatpak.mjs` builds the local deployment and signs the repository summary with the store
  key; `scripts/flatpak-remote.mjs --publish` publishes the signed repository to the public
  `https://flatpak.suite.run/` store, or to `suite-dev` with `--target lan`. The last published
  `run.suite.sync` ref stays on the same remote and is not rebuilt; the relay's retired
  `sync-v<version>` tarball release stays downloadable history, and `scripts/release.mjs` now holds
  only the shared release helpers and the gate proof.
- The last `run.suite.sync` build kept its store and certificate pair under the app's own data
  directory (`$XDG_DATA_HOME/suite-sync`), not in a documents folder, and its one host grant outside
  the sandbox was `xdg-config/autostart` for the login entry it wrote when asked. A host that runs the
  relay uses the same store shape without the app's tray.
- The relay's reach is a stored choice, not a bind the build ships: `loopback` by default, `tailnet`
  when Tailscale is running, and `network` only after a confirmation — the last app's form of the
  CLI's `--trust-all-remote`. `SUITE_SYNC_BIND` overrides it for a test or a host unit. The host stores
  and shows the choice and starts the supervised worker with it;
  [The relay becomes a supervised child of the host](#the-relay-becomes-a-supervised-child-of-the-host)
  records the shape.
- A version lives in one place and the rolling release carries it; per-app tags are retired.
  [Version ownership](../how-to/package-and-release.md#version-ownership) states which file owns it.
- The Flatpak store key signs the OSTree summary. Flatpak verifies the summary and every object's
  content hash on install and update. The relay's update key signed the retired tarball's
  `SHA256SUMS`; no shipped artifact carries it any more.
- Private signing keys live outside the repository, in `~/.config/suite/keys/` or wherever
  `SUITE_KEYS_DIR` points. A public half is pinned in the source that verifies it, and
  `pnpm keys status` proves the two agree. No secret is stored in a generated directory such as
  `.dev/`: a cleanup deletes it, and the pin is left with no key able to satisfy it.
  [Manage signing keys](../how-to/keys.md) owns the procedure.
- Linux is the published desktop platform. macOS and Windows have no signing identity.
- Android ships as a release-signed APK attached to the rolling release, on the stable or a
  pre-release channel; there is no store channel yet. The keystore lives outside the repository and
  the certificate digest is pinned, so a build refuses any other signer. The debug key is the dev
  loop only.

### One identity per pre-release channel (#380)

- **The shared pre-release id is replaced.** `run.suite.slop.<app>` and `run.suite.slop.go` used to be
  one identity for slop, nightly and preview. Each pre-release channel now has its own id and its own
  data root, so all four superapp channels install and update beside each other. The branch names and
  the channel digits do not change.
- **Slop was the one pre-release id that did not move in #380.** Its Desk id was
  then the shell form and its Go id was already `run.suite.slop.go`; the Desk
  rename later took the Desk id to `run.suite.slop.desk`. Nightly and preview
  moved to `run.suite.nightly.{desk,go}` and `run.suite.preview.{desk,go}`.
- **The move is a reinstall, once.** A nightly or preview install made before this change does not
  update into the new id; it installs once under the new id and the old card is removed by hand. No
  pre-release data is migrated: the new id starts with an empty data root, and the old data is not
  copied or renamed.
- **The versionCode rule is per package id.** Android reads the newest manifest for the APK's own
  package id and refuses a lower code; an equal code is a rebuild of the same app version on that id.
- **The Desk rename later moved all four Desk ids to `.desk`.** That is a separate identity change
  with a fresh data root; [The desktop host is Suite Desk](#the-desktop-host-is-suite-desk-335-392)
  records it.

### Slop publishes every push (#386)

- **Slop is published, not just built.** The `slop` workflow runs on every code push to `main` and
  publishes the build being worked on: `run.suite.slop.desk` on branch `slop`, the Suite Go slop
  APK, and one page per build. This replaces the older reading of D3.1 that slop was only a local
  session artifact; the spec records the new boundary.
- **The page is per commit.** The tag is `suite-slop-<YYYY.MM.DD>-<sha7>`, the APK is
  `suite-go-slop-<version>-<sha7>.apk`, and the body names the commit. A second run for the same
  commit is a no-op and never moves the tag, even on a later day. A new merge is what makes a new
  page.
- **The proof is the merge queue, not the full gate.** A slop push has no fresh gate, e2e, clean
  install, SBOM or attestation. The page says **merge-queue-proven, not full-gate-proven** so nobody
  reads it as a release. `flatpak-remote.mjs --merge-queue-proven` is accepted only with
  `--channel slop`; every other channel still needs `.dev/gate-status.json`, and a dirty tree still
  refuses.
- **No index and no Latest.** A slop publication writes only its own refs and page. It never publishes
  the pack catalogue index, never moves GitHub's Latest release, and never touches the stable refs;
  the remote's normal ref merge keeps every other branch in the signed summary.
- **Seven builds are kept.** `release-status.mjs --prune --channel slop --keep 7` deletes older
  published slop pages and their tags. The tag pattern is the revision shape, so a revision-less
  page is history rather than a candidate. Slop is a session channel, not release history.
- **A burst builds the tip.** The workflow's `concurrency` group cancels an in-flight slop run when a
  newer push arrives. A manual dispatch has a `publish` boolean that defaults off, so the same build
  and key path can be rehearsed without publishing.

## Reviews and release keys

- The repository has one owner account. GitHub refuses a self-approval, so a required approving
  review would deadlock every pull request and the merge queue; the `main` ruleset requires no
  approval. The review is the review-only agent, required thread resolution and the `ci` check, and
  the merge queue is the last gate. This is the recorded exception to C2.3, not a claim that a second
  person reviewed the change.
- The `approval` environment holds the reviewer for `preview` and `stable`. The `release` environment
  holds the signing keys, is restricted to `main` and release tags, and has no reviewer: a required
  reviewer there would also hold the nightly `workflow_call`, which must publish unattended. The
  boundary is the branch policy plus the approval job that must succeed before the publish job
  starts. This is the recorded exception to C9.3.
- A second account or team restores the two-person shape. Until then, neither environment pretends
  to have one.
- Actions are pinned by full commit SHA and `sha_pinning_required` is on for the repository;
  Dependabot is the only writer of those pins.

## Widgets and Screens

- A widget is a host-rendered declaration: the app says what it is called, how big it may be, which
  fields it takes and how one placement is configured. The host draws it with its own components.
  No app bundle, script, style or document runs in the host. The white paper's widget is a page a
  host mounts (§2.1.5, §3.1.5, §4.5); a host that never reads a document cannot mount that page, so
  the contract is the declarative part the model implies.
- There is one descriptor shape, used by the desktop host and the packs it renders. It is
  `{ id, title, size, capabilities, action, settings? }`, in `suite.app.json` for desktop and in a
  pack's `manifest.json` for Go, validated by `@suite/contracts`. `id` is app-local lower kebab-case
  and the host registers it as `<app id>.<widget id>` — `planner.quick-task` — so an app cannot
  claim a host id. A host widget uses the same registry-id shape under the host's own app id, but it
  resolves through the host's own table: `desk.apps` is not an app declaration, and the registry is
  for app declarations. `size` is one of `1x1`, `2x1`, `full`. Go reuses
  this descriptor in its launcher and an Android home-screen widget is a native adapter over it; Go
  does not get a second descriptor.
- `settings` is a list of instance fields: `{ id, label, type, default?, required?, maxLength? }`,
  using the same three types as a capture field (`text`, `day`, `number`). Every instance value is a
  string, keyed by the field id. A widget without `settings` is unchanged and every manifest written
  before settings existed stays valid. The contract version moved to 1.1.0 for the additive field,
  so a manifest that uses settings declares 1.1.0 and a 1.0.0 host refuses the pair rather than
  meeting a key it does not know.
- One action exists in phase 1: `capture`. Its fields are declared data — id, label, type, whether
  it is required, a length ceiling — and the host renders inputs from them. An unknown size,
  capability or action is refused when the manifest parses, not ignored.
- A capture is typed. The host sends `{ widget, action: "capture", values, settings }` with one
  string per declared field and per declared setting; the app validates it against its own schema,
  writes through its own document layer and answers `{ ok, message, open? }`. A setting the host
  keeps but the descriptor does not declare stays on the Screen and is reported, never sent to an
  app that cannot use it. The host never reads or writes an app document and never holds app data.
  A malformed capture is refused with a sentence the host can show.
- A widget opens the full app through the existing `suite://` link when the task needs more room. It
  never embeds a second instance of the app; capture is the only write path phase 1 adds.
- A **Screen** is the host's own Loro document, and `@suite/screens` owns its shape. It is
  `{ format: "suite.screen", version: 2, id, name, widgets: [...] }`. The widget list is ordered and
  each entry is either a widget or a row. A widget is `{ registryId, size, settings? }`; a row is
  `{ kind: "row", size, layout: "row" | "carousel", items: [{ registryId, weight, settings? }] }`
  and may not nest. The schema is strict and accepts no code, HTML, path, document bytes or app-data
  field; that refusal is the point. The package carries no React, Electron, DOM or file IO: the host
  owns the path, the atomic write and the backup, and the package only produces and reads snapshots.
- A **row** is the composition primitive, not a page builder. Items declare a weight instead of a
  pixel position; the shared layout gives them relative width on a wide window and turns the row into
  one horizontal scrolling line at phone width, so two widgets never squeeze into unreadable half
  columns. A host that cannot draw a row flattens it to a stacked list and says so rather than
  dropping placements.
- **Home is a role**, not an app and not a fixed window. The host's Home is a Screen named Home with
  id `desk-home`, the first role over one descriptor table. A Screen tab is an open surface beside
  app tabs: it belongs to the host chrome, not to a pack, and no app can draw into it. A Screen can be opened from a tile, a launcher entry or an Android
  home-screen widget, and Screens do not nest inline inside other Screens.
- The Home manager is the host's, not an app's. It adds, removes, moves, resizes and configures
  placements, with an inline edit mode for quick reorder, resize and add. The host-owned Screens
  manager creates, renames, duplicates and deletes a Screen, sets Home, and exports or imports the
  portable `.screen` file. The host owns it; no app manages the layout, and there is no separate
  Suite Screens app. This manager moved from Start to the host with #314.
- A Screen owns order, size and placement. Every host renders the same composition responsively;
  there is no per-device placement override in v2.
- Unknown is visible. A registry id this build cannot resolve stays in the document and is drawn as
  an unknown placement with a note naming it; an unknown setting stays on the instance and is
  reported. Showing less than the Screen says, silently, is the failure this rule prevents.
  Reinstalling or updating the app brings its widget and its settings back without the person
  rebuilding the layout.
- Migration keeps a backup. A host that changes a Screen shape copies the old bytes aside before the
  new document replaces them; a corrupt, empty or newer file is refused whole. Start's
  `dashboard.json` migration was removed with Start (#314): its data directory was never in the
  host's sandbox, and this issue rules out a migration tool. The file stays where Start left it,
  untouched; see the retirement record above. Go's current home is its default Home Screen when Go
  adopts the contract.
- The Screen is portable as a `.screen` file: a Loro snapshot in a small `SUITE-SCREEN` envelope with
  its own envelope version and a canonical header (`format`, `version`, `id`, `name`, `home`,
  `payloadLength`). Export writes the current Screen version; import runs the same migration chain as
  the stored document, accepts an older version, and refuses a newer one before decoding it. A refusal
  names the next action and leaves the existing Screens and Home choice untouched. A valid import
  creates a new Screen rather than replacing an id; a file that was Home on the writer's device
  becomes Home. Sync across a person's devices is still #199; a file is a manual copy.
- The Screen is local to this host and device in this slice. It is not stored in an app document and
  is not owned by an app. A pack never reads or writes a Screen document.
- The registry is what this host build can draw: its own widgets plus the app widgets whose action it
  implements and whose manifest parses. A host that does not draw a widget leaves its entry in the
  unknown case.
- Composite layout is constrained: a row or carousel groups widgets under the same size classes, and
  its items declare a weight rather than a position. It is not a page builder and cannot place
  content outside the grid; nesting stops at one level and a row cannot contain a Screen.
- The name is **Screen**, not View, Board or Space. The Home Screen is the one named Home, and
  Screens are the set a person manages.
- Rejected: a general page builder; arbitrary app code, scripts or HTML in the host; a Screen owned
  by an app; synced or app-owned layouts in this slice; host-held app data or a host-side document
  cache; a descriptor that needs the app running to render; a widget bundle as a second packaging
  format; a second descriptor for Go.

## Command Surface

### The Command Surface and Composite Widget contract (#224)

Recorded 2026-11-25. Decided by the owner on 2026-11-25; implemented in #224, #225 and #226, with
Planner as the first provider. The three calls that were open are recorded in place below.

The [Command Surface epic](https://github.com/mrrnbhd/suite-apps/issues/217) puts capture, commands and
search on one host-owned surface, and the Composite Widget (Capture Card) reuses the same providers in
a compact card. This record fixes the contract the host, pack and UI issues
([#225](https://github.com/mrrnbhd/suite-apps/issues/225),
[#226](https://github.com/mrrnbhd/suite-apps/issues/226),
[#227](https://github.com/mrrnbhd/suite-apps/issues/227)) implement against, so none of them invents a
second grammar.

- **One surface, three modes.** Capture, Command and Search share one input. The active app is a mode,
  not an `@app` token. Universal tokens are `#tag`, `@mention` and `/command`; each token's meaning is
  app-scoped, and a pack may declare extra namespaced tokens. Parsing is deterministic in v1: no
  model and no network.
- **The declaration.** A provider declares one entry per command:
  - `id` — stable pack-local command id, dotted lower kebab-case (`planner.quick-task`), the shape
    `contributions.commands[].id` already uses.
  - `title` — one line, 1–80 characters, the primary label.
  - `subtitle` — optional second line, 1–120 characters, normally the scope or the pack name.
  - `keywords` — optional up to 12 lower-case strings; the deterministic matcher uses them and never
    replaces the title.
  - `icon` — optional pack-relative path listed in `files`; the host draws it in a bounded slot and
    refuses a path outside the pack (S3.6).
  - `scope` — `global`, `documents`, or a provider-defined scope id; what the command acts on.
  - `provider` — the pack-side entry or method the host calls; the host never imports it.
- **Where it lives.** The command half extends the signed `contributions.commands` entry, which
  already carried `{id, title, category?, keybinding?}`, with `subtitle?`, `keywords?`, `icon?`,
  `scope?` and `provider?`. Search, scope rows and capture answer calls rather than describe a menu
  item, so they share **one `contributions.providers` list**. Each entry is `{kind, entry, scopes?}`:
  `kind` is `commands`, `search` or `scopes`, `entry` is the pack-side method the host invokes, and
  `scopes` names the scope ids that provider serves. A provider the manifest does not list is
  refused, not called. The schema, canonical bytes and fixtures live in
  `packages/contracts/src/commands.ts`, `packages/pack/src/manifest.ts` and
  [the manifest schema](../spec/manifest.schema.json).
- **Discovery is installed packs plus the host.** The host lists its own commands and those of
  installed packs whose manifest parses and whose `commands` capability is granted (S4.6). A provider
  entry the manifest does not list is refused, not called. An app or scope this build cannot resolve
  stays visible as a named placeholder; it is never hidden.
- **Ranking is deterministic and local.** Exact title match, then prefix, then keyword match, then
  recency within the current host session, then title order. There is no popularity, telemetry or
  cross-app signal (S12.4). **Recency is stored, and only in the host session.** It is a local,
  clearable list of command ids owned by the host; it is not written to a profile, not keyed to an
  app, never transmitted and gone when the host exits. The surface offers a Clear recents action, and
  `CommandRecency` in `hosts/desk/src/commandSurface.ts` is the whole store.
- **Invocation.** The host sends `{commandId, scope, arguments}` over a **separate scoped `commands`
  channel**, not the document/file bridge. The pack validates the arguments and answers
  `{ok, message, open?}`; the host parses `open` as a `suite://` link before opening it. No document
  bytes cross the channel, and a pack may declare `commands` without `documents`. The host side is
  `hosts/desk/src/commandInvocation.ts`, the pack side is `commands.provide(entry, handler)` in
  `packages/pack-runtime/src/services.ts`, and the sender decides the pack as it does for documents
  and files.
- **Search.** A search provider returns opaque result ids plus display metadata for a query and a
  scope; the host aggregates and opens a result through a deep link (S5.2). The host never indexes
  document content (S11.3).
- **List and capture.** The scope provider answers `scopes()`, `items(scopeId, limit)`,
  `capture(scopeId, values)` and `open(scopeId, itemId?)`. The host caches only display rows with an
  age and offers "Open app to refresh", because a closed pack cannot answer; no document bytes and no
  content cache.
- **The Composite Widget is a widget, not a nested Screen.** It switches apps and scopes, lists the
  active scope, captures with "+", and stores its app/scope selection in its widget settings. It
  shares the Command Surface's provider and deterministic shorthand, and unknown apps or scopes render
  as named placeholders.
- **Go depends on the same contract.** Go's composite quick capture and the Android home-screen widget
  ([#186](https://github.com/mrrnbhd/suite-apps/issues/186),
  [#227](https://github.com/mrrnbhd/suite-apps/issues/227)) open the same scope provider; the desktop
  tray opens the Command Surface. Invocation differs by host; the contract does not.
- **What this does not decide.** The Go implementation of the same quick capture and home-screen
  widget ([#227](https://github.com/mrrnbhd/suite-apps/issues/227)) and the Go capture card
  ([#304](https://github.com/mrrnbhd/suite-apps/issues/304)) are later issues: the desktop host is
  the only implementation in this change. No markup grammar, no model and no host-side app data are
  introduced. The host lists installed packs whose manifest parses and whose `commands` capability
  is granted; an app or scope this build cannot resolve stays visible as a named placeholder, never
  hidden.

Implemented on 2026-11-25, end to end:

- **Declaration.** `packages/contracts/src/commands.ts` owns the provider/command vocabulary and the
  request/response shapes. `@suite/pack` parses `contributions.providers` and the extended command
  entry, refuses an undeclared provider and an icon that is not a listed file, and keeps provider and
  scope order in canonical bytes. `docs/spec/manifest.schema.json`, `docs/spec/fixtures.json` and
  `packages/pack/src/manifest.test.ts` agree.
- **Host surface.** `hosts/desk/src/commandSurface.ts` discovers the host's own commands and installed
  packs' commands, ranks them, and keeps the session recency and the display-row cache.
  `hosts/desk/src/commandBroker.ts` owns consent and invocation. The chrome overlay in
  `hosts/desk/src/renderer/` has Capture, Command and Search modes, an app/scope switcher, keyboard
  selection and a Clear recents action. An unknown app or scope is drawn as a named placeholder.
- **Invocation.** `hosts/desk/src/commandInvocation.ts` is the separate scoped channel. The pack
  preload binds a provider with `commands.provide`; the host refuses a capability-less, denied,
  undeclared, closed or malformed call with a sentence.
- **Planner provider.** `packs/planner/pack/src/provider.ts` binds `commands` and `scopes`. Quick task
  captures through Planner's own `parseCapture` and document layer; `today` and `inbox` return row
  metadata; `open` returns `suite://planner/...`; the manifest declares the three commands and the two
  providers. A closed pack leaves cached rows with an age and "Open app to refresh".

## Declared, not executed

- **The pack declares; the host performs.** A cross-cutting act — a notification, a sync frame, a
  file write, a migration, an export — is a declaration the host reads and acts on, not something the
  pack does through a privileged back door. The spec already uses this verb: a pack *declares* its
  documents, capabilities and widgets (R2.4).
- Two tests settle any "who owns this?" question:
  1. **Can it happen while the pack is not running?** If yes, the host must be able to do it alone,
     which means the declaration carries its own payload.
  2. **Who holds the privilege?** The OS permission, the device key, the clock, the file handle and the
     store key are the host's. A pack that asks for them is asking the host to act on its behalf.
- Three classes, and they are not the same:

  | Class | Example | What the pack contributes |
  | --- | --- | --- |
  | Host mechanism, host meaning | theme, window chrome, store key | nothing; it receives the result |

  Theme is the worked example: the host stores the preset and brightness with its profile, offers the
  only picker, and paints every pack's resolved tokens. A pack that carried its own theme setting
  would be a second identity for the same product.
  | Host mechanism, pack meaning | sync, notifications, export, migration | the declaration: scope, payload, due time, entry point |
  | Pack mechanism, pack meaning | the editing surface, the schema, a projection body | everything; the host is not involved |

- **Declarative is a different word.** It describes form — a widget descriptor, a Screen, a manifest are
  data the host renders or validates. A declared capability usually arrives in a declarative form, but
  the two are not synonyms and neither is the standard on its own.
- **Consequence: a declaration must survive the pack being closed.** A reminder written at save time is
  a row the host can schedule at 09:00 with nothing running; a pack asked to format its own
  notification cannot answer, because it is not running. This is why notifications are projected, not
  performed.
- **Consequence: staleness is a real state, not an edge case.** A declaration captured yesterday may
  describe a document that has since moved. The host refreshes a declaration on save and on open, and
  never later — a background refresh would be the pack running again by another name.
- **A change notice is the host's, not a background pack.** When a document changes on disk while a
  pack is closed, the host records the change itself and hands the pack a pending list on its next
  start; while the pack is open the host watches and pushes ids. The pack never polls a directory and
  is never woken to answer a question. "The library changed" is a fact the host observed, not a
  projection the pack ran.
- **Anti-pattern.** A proxy API that lets a pack perform a privileged act but own the policy invisibly:
  a pack-side scheduler, a pack that formats and posts its own notification through a generic channel,
  a pack that runs its own backup beside the host's. If two copies of a policy can disagree, the
  boundary is wrong.

## Product boundary

- A document is a file the user owns. The host returns bytes; it never parses a document.
- No account, no telemetry, no project-operated document, sync, identity or account service. The
  signed Flatpak store is distribution only.
- Sync is a server the user runs. It persists and authenticates; it does not own the truth.
- Collaboration is a session while devices are connected. A sleeping device may be signalled, but it
  is never woken to accept document data or a write.
- A reminder is a delivery, not a subscription. On a desktop host the host keeps the rows a pack
  projects, so a reminder fires while the pack is closed and survives a host restart; the pack never
  schedules, polls or formats a notification. A denied permission is shown rather than swallowed.
  A host may instead hand a reminder to the platform's alarm and keep nothing, as Suite Go does; the
  pack declares the same rows either way.
