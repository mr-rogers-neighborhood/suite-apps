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
  read. The card says its tier in text — `slop`, `canary` or `beta` — and names the risk and removal
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
  repeating a value it does not own.
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
- The gate is local: `pnpm check`.
