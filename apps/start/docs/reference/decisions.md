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
- Start manages the Suite Sync service; it is not a server. Start locates `suite-sync` (an explicit
  `SUITE_SYNC_BIN`, a bundled copy, then `PATH`), starts and stops it, and reports its address, store
  and fingerprint. It makes and keeps the relay's TLS pair under the store's `tls/` directory, mode
  0600, reuses it, and refuses a half pair rather than rotating the fingerprint. Loopback serves
  `ws://`; the network scope serves `wss://` with that pair. The relay owns its frames and role
  records; Start keeps no listener and no frame store. When there is no binary the Sync pane says
  what to install instead of showing a dead control.
- The Sync tab opens the relay's console: a separate loopback-only listener with a token generated at
  startup. The console and its relay code read metadata, never frames; a code carries the address,
  pin and a live invitation when one exists, while Start's own code carries the address and pin. A
  friend-code or contacts exchange lives in the apps, not in the hub or the relay.
- A relay may run on another machine. Start then manages none, and the apps reach that relay through
  the address entered in their Sync dialog; the local Sync pane describes only a relay Start started.
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
