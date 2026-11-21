# Decisions

The rules that shape Start.

- One writer per binary. Start updates, rolls back and removes only a copy it installed. A copy a
  person placed manages itself.
- Start manages the Suite Sync service; it is not a server. Start locates `suite-sync` (an explicit
  `SUITE_SYNC_BIN`, a bundled copy, then `PATH`), starts and stops it, and reports its address and
  store. The relay owns its frames and role records; Start keeps no listener and no frame store.
  When there is no binary the Sync pane says what to install instead of showing a dead control.
- A relay may run on another machine. Start then manages none, and the apps reach that relay through
  `SUITE_SYNC_URL`; the local Sync pane describes only a relay Start started.
- Start is not in the data path. It returns a path or a URL and launches a separate process. It never
  proxies or parses document bytes.
- The manifest (`suite.app.json`) says what an app is. The install record (`installs.json`) is the
  only place an executable path lives. A manifest may not name a binary.
- One copy per app. Two copies share a profile and its single-instance lock, so only one can run.
- Uninstalling an app removes versions, menu entry, icon and record. Documents are untouched.
- `suite://<app>/workspace/<file name>` names a file, not an id. The hub routes it; the app resolves
  it against its own folder.
- The hub is packaged and does not update itself. Its own row links to the release page.
- Flatpak installs are listed, installed from the store, launched and removable through Start. Start
  asks Flatpak to install or update; it never replaces a deployment itself.
- The renderer is sandboxed: context isolation, sandbox, no `nodeIntegration`, no remote content.
- The gate is local: `pnpm check`.
