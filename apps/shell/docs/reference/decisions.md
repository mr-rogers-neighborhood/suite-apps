# Decisions

The rules that shape the Suite host.

## The host, not a monolith

- One installed Electron app. Apps are packs, not separate runtimes. The shell owns the window, the
  tab strip, the spaces, installation and updates.
- A pack is a signed bundle with a manifest, an entry and declared capabilities. The host does not
  import a pack, run its main code, or learn its domain.
- The host is not the same-process container the architecture page rejects. Every pack gets its own
  `WebContentsView`, its own custom-protocol origin and its own session partition.
- Start is not a separate process in this model. The shell's launcher, store and update surface
  replace Start's role. Until the migration is proven, Start remains the shipping hub.

## Packs are renderer-only

- No pack-supplied Node, no raw `fs`, no raw network. A pack runs in a sandboxed renderer with
  context isolation and no Node integration.
- The host exposes a narrow capability API. The spike implements `documents`, `files` and the
  `network` policy; `storage`, `recents`, `notifications`, `relay` and `commands` are in the shared
  vocabulary but are refused at discovery until their service exists. A manifest never widens the
  bridge by asking.
- Browser storage is not the `storage` capability. Every pack has its own persistent session
  partition, so `localStorage` and IndexedDB are pack-local; `storage` names a host key-value service
  that this spike does not implement.
- A pack that needs background work or heavy native work waits for an OS-sandboxed service. A
  `utilityProcess` is not a sandbox; it can read anything the shell can, so it is not a pack host.
- Trusted shell services may use `utilityProcess`. The space-document replica, file I/O and future
  sync client are shell code, not pack code.

## Identity, origin and session

- A pack's origin is `suite-pack://<container-id>.<pack-id>/`; its session is
  `persist:<container-id>:<pack-id>`. The two travel together. A pack that loads from another origin
  is a bug. V1 uses the `default` container; its id is in the path, origin and partition from day
  one so adding containers is a UI change, not a storage migration.
- The custom protocol is registered on the pack's own session. Registering it only on the default
  session leaves a partitioned pack with no handler.
- The host derives the pack id from the sender's `webContents`, never from a request field. A
  renderer with no mapping gets nothing.
- Navigation is limited to the pack's own origin. Window opens are denied; an http(s) link goes to
  the OS browser.
- Permissions are denied wholesale. Network is denied unless the manifest declares it; a
  network-capable pack may reach HTTPS and WSS only. Downloads are denied; a pack that needs to
  export a file waits for the host's file service.

## Documents and files

- The host carries bytes plus a document name or a relative file path. It never parses a `.canvas`,
  `.planner`, `.budget` or pack document.
- The `files` capability is a scoped filesystem: relative paths inside the pack's root, host-owned
  atomic writes, backups and locks; absolute paths, `..`, symlinks and non-regular files refused.
  Each `(container, pack)` gets one `PackFileStore`, opened lazily under
  `files/<container>/<pack>` in the host data root and never inside the pack's code directory.
  The lock owner is the tab id, so destroying a view releases the locks it held.
- External files are still a design, not a bridge: a user-consented host handle with open-in-place
  or import, so a pack never learns an absolute path.
- A document id is a file name inside the sender's pack root, never a path. Slashes, `..`, absolute
  paths and control characters are refused before the filesystem is reached. A files path is
  relative and slash-separated; the same refusals apply before `realpath` and `lstat`.
- Writes are atomic: a temporary file in the same root, then a rename. Backups and temp files live
  under the same pack root.
- `documents` and `files` are separate services with separate roots and capabilities. A pack cannot
  list, open, save, read or remove another pack's documents or files, even if it knows the name.

## UI ownership

- The shell owns the chrome: tab strip, capsule, launcher, command palette, menus, dialogs, toasts,
  notifications, status and update/permission surfaces.
- The shell renders pack-declared contributions: commands, menus, toolbar items, status items,
  keybindings and widgets. Contributions are data, not DOM. The host validates and renders them.
- A pack owns only its content. It never renders into host chrome, and the host never imports pack UI.
- Theme tokens are host-provided. A shared component kit is optional, not a requirement; Canvas must
  be able to be a canvas.
- Documents are first-class in the launcher and recents, but tabs are app sessions. The shell indexes
  metadata and opens the owning pack through a deep link. Recents are local; space entries are
  shareable later.

## Spaces

- A **Space** is the user-facing grouping; it is not necessarily work. A **Container** is the local data identity; a **Session** is the local set of open windows and tabs. A domain app may still call its own document a “workspace”; the shell does not.
- The space document is a Loro document owned by the shell. It is the one document the host may parse.
- Its shape is container-ready: a tab carries a `spaceId`, and the document carries a default space.
  V1 exposes one default container and flat tabs; adding containers and saved spaces is a UI change,
  not a data migration.
- The space document stores structure, not document content: containers, spaces, groups, entries, pins,
  labels and ordering. No paths, commands, URLs to open, or executable actions.
- Open tabs, window bounds and focus are local session state. They must not sync to another device.
- The launcher's recents are local. A shared space later carries entries, not what you viewed.

## Updates, signing and installation

- The shell owns its update path. A pack has no IPC to the updater or installer.
- Signed packs are the load path. A `.suitepack` archive carries a signed `manifest.json` and the files
  it lists. The host verifies the manifest signature and every file hash against the pinned key, and
  refuses duplicate entries, extra files and paths that leave the pack root, before it extracts
  anything. Only verified installs load in a packaged build.
- An install is `<dataRoot>/packs/<id>/<version>/`, written to a temporary sibling and renamed into
  place. An existing version is refused, not overwritten; installs are additive, so an older version
  stays available when a newer archive fails verification.
- Installation is user-initiated and host-only: the chrome bridge opens the file picker and the pack
  bridge has no installer channel. A new app opens immediately after install. A tab already open keeps
  its loaded view; running a replaced version of that pack needs a restart, because the session's
  protocol handler is bound when its first view loads.
- Unsigned directory packs are an explicit development path: `SUITE_SHELL_DEV_PACKS=1` in an
  unpackaged checkout. The switch is ignored in a packaged build. In that mode a development pack wins
  a collision with an installed pack of the same id, because the person is iterating on the directory;
  the installed copy stays on disk.
- Packs update independently of the shell. A pack contract carries `contractVersion` and
  `minimumHostVersion` so an old host refuses a pack it cannot run rather than crashing.

## Sync and collaboration

- Sync stays a separate relay and service. The shell does not become the relay.
- The shell's space-document key is the shell's own. It never holds an app document key.
- The order is: local space document first, then personal multi-device sync of structure, then
  shared spaces with presence and follow. Shared control is not planned.
- A shared space is the unit. Containers and other spaces stay private. Documents are shared by their
  apps, not by the shell; the shell shows shared/not-shared state and deep-links to the app's
  share UI.
- Presence is ephemeral. Authority is signed membership and roles, not a CRDT field. A CRDT-based ACL
  is a vulnerability.
- Collaboration is shared context, not remote control. Follow is a local action; a collaborator
  cannot move another person's windows or launch apps.

## What this spike deliberately leaves out

- a remote pack index, pack updates and uninstall UI;
- external file handles: the picker, open-in-place and import;
- the host's blind relay transport for pack sync;
- a user-visible space document file, export and backup;
- document-first launcher entries, recents and cross-app search;
- tab tear-off and split view;
- host-rendered contributions;
- containers and saved spaces in the UI;
- space-document sync and shared spaces;
- Windows and macOS packaging;
- a per-pack OS sandbox.

Each of those is a later gate. The README states what works today, and the cross-app decision record
states the direction.
