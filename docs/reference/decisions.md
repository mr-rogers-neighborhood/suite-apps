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
- The one planning page in the reference archive is [Ideas](ideas.md). It owns no fact: every row
  links to the owning page or decision, and no other new reference or Diátaxis page is added without
  an owner decision.
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

- Flatpak is the only Linux desktop form: Canvas, Planner, Budget, Help, Start and Sync. Sync's app is
  also the relay: its tray keeps an embedded relay serving, and the same Flatpak runs the CLI
  headlessly with `flatpak run --command=suite-sync`. There is no AppImage, Arch package, `deb`, `rpm`
  or `snap`.
- Start never writes a deployment. It installs, updates and removes by asking Flatpak, launches with
  `flatpak run`, and reveals a deployment. A folder copy a person places is first-class but not
  Start's: the card offers Open, Reveal and Forget, and Start does not update it.
- An installed deployment is compared with its own `origin` remote's commit, so a copy from
  `suite-local` is not measured against the public `suite` store. A fresh install probes `suite`
  first, then `suite-local`.
- Stable and pre-release are two identities: `run.suite.<app>` and `run.suite.slop.<app>`. The tier
  (`slop`, `canary`, `beta`) is the Flatpak branch, not part of the id, so one pre-release install
  can move tier while stable stays installed.
- `scripts/flatpak.mjs` builds the local deployment and signs the repository summary with the store
  key; `scripts/flatpak-remote.mjs --publish` publishes the signed repository to the public
  `https://flatpak.suite.run/` store, or to `suite-dev` with `--target lan`. The relay publishes on
  the same remote; its `sync-v<version>` tarball release is retired history, and `scripts/release.mjs`
  now holds only the shared release helpers and the gate proof.
- The relay app's store and certificate pair live under the app's own data directory
  (`$XDG_DATA_HOME/suite-sync`), not in a documents folder, and its one host grant outside the
  sandbox is `xdg-config/autostart` for the login entry it writes when asked.
- The relay's reach is a stored choice, not a bind the build ships: `loopback` by default, `tailnet`
  when Tailscale is running, and `network` only after a confirmation in the window — the app's form
  of the CLI's `--trust-all-remote`. `SUITE_SYNC_BIND` overrides it for a test or a host unit, and
  the window says the reach is fixed rather than pretending the selector decides.
- A version lives in one place and a tag names one app's release. [Version ownership](../how-to/package-and-release.md#version-ownership)
  states which file owns it and which prefix the tag uses.
- The Flatpak store key signs the OSTree summary. Flatpak verifies the summary and every object's
  content hash on install and update. The relay's update key signed the retired tarball's
  `SHA256SUMS`; no shipped artifact carries it any more.
- Private signing keys live outside the repository, in `~/.config/suite/keys/` or wherever
  `SUITE_KEYS_DIR` points. A public half is pinned in the source that verifies it, and
  `pnpm keys status` proves the two agree. No secret is stored in a generated directory such as
  `.dev/`: a cleanup deletes it, and the pin is left with no key able to satisfy it.
  [Manage signing keys](../how-to/keys.md) owns the procedure.
- Linux is the published desktop platform. macOS and Windows have no signing identity.
- Android ships as a debug-signed APK attached to the rolling release; there is no signing key or
  store channel yet.

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
