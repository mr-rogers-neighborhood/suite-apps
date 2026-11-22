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
- Planner and Budget share `@suite/document-runtime`: one renderer replica owns the `observe` call
  site, and one main-process store owns the debounced temp-file rename. Each app keeps its document
  factory, schema, file format, directory and backup policy.
- The top bar is a host–app contract: the host keeps `mark` and `controls`, and the active app takes
  over the middle. [Menu bar](menu-bar.md) names the seven zones.

## Desktop host

- **Direction: one desktop host.** `apps/shell` (`@suite/shell`) is the intended desktop host. It is
  one Electron app that opens signed, sandboxed packs as tabs, and it takes over Start's role as the
  hub. It is a spike today: the released desktop suite is still separate Flatpaks plus Start, and
  that remains the shipping form until the migration is proven.
- **The migration is proven by an app, not by a window.** [Shipping packs](#shipping-packs) is the
  bar, and Budget is the first witness. The host also carries Start's catalogue, routing and update
  surface before Start stops shipping.
- The host is not the same-process container that [Architecture](../explanation/architecture.md)
  rejects: each pack gets its own `WebContentsView`, custom-protocol origin and session partition.
  One renderer that mounts every domain is still rejected, because it loses per-app isolation,
  crash boundaries and accessibility boundaries.
- Packs are renderer-only: no Node, no raw filesystem, no network unless the manifest declares it.
  The host brokers files and documents as opaque bytes scoped by the sender's pack id, and never
  parses an app document.
- The shell owns its space document. A **Space** is the user-facing grouping — not necessarily work;
  a **Container** is the local data identity; a **Session** is the local set of open windows and tabs.
  The space document is a Loro document with the shell's own schema; it is container-ready, but v1
  exposes one default container and flat tabs. App documents and sync keys stay with their packs.
  A domain app may still call its own document a “workspace” in its own docs; the host does not use
  that word for shell state.
- The shell owns the chrome and renders pack-declared contributions (commands, menus, toolbar,
  status, widgets). A pack draws only its content; it never renders into host DOM.
- Signed packs are the release rule. The spike loads directory packs for development and must not
  ship as a release path.
- A host agent is not built now. The Flatpak session helper (`org.freedesktop.Flatpak` through
  `flatpak-spawn --host`) is what the sandboxed hub uses behind the same
  [`PackageBackend`](../../apps/start/docs/reference/decisions.md); that grant is effectively host
  command execution. A D-Bus agent remains the alternative if the permission set grows, and it would
  be a second package manager until it earns its keep.
- No service owns sync membership or keys. One service owning them would collapse the sandbox
  isolation; [sync is a capability](../../apps/sync/docs/reference/sync-capability.md) that moves
  sealed frames and readable membership.
- `@suite/sync-desktop` is shared mechanics, not shared trust. The group, relay pin, cursor, pending
  join, frame queue and reconnect live once for Canvas and Planner; each app injects its own data
  directory and identity, keeps its own `sync/contacts.json` decision, and keeps its capability and
  IPC surface. A shared contacts file would move a per-app trust decision across the boundary and is
  rejected here.
- The W3C MiniApp model contributed the host, the manifest, declared capabilities and the lifecycle.
  Its packaging specification is retired, so there is no compliance target.

## Packs

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
  later path, and the intent is that both are first-class once the shell has one. The shell itself
  updates through its OS package.

### Shipping packs

The acceptance bar for a shipping desktop pack. A real shipping app must run as a signed pack with its
documents and consented export/import; Budget is the first witness. Until one app passes, the released
suite stays separate Flatpaks plus Start.

- The pack owns its document format. The host brokers bytes and never parses it, so a pack's schema,
  migrations and file layout stay its own.
- A one-time import of an existing document leaves the originals untouched and keeps a copy inside the
  pack's own scoped files. Import is not a move, and the host does not rewrite the source.
- Start remains the shipping hub until the pack is proven. The pack proof does not move Start's
  catalogue, routing or updates into the host.
- Go's format split is [#202](https://github.com/mr-rogers-neighborhood/suite-apps/issues/202); that
  issue owns the detail. The desktop pack format does not converge here.

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

## Widgets and Screens

- A widget is a host-rendered declaration: the app says what it is called, how big it may be, which
  fields it takes and how one placement is configured. The host draws it with its own components.
  No app bundle, script, style or document runs in the host. The white paper's widget is a page a
  host mounts (§2.1.5, §3.1.5, §4.5); a host that never reads a document cannot mount that page, so
  the contract is the declarative part the model implies.
- There is one descriptor shape, used by Start and the desktop shell. It is
  `{ id, title, size, capabilities, action, settings? }`, in `suite.app.json` for desktop and in a
  pack's `manifest.json` for Go, validated by `@suite/contracts`. `id` is app-local lower kebab-case
  and the host registers it as `<app id>.<widget id>` — `planner.quick-task` — so an app cannot
  claim a host id. A host widget uses the same registry-id shape under the host's own app id, but it
  resolves through the host's own table: `start.apps` and `start.recents` are not app declarations,
  and the registry is for app declarations. `size` is one of `1x1`, `2x1`, `full`. Go reuses
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
  `{ format: "suite.screen", version: 1, id, name, widgets: [{ registryId, size, settings? }] }`.
  The widget list is ordered; settings are the instance strings above. The schema is strict and
  accepts no code, HTML, path, document bytes or app-data field; that refusal is the point. The
  package carries no React, Electron, DOM or file IO: the host owns the path, the atomic write and
  the backup, and the package only produces and reads snapshots.
- **Home is a role**, not an app and not a fixed window. Start's dashboard becomes a Screen named
  Home with id `start-home`; the shell's Home is the same role over the same descriptor table. A
  Screen tab is an open surface beside app tabs: it belongs to the host chrome, not to a pack, and
  no app can draw into it. A Screen can be opened from a tile, a launcher entry or an Android
  home-screen widget, and Screens do not nest inline inside other Screens.
- The Home manager is the host's, not an app's. It adds, removes, moves, resizes and configures
  placements, with an inline edit mode for quick reorder, resize and add. The host-owned Screens
  manager creates, renames, duplicates and deletes a Screen, sets Home, and imports or exports the
  portable file. Start owns its manager in this slice; the shell owns its own later. Neither asks an
  app to manage the layout, and there is no separate Suite Screens app.
- A Screen owns order, size and placement. Every host renders the same composition responsively;
  there is no per-device placement override in v1.
- Unknown is visible. A registry id this build cannot resolve stays in the document and is drawn as
  an unknown placement with a note naming it; an unknown setting stays on the instance and is
  reported. Showing less than the Screen says, silently, is the failure this rule prevents.
  Reinstalling or updating the app brings its widget and its settings back without the person
  rebuilding the layout.
- Migration keeps a backup. Start's current `dashboard.json` is `{ format: "suite.start.dashboard",
  version: 1, widgets: [{ id, size }] }`; migration copies every entry in order, including an id this
  build cannot resolve. A corrupt, empty or newer file is refused whole with a sentence the host
  shows, and the old file is written aside before the Screen replaces it. A partial migration is not
  allowed because the person cannot tell which half survived. Go's current home is its default Home
  Screen when Go adopts the contract; this slice migrates Start only.
- The Screen is local to this host and device in this slice. A portable `.screen` file, import and
  export, and sync are later; the document format is designed not to block them, but none of them
  ships here. The Screen is not stored in an app document and is not owned by an app.
- The registry is what this host build can draw: its own widgets plus the app widgets whose action it
  implements and whose manifest parses. One descriptor shape means Start and the shell register the
  same app declaration, and a host that does not draw a widget leaves its entry in the unknown case.
- Composite layout is constrained: a row or carousel groups widgets under the same size classes. It
  is not a page builder and cannot place content outside the grid.
- The name is **Screen**, not View, Board or Space. The Home Screen is the one named Home, and
  Screens are the set a person manages.
- Rejected: a general page builder; arbitrary app code, scripts or HTML in the host; a Screen owned
  by an app; synced or app-owned layouts in this slice; host-held app data or a host-side document
  cache; a descriptor that needs the app running to render; a widget bundle as a second packaging
  format; a second descriptor for Go.

## Product boundary

- A document is a file the user owns. The hub returns a path or bytes; it never parses a document.
- No account, no telemetry, no project-operated server.
- Sync is a server the user runs. It persists and authenticates; it does not own the truth.
- Collaboration is a session while devices are connected. A sleeping device is not woken.
- A reminder is a delivery, not a subscription: the container passes a title and a time to the
  platform, stores nothing, and carries nothing on the next launch. A pack asks again, and a denied
  permission is shown rather than swallowed.
