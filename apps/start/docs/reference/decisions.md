# Decisions

The rules that shape Start.

- Every package operation crosses one `PackageBackend`: list installed apps (AppImage records and
  Flatpak deployments, with ownership and channel), install, update, remove and launch, plus the
  record operations the window needs. The renderer and the catalogue consume its data only; the
  native backend is the one module that spawns `flatpak` or writes a managed AppImage. A Flatpak
  Start runs behind the same seam: it prefixes a command with `flatpak-spawn --host`, using the
  `org.freedesktop.Flatpak` session helper. That grant is effectively host command execution, and it
  is why the hub can manage Flatpaks from a sandbox. A D-Bus host agent remains the alternative if
  the permission set grows, and the window never learns a second way.
- An install record and an install request carry a release `channel`: stable, or a pre-release tier.
  The record is written at install time, so a pre-release keeps its identity even when its manifest
  predates the field.
- Stable and a pre-release are two cards because they are two ids: `run.suite.<app>` and
  `run.suite.slop.<app>` (`slop-<app>` for an AppImage manifest; the older `slop.<app>` id is still
  read). The card says its tier in text — `slop`, `canary` or `beta` — and names the risk and removal
  path; a colour is never the only signal.
- One pre-release id means one pre-release install. Every tier shares it, and the Flatpak ref branch
  names the tier. Start refuses to install a second branch; the card offers a switch, which keeps the
  install and the one pre-release data folder (`~/Documents/Suite Slop/<App>`).
- Removing a pre-release asks separately whether to delete that channel's data. Removing stable never
  touches channel data.
- One writer per binary. Start updates, rolls back and removes only a copy it installed, and does not
  update a copy a person placed. A Flatpak is Flatpak's to update: a pre-release Flatpak never offers
  an AppImage-style update.
- Start manages the Suite Sync service; it is not a server. Start locates `suite-sync` (an explicit
  `SUITE_SYNC_BIN`, a bundled copy, then `PATH`), starts and stops it, and reports its address and
  store. The relay owns its frames and role records; Start keeps no listener and no frame store.
  When there is no binary the Sync pane says what to install instead of showing a dead control.
- A relay may run on another machine. Start then manages none, and the apps reach that relay through
  the address entered in their Sync dialog; the local Sync pane describes only a relay Start started.
- Start is not in the data path. It returns a path or a URL and launches a separate process. It never
  proxies or parses document bytes.
- The manifest (`suite.app.json`) says what an app is. The install record (`installs.json`) is the
  only place an executable path lives. A manifest may not name a binary.
- One copy per app. Two copies share a profile and its single-instance lock, so only one can run. When
  discovery finds both an AppImage and a Flatpak deployment, the Flatpak is the app Start shows and
  the AppImage is reported as a duplicate to remove. Choosing between them in the hub is not built.
- Uninstalling an app removes versions, menu entry, icon and record. Documents are untouched.
- `suite://<app>/workspace/<file name>` names a file, not an id. The hub routes it; the app resolves
  it against its own folder.
- The hub is packaged in every form. An AppImage or Arch hub cannot replace its own running binary;
  its row links to the release page or names the package manager. A Flatpak hub's row says `Flatpak`
  and offers **Update Start** through Flatpak; the new build starts on the next launch.
- Flatpak installs are listed, installed from the store, launched and removable through Start. Start
  asks Flatpak to install or update; it never replaces a deployment itself.
- The renderer is sandboxed: context isolation, sandbox, no `nodeIntegration`, no remote content.
- The gate is local: `pnpm check`.
