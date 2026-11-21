# Decisions

The rules that shape this repository. Each is current; the code follows it.

## Workspace

- One pnpm workspace. The root lockfile is the only one installed.
- Shared packages are `workspace:*`. Never reintroduce a git-tag pin or a `link:` path.
- Each app owns its gate. The root gate builds shared packages once, then runs each app's gate in
  dependency order.
- The gate is local. `--fresh` proves a commit, not the working tree. No CI service gates a pull
  request.
- `@suite/desktop` is shared Electron policy. Canvas's shell is `@suite/canvas-desktop`.
- Suite Help (`apps/help`) is the documentation reader and it is a shipped app. It indexes every
  file and declaration, renders the handbook from `docs/`, and keeps module notes in
  `docs/modules/` and tours in `docs/tours/`. It is Vite + React Router + Fumadocs headless in an
  Electron shell, served from `suite-help://app/`; Flatpak owns updates. `docs/` and each app's
  `docs/` remain the source of truth.
- The reader is not organized by Diátaxis. Browser, Modules and Tours are the structure over one code
  index; reference facts are generated, and module MDX plus tours are the prose layer. Prose is
  authored only after a person reviews it and adds `reviewed: human` to the module or tour
  frontmatter; until then it is generated, whoever wrote it. The old
  tutorials, how-to, reference and explanation pages remain a notes archive; new content goes to
  `docs/modules/` or `docs/tours/`.
- A tour is one concept with two authoring forms: `docs/tours/*.mdx` for a linear prose path and
  `docs/tours/*.tour.mjs` for a composed path that crosses modules, files, symbols, tours or docs.
  The MDX preamble is the intro; `## interlude: <title>` is a chapter; `### overlay: <title>` adds a
  dismissible commentary card. The index resolves every target, so a tour cannot rot into dead links.
- Tour membership is data: the index records which curated and composed tours target a file or
  symbol, and the file view lists them. `Full descent`, interludes and overlays do not mark a file.

## Layout

- Apps live under `apps/<name>`. Each app owns its private packages: Canvas has `desktop/` and
  `packages/graph`, Planner has `pack/` and `packages/core`, and so on.
- Packages used by two or more apps live at the root `packages/`.
- The top bar is a host–app contract: the host keeps `mark` and `controls`, and the active app takes
  over the middle. [Menu bar](menu-bar.md) names the seven zones.

## Packaging

- Start replaces only a file it can write. It installs, updates and removes the apps it placed, and
  asks Flatpak to install or update a deployment. It does not update a copy a person placed.
- The three document apps and the hub ship as AppImage and Flatpak; the hub also ships an Arch
  package. Help ships only as a Flatpak, with no AppImage feed. `deb` is not a configured target,
  and `rpm` and `snap` were never built.
- Flatpak is a second channel: Start lists and launches installs, installs from the store, updates a
  deployment whose commit is behind, and removes through Flatpak. Flatpak is the writer, never Start.
  The hub can be a Flatpak too, with its own `run.suite.start` deployment.
- Signed manifests live at `feeds/<app>/latest-linux.yml` in this repository, served from the raw
  file host at `main` because GitHub Pages would need Actions. The artifact they name stays an asset
  on the app's `<app>-v<version>` release tag.
- Stable and pre-release are two identities: `run.suite.<app>` and `run.suite.slop.<app>`. The tier
  (`slop`, `canary`, `beta`) is the Flatpak branch, not part of the id, so one pre-release install
  can move tier while stable stays installed. A pre-release is tagged
  `<tier>-<app>-v<version>` and never writes `feeds/<app>/`; the OSTree summary is signed with the
  store key and the AppImage manifest with the update key. The AppImage manifest id is `slop-<app>`;
  the older `slop.<app>` id is still read for an installed build.
- `scripts/release.mjs` is the release path. It refuses a dirty tree, a version with no changelog
  heading, a commit the gate has not proven, and a manifest whose artifact is missing. It is a dry
  run unless `--publish` is passed.
- A version lives in one place and a tag names one app's release. [Version ownership](../how-to/package-and-release.md#version-ownership)
  states which file owns it and which prefix the tag uses.
- An installed AppImage verifies a feed with the update key it was built with; a Flatpak verifies the
  OSTree summary with the store key. A key rotation therefore ships a new Start first — AppImage,
  Arch package or Flatpak — and a feed signed with the new key is published only after that build
  exists.
- Private signing keys live outside the repository, in `~/.config/suite/keys/` or wherever
  `SUITE_KEYS_DIR` points. A public half is pinned in the source that verifies it, and
  `pnpm keys status` proves the two agree. No secret is stored in a generated directory such as
  `.dev/`: a cleanup deletes it, and the pin is left with no key able to satisfy it.
  [Manage signing keys](../how-to/keys.md) owns the procedure.
- Linux is the published platform. macOS and Windows have no signing identity.

## Desktop host

- Desktop Suite is separate sandboxed apps plus Start as the shell. The shell owns the catalogue, the
  channels, routing and updates; Flatpak is the host runtime; documents and keys stay app-owned.
- One container window is rejected: it loses per-app isolation, crash boundaries and accessibility
  boundaries.
- A host agent is not built now. The Flatpak session helper (`org.freedesktop.Flatpak` through
  `flatpak-spawn --host`) is what the sandboxed hub uses behind the same
  [`PackageBackend`](../../apps/start/docs/reference/decisions.md); that grant is effectively host
  command execution. A D-Bus agent remains the alternative if the permission set grows, and it would
  be a second package manager until it earns its keep.
- No service owns sync membership or keys. One service owning them would collapse the sandbox
  isolation; [sync is a capability](../../apps/sync/docs/reference/sync-capability.md) that moves
  sealed frames and readable membership.
- A signed pack form may be added inside Start later; domains do not move into it.
- The W3C MiniApp model contributed the host, the manifest, declared capabilities and the lifecycle.
  Its packaging specification is retired, so there is no compliance target.

## Product boundary

- A document is a file the user owns. The hub returns a path or bytes; it never parses a document.
- No account, no telemetry, no project-operated server.
- Sync is a server the user runs. It persists and authenticates; it does not own the truth.
- Collaboration is a session while devices are connected. A sleeping device is not woken.
- A reminder is a delivery, not a subscription: the container passes a title and a time to the
  platform, stores nothing, and carries nothing on the next launch. A pack asks again, and a denied
  permission is shown rather than swallowed.
