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
- External files are a user-consented host handle. The person picks in a host-owned platform dialog;
  the main process keeps the absolute path and the pack gets an opaque token plus
  `{ name, size, mtimeMs }`. Filters are data (a display name and bare lower-case extensions), never
  a path or a glob. A token is scoped to the sender's `(container, pack, tab)` and is released when
  the view is destroyed, crashes or is replaced. `pickOpen`/`pickSave` return `null` on cancellation.
  `pickSave` does not truncate until the pack writes; a write is a temporary sibling renamed over the
  destination, so a failure leaves the previous file in place. `importFile` copies into the pack's
  own `files` root and returns a relative `FileEntry`, never an external path.
- A document id is a file name inside the sender's pack root, never a path. Slashes, `..`, absolute
  paths and control characters are refused before the filesystem is reached. A files path is
  relative and slash-separated; the same refusals apply before `realpath` and `lstat`.
- The host document service writes an envelope: magic and envelope version, then a canonical JSON
  header (publisher, pack, document, schema, payload length, payload checksum), then the pack's
  payload bytes. The host reads the header and checks the payload hash; it never interprets the
  payload. A rewrite copies the payload byte for byte, so a field the pack added survives.
- The host owns durability for documents as it does for files: one write at a time per document, a
  flushed temporary file renamed into place, the previous copy as `<name>.bak`, crash recovery from
  that copy, and a `.corrupt-<timestamp>` quarantine for a file that does not verify. A newer
  envelope or schema is refused with a sentence and the file's path in the data root, never replaced
  by a fresh document and never rewritten by an older build.
- A pack declares its documents, migration chain and projection in the manifest. The host finds the
  declaration by id, proves one chain to the declared version before it writes, takes one `.bak` of
  the whole document, and invokes each declared entry with a handle scoped to that document. The
  entry is pack code and runs in the pack's renderer; the main process never imports pack code and
  never parses the payload. The envelope's schema version records a completed step, so a second run
  writes nothing; a failed entry restores the one backup, so the old document stays readable. The
  runner is injected, so binding it to a pack renderer is the remaining seam.
- A pack's blobs are three content-addressed class stores under
  `blobs/<container>/<pack>/<class>/<sha256>`; see
  [Blobs and export](../../../docs/reference/decisions.md#blobs-and-export). `blobs.ts` re-hashes a
  blob on read, refuses a mismatch and clears only `cache`. `exportBundle.ts` runs the declared
  `export` entry with a save handle that cannot leave the bundle or write the host's `manifest.json`
  or `assets/`, then writes every asset as original bytes with a verified manifest entry.
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
- A stored tab is a discriminated union of a **pack** tab and a **screen** tab. The document is at
  `shell.version = 2`; a version-1 tab has no `kind` and reads as a pack tab. Old tabs are not dropped
  or rewritten on read. A screen tab is host chrome and renders a Screen; it creates no pack view.
- The space document stores structure, not document content: containers, spaces, groups, entries, pins,
  labels and ordering. No paths, commands, URLs to open, or executable actions.
- Open tabs, window bounds and focus are local session state. They must not sync to another device.
- The launcher's recents are local. A shared space later carries entries, not what you viewed.

## Home and Screens

- Home is a Screen named Home (`shell-home`), the shell's own Loro document at
  `<dataRoot>/screens/shell-home.loro`. It is created and opened before any pack view exists, first in
  the tab strip, and active on a first run. The brand and `+` open it again, so closing its tab is
  safe. A restored session keeps its own active tab and gains Home at the front.
- A screen tab is host chrome. It creates no `WebContentsView`; activating one hides every pack view,
  which exposes the chrome's composition in the same content area. A pack tab hides the composition
  and shows that pack's view. Closing the last tab shows an empty state, not a second copy of the
  pack grid.
- The host widget table belongs to the shell and is keyed by registry id. `shell.apps` is host chrome:
  it has no capture action and no app behind it, and it draws the installed-pack grid, the local
  catalogue and **Add pack…**. Host widgets resolve before the pack registry, so an installed pack
  cannot shadow `shell.apps`.
- App widgets are declared by installed pack manifests (`widgets`) and resolved through
  `@suite/screens` as `<pack id>.<widget id>`. The host draws the declared title, fields and resolved
  settings with its own components; the pack supplies data, never DOM. An unknown registry id is a
  named placeholder with a sentence, and the placement and its saved settings stay in the document.
- Edit mode is host chrome: named buttons and named keys add, remove, move earlier/later and change
  the size, which stays exactly `1x1`, `2x1` or `full`. The renderer holds no document state; an
  action names a registry id and the main process answers with the new state.
- The screen store writes a snapshot through a temporary file and rename, keeps the previous good
  snapshot as `<id>.loro.bak`, and quarantines an unreadable, oversized or newer file as
  `<id>.loro.corrupt-<time>` before starting a fresh Home. It never deletes the only copy and never
  guesses at a newer shape.
- Capture delivery is not in this slice. An app widget says a capture is not available yet rather
  than offering a button that cannot work. The registry's capture build stays unused until the
  delivery path exists.
- A Screen is local to this device. The Screens manager, a portable `.screen` file, export/import
  and sync are later slices.

## Channels

- Shell is a superapp, so it carries one channel for the whole product. Stable is `run.suite.shell` on
  `master`. One pre-release id, `run.suite.slop.shell`, carries `slop`, `nightly` and `preview` on
  branches of the same names; the display name, desktop entry, metainfo, icon and launcher follow the
  pre-release id.
- One pre-release install at a time. Moving from `slop` to `nightly` replaces the pre-release rather
  than adding a third install. Stable and one pre-release are two ids and can be installed side by
  side.
- The pre-release keeps the stable sandbox grants and is isolated by its id, not by a Documents
  folder. Its data root is `~/.var/app/run.suite.slop.shell/config/Suite/shell`, so its `packs/`
  installs and `spaces.loro` cannot collide with stable's
  `~/.var/app/run.suite.shell/config/Suite/shell`. The shell has no `Documents/Suite` grant to split,
  and the pre-release must not gain a `Documents/Suite Slop` folder.
- A channel is a distribution fact, not a pack fact. A pack carries a signed version and no channel,
  and the shell's signed pack loader is unchanged.

## Updates, signing and installation

- The shell owns its update path. A pack has no IPC to the updater, installer or uninstaller.
- Signed packs are the load path. A `.suitepack` archive carries a signed `manifest.json` and the files
  it lists. The host resolves the manifest's `publisher.key` against its local trust store, verifies
  the signature with that key, and verifies every file hash; it refuses duplicate entries, extra files
  and paths that leave the pack root before it extracts anything. Only verified installs load in a
  packaged build.
- The trust store is `<dataRoot>/trust/publishers.json` (`SUITE_SHELL_TRUST` moves it). It is created
  with the first-party Suite key preinstalled, and that pin wins over an edited file. A person adds
  another key only after seeing its fingerprint; the install refusal shows the fingerprint, and the
  unknown-publisher dialog adds the key only from that display. A malformed store is ignored rather
  than guessed at, so it trusts the first-party key and nothing else.
- Install and update show the publisher id, key fingerprint, pack id, version and capability list
  before anything is written, and the result notice repeats them.
- The install identity is `(publisher id, pack id)`. The active publisher is recorded beside the
  version directories. A different publisher under an existing id is refused without the explicit
  migration. A different key under the same id is refused unless a rotation statement retired the
  old key: the statement is signed by the outgoing key, carries the same publisher id, the new key
  and a strictly increasing sequence, and the store is written only after the person confirms the
  new fingerprint. The retired key still verifies installed versions; the current key is required
  for a new install. A migration inherits no documents, files, session storage or grants: documents,
  files and the renderer partition are keyed by both ids. The first-party publisher keeps its
  pre-S2.1 storage paths so an existing install is not moved.
- A revocation is a signed advisory for one `(publisher, pack)`, delivered as a local file. The
  publisher that owns the pack may issue it with the key that signed the pack (current or retired);
  another publisher may not. The person may record an unsigned local advisory. A recorded advisory
  refuses a new install and marks the catalogue entry refused, but the installed-version scan never
  consults it: an installed pack keeps running until the person disables or removes it. A catalogue
  operator issuer is deferred until the shell pins operator keys from the signed index.
- The local catalogue is a directory of `.suitepack` files, `<dataRoot>/catalogue` by default and
  `SUITE_SHELL_CATALOGUE` when set. Every archive is read and verified before it is listed; a refused
  archive still lists with its refusal sentence and can never be installed. Listing extracts nothing.
  A remote index is a later slice with the same trust decision.
- An install is `<dataRoot>/packs/<id>/<version>/`, written to a temporary sibling and renamed into
  place. An existing version is refused, not overwritten; installs are additive, so an older version
  stays available when a newer archive fails verification.
- An update is installing a newer version for the same id and publisher. The loader selects the
  highest valid version for the active publisher. The newer directory is additive; the old one is not
  deleted silently. The launcher offers an explicit remove action for each non-current version.
- Uninstall removes exactly `<dataRoot>/packs/<id>/<version>/`. A symlinked install root, id
  directory or version directory is refused, the version must resolve inside the real pack root, and
  the path is checked before removal. A pack's documents and files live outside that root and are
  never removed. If a tab for that pack is open, the host closes it first and says so; a view is
  bound to the version that loaded it, so the host does not assume an open tab matches the selected
  version.
- Installation is user-initiated and host-only: the chrome bridge opens the file picker or installs a
  catalogue entry, and the pack bridge has no installer or lifecycle channel. A new app opens
  immediately after install. A tab already open keeps its loaded view; running a replaced version of
  that pack needs a restart, because the session's protocol handler is bound when its first view
  loads.

## Routing and launch

- The host claims `suite://` and parses `suite://<pack-id>/<path>` in one pure function. A malformed
  id, an unknown or uninstalled pack, and a pack with no entry are refused. A link never installs or
  updates.
- The single-instance lock keeps one host. Linux and Windows route the link from the second
  instance's argv; macOS routes `open-url`, holding a link that arrives before the window exists.
- A link opens or focuses the pack's tab and loads the pack's current installed entry. The chrome's
  own link opening is unchanged, and a pack still needs `network` to hand a link to the OS browser.
- The host stores a launch context per tab and derives the tab from the sender. A pack calls
  `window.suite.launch()` and receives `{ kind: "launcher" }` for an ordinary open or
  `{ kind: "deep-link", url }` for a link; it never parses a launch out of a URL and never names
  another tab.
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

- a remote pack index (the catalogue is a local directory);
- app-widget capture delivery (app widgets render; captures are not sent);
- the Screens manager and a portable `.screen` file with export/import;
- the host's blind relay transport for pack sync;
- a user-visible space document file, export and backup;
- document-first launcher entries, recents and cross-app search;
- tab tear-off and split view;
- host-rendered pack contributions beyond widgets;
- containers and saved spaces in the UI;
- space-document sync and shared spaces;
- Windows and macOS packaging;
- a per-pack OS sandbox.

Each of those is a later gate. The README states what works today, and the cross-app decision record
states the direction.
