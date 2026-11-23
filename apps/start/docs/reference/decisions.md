# Decisions

The rules that shape Start.

- Every package operation crosses one `PackageBackend`: list installed apps (Flatpak deployments with
  their origin, commit and channel, and folder copies with their record), install, update, remove and
  launch, plus the record operations the window needs. The renderer and the catalogue consume its
  data only; the native backend is the one module that spawns `flatpak`. A Flatpak Start runs behind
  the same seam: it prefixes a command with `flatpak-spawn --host`, using the
  `org.freedesktop.Flatpak` session helper. That grant is effectively host command execution, and it
  is why the hub can manage Flatpaks from a sandbox. A D-Bus host agent remains the alternative if
  the permission set grows, and the window never learns a second way.
- An install record and an install request carry a release `channel`: stable, or a pre-release tier.
  The record is written at install time, so a pre-release keeps its identity even when its manifest
  predates the field.
- Stable and a pre-release are two cards because they are two ids: `run.suite.<app>` and
  `run.suite.slop.<app>`. The manifest id is `slop-<app>`, and the older `slop.<app>` id is still
  read. The card says its tier in text — `slop`, `nightly` or `preview` — and names the risk and removal
  path; a colour is never the only signal.
- One pre-release id means one pre-release install. Every tier shares it, and the Flatpak ref branch
  names the tier. Start refuses to install a second branch; the card offers a switch, which keeps the
  install and the one pre-release data folder (`~/Documents/Suite Slop/<App>`).
- Removing a pre-release asks separately whether to delete that channel's data. Removing stable never
  touches channel data.
- One writer per deployment. Flatpak owns every Linux desktop install; Start asks it to install,
  update, switch or remove, and never writes into an install tree. A folder copy a person placed is
  first-class but not Start's: the card offers Open, Reveal and Forget.
- Start manages the Suite Sync **deployment**, not the relay; it is not a server. Suite Sync is the
  Flatpak `run.suite.sync`. Start detects it through `flatpak list`, installs it from the Suite store
  and opens it with `flatpak run`, all through `PackageBackend`. It never writes into the deployment
  and never spawns, stops or supervises the relay. The tray app owns the relay, its store, its TLS
  pair, its console, its relay code and the fingerprint a device pins.
- The Sync tab has three honest states: not installed, with Install; installed, with the version and
  commit Flatpak reports and Open; or a problem that names why neither is possible. When Flatpak or a
  Suite remote is missing the pane says so instead of drawing a dead control. Start does not show the
  relay's address, code, fingerprint or console, because the app already does and Start would only be
  repeating a value it does not own. At startup Start removes the legacy `hub.json` an older Start
  wrote, because Canvas still reads it and a stale report would claim a relay that is not running.
- A relay may run on this machine or another. Either way Start manages no relay process, and the apps
  reach it through the address and pin entered in their own Sync dialog.
- Start is not in the data path. It returns a path or a URL and launches a separate process. It never
  proxies or parses document bytes.
- The manifest (`suite.app.json`) says what an app is. The install record (`installs.json`) is the
  only place an executable path lives. A manifest may not name a binary.
- One copy per app. A Flatpak deployment and a folder copy share a profile and its single-instance
  lock, so only one can run. When discovery finds both, the Flatpak is the app Start shows and the
  folder copy is reported as a duplicate to remove.
- Uninstalling asks Flatpak to remove the deployment; a placed folder copy is forgotten and its record
  removed. Documents are untouched, and Flatpak owns the menu entry.
- `suite://<app>/workspace/<file name>` names a file, not an id. The hub routes it; the app resolves
  it against its own folder.
- The hub is a Flatpak. It cannot replace its own running binary. **Update Start** appears only when
  the installed `run.suite.start` commit differs from the same origin's `remote-info` commit; a
  placed copy, a current build and a failed check offer no button. When it is pressed, Flatpak
  replaces the deployment and the new build starts on the next launch.
- Flatpak installs are listed, installed from the store, launched and removable through Start. Start
  asks Flatpak to install or update; it never replaces a deployment itself.
- The renderer is sandboxed: context isolation, sandbox, no `nodeIntegration`, no remote content.
- Start's Home is a Screen: the shared `suite.screen` v1 document from `@suite/screens`, opened from
  `<data>/screens/start-home.loro`. A Screen names registry ids, sizes and instance settings and
  carries no app data, HTML, script or path. The Screen is Start's own document; no app owns or reads
  it, and it is never stored inside an app document.
- Home is a role in a set of Screens, not one fixed window. `screens.json` records which Screen is
  Home; the window also holds an open Screen, so the manager can show another composition without
  changing what the next launch opens.
- The old `dashboard.json` is migrated once. Every entry is copied in order, including an id this
  build cannot resolve, and the old file is renamed to `dashboard.json.migrated-<date>` beside itself.
  A corrupt, empty or newer dashboard is refused whole with the sentence `@suite/screens` returns; the
  old file is left untouched and the default Home is shown with that sentence.
- A Screen that cannot be opened is quarantined as `<id>.loro.corrupt-<timestamp>` and the default
  Home is written in its place with a note, the way the shell handles `spaces.loro`. Screen writes are
  atomic (temporary file, then rename) and keep the previous bytes as `<id>.loro.bak`.
- Host widgets are Start's own table: `start.apps` and `start.recents` use the registry-id shape but
  not the app registry, because no app declares them and they have no capture action. An installed
  app's `suite.app.json` `widgets` field is resolved through `@suite/screens`. A registry id neither
  source knows stays in the Screen and is drawn as a named placeholder with a note; it is never
  dropped.
- Inline edit is a mode with named controls: add, remove, move and resize in the Screen's order, with
  a size picker that stays within `1x1`, `2x1` and `full`. A focused placement also answers Alt+Left
  and Alt+Right, so moving is not drag-only.
- The Screens manager is the host's, not an app's: Start lists, creates, renames, duplicates and
  deletes a Screen, sets Home and opens one. Deleting the last Screen is refused; deleting Home asks
  which other Screen becomes Home first.
- This slice does not send a widget capture to an app, export or import a portable `.screen` file, or
  sync a Screen. App widgets render the title, capture fields and settings their manifest declares,
  and the capture handoff lands with the app that receives it.
- The renderer is sandboxed: context isolation, sandbox, no `nodeIntegration`, no remote content.
- The gate is local: `pnpm check`.
