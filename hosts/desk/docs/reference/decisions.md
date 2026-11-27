# Decisions

The rules that shape the Suite host.

## The host, not a monolith

- One installed Electron app. Apps are packs, not separate runtimes. The host owns the window, the
  tab strip, the spaces, installation and updates.
- A pack is a signed bundle with a manifest, an entry and declared capabilities. The host does not
  import a pack, run its main code, or learn its domain.
- The host is not the same-process container the architecture page rejects. Every pack gets its own
  `WebContentsView`, its own custom-protocol origin and its own session partition.
- Suite Desk is the desktop host. Its catalogue, Home, Screens manager, store and update surface are
  the one desktop install path; Start was removed (#314).

## Packs are renderer-only

- No pack-supplied Node, no raw `fs`, no raw network. A pack runs in a sandboxed renderer with
  context isolation and no Node integration.
- The host exposes a narrow capability API. The spike implements `documents`, `files`,
  `identity.pack`, the `network` policy, `relay`, `recents` and `notifications`; `storage` and
  `commands` are in the shared vocabulary but are refused at discovery until their service exists.
  A manifest never widens the bridge by asking. `relay` is not a general socket: the host supervises
  the relay worker and gives a pack one pinned connection to it, and only while that relay is ready.
- `capabilities` is the required list and `optionalCapabilities` is what a pack may use when the
  host serves it. A missing required capability refuses the pack; a missing optional one degrades.
  The loaded summary carries both lists, so `packAllows` grants a served optional service while the
  pack still loads where that service is absent. Planner's `relay` is the first use: Desk syncs,
  and a host without the transport runs the same pack as a local-only planner (S4.1, S7.1).
- Browser storage is not the `storage` capability. Every pack has its own persistent session
  partition, so `localStorage` and IndexedDB are pack-local; `storage` names a host key-value service
  that this spike does not implement.
- A pack that needs background work or heavy native work waits for an OS-sandboxed service. A
  `utilityProcess` is not a sandbox; it can read anything the host can, so it is not a pack host.
- Trusted host services may use `utilityProcess`. The space-document replica, file I/O and future
  sync client are host code, not pack code.

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

## Pack identity and keys

- The device key is the host's, stored at `<dataRoot>/identity/device.json` with mode 0600. A
  missing file is a first run and gets a fresh Ed25519 seed. A malformed file is refused rather
  than replaced, because minting a new device key would silently change every pack's identity.
  The device key never crosses the pack bridge and is not a pack capability.
- `identity.pack` is derived per pack with HKDF-SHA256 from the device seed. The input keying
  material is the 32-byte seed; the salt is `suite/pack-identity/v1`; the info is
  `suite/pack-identity/v1`, a NUL, the publisher id, a NUL, the pack id; the output is 32 bytes,
  used as an Ed25519 seed. Both ids are lower-case kebab-case, so the NUL separator cannot be
  forged. The version label is part of the tuple, so a later derivation can be introduced without
  reusing today's keys.
- The tuple is **`(publisher id, pack id)`**, not the pack id alone. A container can hold the same
  public pack id under two publishers (S2.2), and those are two install identities that must not
  share a key. A publisher _key_ rotation keeps the publisher id (S2.3), so the pack key survives
  it; a migration to another publisher changes the tuple and therefore the key, which is the
  identity half of "inherits nothing".
- The pack receives the derived **public** key, its fingerprint and a host-mediated `sign` call for
  the pack's own data. The derived secret and the device key stay in the main process. That is why
  the forbidden-signature rule can be enforced rather than advised: a pack has no secret to sign
  with, and the one signing call refuses `relay-frame`, `role-record` and `membership-change`
  before it calls Ed25519. A pack key is scoped to the pack's own data (S4.7).
- The derivation is host-local today. Go's container does not derive `identity.pack` yet, so a pack
  does not yet see one identity across both hosts; that parity is the remaining gap, and S4.7 stays
  `Partial` until it lands.

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
  declared `version` is the envelope's schema version and the newest the host will open; a pack that
  writes one format under many names declares it once with `mode: "multi"` and the declaration
  applies to every name. The entry is pack code and runs in the pack's renderer; the main process
  never imports pack code and never parses the payload. The envelope's schema version records a
  completed step, so a second run writes nothing; a failed entry restores the one backup, so the old
  document stays readable. A declared projection is bound to the pack's own renderer
  (`reminderProjections.ts`); a migration entry still waits for its own write handle.
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

## The person's files and library

- The host owns where a document lives, so "show me my file" is a host action. A pack names a
  document it already owns; `documents.reveal` resolves it with `DocumentStore.locate`, and the main
  process opens the platform file manager at that absolute path. The pack receives the summary and
  never the path. A missing document returns `null` and opens nothing.
- The host records every open in a recent list at `<dataRoot>/recents.json`: one record across
  packs, keyed by `(container, publisher, pack, document)`. The host never reads the document, so a
  row is metadata: pack id, document name (the id) and the open time. A pack sees its own rows with a
  document id, and another pack's row as pack id and time only — no document id and no name — because
  S11.1 forbids one pack enumerating another's documents. The host's own launcher may still read the
  whole record. `forget` deletes the row and leaves the document.
- The recent record **survives a pack removal**. It is the person's history rather than the pack's
  data, and the publisher id is part of the key, so a later install by another publisher under the
  same pack id is a different app. Uninstalling does not silently erase where the person has been;
  they remove a row with forget, or the app records a fresh open.
- `recents` is a First use capability. The host asks once per pack version through the one consent
  surface and stores the answer in `consent.json`, not with the rows. A denial is a sentence, not an
  empty list, and it is shown on the pack's card until the person asks again there.
- The version-1 `recents.json` carried its own permission map. It is read once at startup and each
  answer is attached to the version installed today, marked `recents-v1`; a pack with no installed
  version is re-asked rather than guessed. The file is then rewritten as rows only.
- The host watches a pack's own document directory only while one of its tabs is open. It keeps a
  fingerprint per document at `<dataRoot>/library.json`, so `documents.pendingChanges` compares the
  files with what the pack last saw and reports ids, including a change made while the pack was
  closed or the host was off. The first look at a pack is a baseline, never a flood of "changed"
  rows. While a tab is open the host pushes ids on the `suite:documents:changed` event; nothing is
  delivered to a closed pack, and a pack never polls. The pack's own save is marked seen, so it is
  not reported back to the pack as an external change.
- Folder import is a host copy, not a pack read. `files.importFolder` opens a host directory picker,
  walks the choice with the archive reader's discipline (safe relative names, regular files only, no
  symlinks, bounded entry count, per-file size and total size), and only then writes into the pack's
  own `files` root under `imports/<name>`. A refused import writes nothing and removes its partial
  directory. The pack receives a relative destination and the `FileEntry` list; the source path is
  spent in the main process. A second import gets a free name, and an explicit destination that
  already exists is refused rather than merged.

## Reminders

- A reminder is host mechanism with pack meaning. The pack declares a projection in its manifest
  (`documents[].projection`) and binds that entry in its prelude; the host calls it on save and on
  open with a read-only handle, and receives display rows: id, title, body, instant and deep link.
  The pack never schedules, polls or formats a notification.
- The host owns the queue at `<dataRoot>/reminders.json` (rows only). A row carries the pack id and a
  captured-at time. The queue survives the pack closing and a host restart, and the scheduler reads
  only the rows, so nothing runs when the pack is closed.
- `notifications` is a Token capability: the scheduler asks the pack that owns the earliest row
  through the consent surface, and the grant expires after thirty days. A denial or an unsupported
  system is a sentence on Home and a refusal on the pack's card, not a silent drop; the rows stay
  queued for the person's deliberate re-ask.
- The version-1 queue carried one host-wide permission and no pack id. That answer cannot become a
  per-pack grant without re-granting to packs the person never saw, so it is not copied: each pack
  is asked at its next reminder and the consent record marks the migration unmappable.
- Rows are refreshed only on save and on open. A projection that returns invalid rows removes the
  pack's rows; a transport failure keeps the last good rows. A click focuses the host and routes the
  deep link, and the pack resolves it once it is running.
- Removing a pack's last version prunes its rows; a pack that drops `notifications` loses them too.
  Nothing outlives its pack.

## Consent

- There is one consent record, at `<dataRoot>/trust/consent.json` beside the publisher trust store,
  keyed by `(publisher, pack, version, capability)` (S4.2, S4.3). It records the tier, the reason the
  person saw, the answer and when; a denial is an entry, not an absent row. The file is the host's
  and the person's, not a pack proxy: `ConsentRecord.answersFor` returns only one publisher and
  pack, and there is no host method that hands a pack another pack's answers.
- Every capability asks through the same `askConsent` surface in the main process. The dialog names
  the pack, the capability, the tier and the reason; the record decides whether a person is asked
  at all. A remembered denial never opens the dialog again, which is what makes a pack unable to
  nag; the pack's card is the only deliberate re-ask.
- Tiers are a property of the capability, not a caller's choice. `documents`, `files`, `network` and
  `identity.pack` are install-tier: the install confirmation or the first-run review showed them, so
  they are recorded then and never asked per use. `recents` is first-use. `notifications` is a token,
  re-asked when thirty days pass. Every-use is implemented for the media capabilities the spec names,
  which this host does not serve yet.
- Keying by version is deliberate: an update that adds a capability has no answer for the new
  version and pauses on a fresh consent, while a removed capability is no longer read because the
  pack no longer declares it. Removing a pack's last version clears its rows.
- The two ad-hoc answers are migrated once, in `migrateLegacyConsentRecords`. Recents keeps a grant
  or refusal because its old key named the publisher and pack; notifications does not, because its
  old answer named no pack. Re-asking is visible, and silently copying a host-wide grant would not
  be.

## UI ownership

- The host owns the chrome: tab strip, capsule, launcher, command palette, menus, dialogs, toasts,
  notifications, status and update/permission surfaces.
- The host renders pack-declared contributions: commands, menus, toolbar items, status items,
  keybindings and widgets. Contributions are data, not DOM. The host validates and renders them.
- A pack owns only its content. It never renders into host chrome, and the host never imports pack UI.
- **One menu bar, and the host draws it.** The active pack draws no bar of its own; it publishes a
  `MenuSlots` value to `window.suite.menuBar`, and the host renders it in the tab strip's one
  physical bar. The pack keeps its own `MenuBar` only when it runs standalone. The host treats a
  slot's `id` as opaque: it draws the descriptor and echoes the id back, so it never learns what
  "explain mode" or "view" means. That is deliberate — one explain/tutorial layer that works in
  every app cannot rely on the host understanding each app's vocabulary, which is why every control
  may carry a `help` sentence in the contract.
- A `tabs` slot carries its own accessible `label` ("Open boards"), because the host cannot name a
  pack's surfaces. A row with `checked` is a `menuitemradio`, not a plain item, so the current choice
  is announced; a disabled row may carry `disabledReason` and the host shows that sentence rather
  than a silent grey control. The host still learns no vocabulary from either.
- A dropdown opens in a portal positioned from its trigger's box. The bar scrolls horizontally, so a
  menu drawn inside it would be clipped to the bar's height. Arrow keys belong to the composite that
  has focus — the tab strip, a pack's tablist, an open menu — and a plain header does not claim them;
  only a `role="menubar"` gets horizontal traversal from the bar.
- **The host bar is two thin rows.** The first is the host's: mark, open tabs, search, sync and the
  window controls. The second is the active pack's: the document's name, its takeover and its
  actions. The pack row is absent when the active surface published nothing, so Home costs one row
  and a document costs two. Both rows follow the density scale (`--control-height`) instead of a
  fixed 44px, and the renderer reports the measured total to the main process so pack views sit
  below the real bar rather than a guessed constant.
- Desk hides the native menu bar (`autoHideMenuBar`), as Planner and Budget already do. The template
  stays installed, so its accelerators (⌘W, ⌘K, ⌘S) keep working; it is no longer a third permanent
  band above the two host rows.
- A pack control may report **state as well as commands**: a toggle carries an optional `value` and
  `tone`, a row carries an optional `description`, and a `segmented` kind draws a closed set as a
  radiogroup. The host still receives values and ids only, never a pack's meaning. When the pack row
  does not fit, the host folds the controls after the first into its own `…` menu built from the same
  descriptors; the nodes stay mounted so no control is lost, and nothing is injected into host chrome.
- Theme is host state, not pack state. Suite Desk owns the preset, brightness and density on desktop
  (Suite Go owns them on mobile), stores the choice at `<dataRoot>/theme.json`, and paints every pack
  view with the resolved CSS variables plus `data-theme`, `data-theme-mode` and the `dark` class. A
  pack has no picker and no stored choice; a change repaints open views through
  `ShellWindow.setTheme` and a pack installed later starts in the same theme. The controls are in the
  **View** menu — light, dark or follow-the-system, Suite, Warm, Solarized or Catppuccin, and compact,
  cozy or comfortable — in the first-run wizard's appearance step, and in **Settings → Appearance**.
  `logseq` is kept as a stored-id alias for `warm`, so an old selection resolves to the warm palette
  rather than to a missing theme. Per-pack palettes and user-authored themes remain out of scope.
- A shared component kit is optional, not a requirement; Canvas must be able to be a canvas.
- Documents are first-class in the launcher and recents, but tabs are app sessions. The host indexes
  metadata and opens the owning pack through a deep link. Recents are local; space entries are
  shareable later.

## Spaces

- A **Space** is the user-facing grouping; it is not necessarily work. A **Container** is the local data identity; a **Session** is the local set of open windows and tabs. A domain app may still call its own document a “workspace”; the host does not.
- The space document is a Loro document owned by the host. It is the one document the host may parse.
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

- Home is a Screen named Home (`desk-home`), the host's own Loro document at
  `<dataRoot>/screens/desk-home.loro`. It is a role, not a permanent tab: launch restores the saved
  session, and the brand and `+` open it again, so closing its tab is safe. A fresh data root shows
  the first-run wizard; its last step opens Home. A Home that has never been edited is empty and
  offers the first installed app, **Create a document** and **Choose an app**; with no apps it offers
  **Install from a file…** and **Choose an app**.
- A Screen tab's context menu, also reachable with `Shift+F10`, offers **Set as Home**; the same
  action is in **Settings → Home**. Settings is host chrome, not a pack and not a Screen: it draws
  appearance, the Home choice and the catalogue, and it opens from the new-tab picker, the View
  menu's **Settings…** item, or a tab's menu. It keeps no state on the page; every control calls a
  host action and repaints from the next snapshot.
- The first-run wizard is host chrome, not a pack and not a Screen. It lists the trusted catalogue,
  selects every app by default, chooses palette, brightness and density, and installs the selected
  apps concurrently. The appearance step names each chosen app's publisher id, key fingerprint, pack
  id, version and capabilities before **Install**; that review is the install consent, so the host
  calls the same verified installer without a second per-app dialog. Completion is recorded per data
  root at `<dataRoot>/onboarding.json`; a missing, unreadable or older record repeats the wizard, and
  only a completed record reveals the chrome. A root that already has a space document or a Screen is
  an upgrade, not a first run. While the wizard is showing, no pack view is painted, even for a
  restored or deep-linked tab.
- A screen tab is host chrome. It creates no `WebContentsView`; activating one hides every pack view,
  which exposes the chrome's composition in the same content area. A pack tab hides the composition
  and shows that pack's view. Closing the last tab shows an empty state, not a second copy of the
  pack grid.
- The host widget table belongs to the host and is keyed by registry id. `desk.apps` is optional host
  chrome: it has no capture action and no app behind it, and it draws the installed-pack grid, the
  local catalogue and **Add pack…**. A new Home does not include it, and the first launch on an
  upgraded root removes the old default placement once, because the picker and the catalogue are host
  surfaces rather than a widget the person has to dismiss. A recorded migration keeps a person who
  adds it back from losing it again; it remains addable from **Edit**. Host widgets resolve before the
  pack registry, so an installed pack cannot shadow `desk.apps`.
- App widgets are declared by installed pack manifests (`widgets`) and resolved through
  `@suite/screens` as `<pack id>.<widget id>`. The host draws the declared title, fields and resolved
  settings with its own components; the pack supplies data, never DOM. An unknown registry id is a
  named placeholder with a sentence, and the placement and its saved settings stay in the document.
- A row is composition, not a page builder. A `kind: "row"` entry groups 2–8 widgets one level deep;
  each child declares a `weight` and the row has its own size class and `row` or `carousel` layout.
  The shared `screenLayout` turns the weights into shared widths on a wide window; at phone width the
  row becomes one horizontal, snapping line instead of squeezing its children. Children keep document
  order for keyboard and screen-reader users, and a host that cannot draw the row flattens it to a
  stacked list rather than dropping placements.
- Edit mode is host chrome: named buttons and named keys add, remove, move earlier/later and change
  the size, which stays exactly `1x1`, `2x1` or `full`. The renderer holds no document state; an
  action names a registry id and the main process answers with the new state. Rows are drawn in this
  slice and are not edited inline yet; their placements and saved settings survive every flat edit.
- The screen store writes a snapshot through a temporary file and rename, keeps the previous good
  snapshot as `<id>.loro.bak`, and quarantines an unreadable, oversized or newer file as
  `<id>.loro.corrupt-<time>` before starting a fresh Home. It never deletes the only copy and never
  guesses at a newer shape.
- Capture delivery is not in this slice. An app widget says a capture is not available yet rather
  than offering a button that cannot work. The registry's capture build stays unused until the
  delivery path exists.
- A Screen is portable as a `.screen` file the person owns: a Loro snapshot in a small envelope with
  the magic `SUITE-SCREEN`, a separate envelope version, and a canonical JSON header that names the
  Screen `version`, `id`, `name`, whether it was Home, and the payload length. The extension is
  `.screen` and the media type is `application/vnd.suite.screen`. Export from the Screens manager
  writes a temporary sibling and renames it into the path the person chose.
- Import reads and validates before it writes. It refuses a file that is not a Suite screen, an
  envelope or Screen version newer than this build, a header that does not match its bytes, a shape
  with an unknown size, a bad widget id, a duplicate placement or more than 64 placements. The
  refusal is a sentence that names the next action, and the existing Screens and Home choice are
  untouched. A valid import always creates a new Screen; a colliding id gets a new one rather than
  replacing it, and a file that was Home on the writer's device becomes Home here. Unknown widget ids
  and settings remain as named placeholders, so a round trip restores order, size, settings and Home.
- Sync is still later (#199). A `.screen` file is a manual copy; the host has no Screen sync
  transport, and a pack never reads or writes a Screen document.

## The chrome is React, one island at a time

- `shell.js` stays the page while the shared chrome moves into React one piece at a time. The tab
  strip is the first island; the Screens, catalogue, command surface and sync panel remain vanilla
  until each is ported.
- The island is built by `vite.island.config.ts` into `dist/renderer/tab-bar.js` and `tab-bar.css`,
  and imports `@suite/ui` at build time. The page still runs from `suite-chrome://` under
  `script-src 'self'`, so nothing is fetched and no new origin exists.
- Host state stays in `shell.js`. React receives a snapshot (`tabs`, `activeTabId`, sync state) and
  returns callbacks; it never holds a tab list, a document or a host service.
- Tailwind is compiled for the island only, without preflight, so the legacy page's base styles are
  untouched. The end state is one React renderer; the vanilla page is deleted when the last surface
  moves, not kept as a second architecture.

## Channels

- Suite Desk is a superapp, so it carries one channel for the whole product. Stable is `run.suite.desk` on
  `master`. Each pre-release channel has its own id — `run.suite.slop.desk`, `run.suite.nightly.desk`
  or `run.suite.preview.desk` — on the branch of the same name; the display name, desktop entry,
  metainfo, icon and launcher follow the id.
- Every channel is its own install. Stable, slop, nightly and preview sit side by side; nightly and
  preview moved from the shared `run.suite.slop.desk` id, so an older nightly or preview install
  reinstalls once under the new id without migrating its data.
- The pre-release keeps the stable sandbox grants and is isolated by its id, not by a Documents
  folder. Its data root is that channel's sandbox — `~/.var/app/run.suite.nightly.desk/config/Suite Desk/desk`
  for nightly — so its `packs/` installs and `spaces.loro` cannot collide with stable's
  `~/.var/app/run.suite.desk/config/Suite Desk/desk` or with another channel's. The host has no
  `Documents/Suite` grant to split, and a pre-release must not gain a `Documents/Suite Slop` folder.
- A channel is a distribution fact, not a pack fact. A pack carries a signed version and no channel,
  and the host's signed pack loader is unchanged.

## Updates, signing and installation

- The host owns its update path. A pack has no IPC to the updater, installer or uninstaller.
- Signed packs are the load path. A `.suitepack` archive carries a signed `manifest.json` and the files
  it lists. The host resolves the manifest's `publisher.key` against its local trust store, verifies
  the signature with that key, and verifies every file hash; it refuses duplicate entries, extra files
  and paths that leave the pack root before it extracts anything. Only verified installs load in a
  packaged build.
- The trust store is `<dataRoot>/trust/publishers.json` (`SUITE_DESK_TRUST` moves it). It is created
  with the first-party Suite key preinstalled, and that pin wins over an edited file. A person adds
  another key only after seeing its fingerprint; the install refusal shows the fingerprint, and the
  unknown-publisher dialog adds the key only from that display. A malformed store is ignored rather
  than guessed at, so it trusts the first-party key and nothing else.
- Install and update — and the first-run review — show the publisher id, key fingerprint, pack id,
  version and capability list before anything is written, and the result notice repeats them.
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
  consults it: an installed pack keeps running until the person disables or removes it. The
  catalogue operator key is now pinned for the index, but a catalogue-issued advisory still has no
  verification path of its own and is refused.
- The catalogue has two sources. The local directory is `.suitepack` files, `<dataRoot>/catalogue` by
  default and `SUITE_DESK_CATALOGUE` when set; a person may install from a file with no index and no
  network. The published index is `https://flatpak.suite.run/index.json` by default and
  `SUITE_DESK_INDEX` when set (or `none` for the local directory only). Its operator key is a
  compile-time constant in `packages/pack/src/pinnedKey.ts`, imported by both hosts and never a
  value the index supplies. The host
  fetches and verifies the index before listing an entry, refuses a lower `sequence`, a `previous`
  that does not name the last verified head, and an `expires` in the past, and records that head in
  `<dataRoot>/trust/index-head.json`. A refused or unreachable index leaves the local directory
  usable and the catalogue names the source in use instead of falling back silently.
  Every archive is read and verified before it is listed; a refused
  archive still lists with its refusal sentence and can never be installed. Listing extracts nothing.
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
  `window.suite.launch()` and receives `{ kind: "document", documentId }`, `{ kind: "create" }`,
  `{ kind: "launcher" }` or `{ kind: "deep-link", url }`; it never parses a launch out of a URL and
  never names another tab. A pack with documents is never opened on a start page: an ordinary open
  resolves to the most recent document, then any document, then a new one. The pack's own launcher
  pages and prompts were removed; the host picker owns that choice.
- Unsigned directory packs are an explicit development path: `SUITE_DESK_DEV_PACKS=1` in an
  unpackaged checkout. The switch is ignored in a packaged build. In that mode a development pack wins
  a collision with an installed pack of the same id, because the person is iterating on the directory;
  the installed copy stays on disk.
- Packs update independently of the host. A pack contract carries `contractVersion` and
  `minimumHostVersion` so an old host refuses a pack it cannot run rather than crashing.

## Sync and collaboration

- Sync stays a separate relay and service. The host does not become the relay.
- The host supervises the relay as a worker thread (`relaySupervisor.ts`). It starts the relay's
  worker entry in this process with its own store and a whitelisted environment, waits for one JSON
  readiness line before it reports sync as available, applies a bounded restart policy, and sends
  `stop` before it exits. The worker closes its listener, console and store before it exits. A crash
  is shown on the Sync surface, not swallowed, and a successful restart keeps the crash sentence
  visible.
- The relay starts without a `documents` grant. The only path it receives is its own store;
  the relay's argument parser refuses a document, file, workspace or data-root argument by name, and
  the supervisor's environment is a whitelist rather than the host's whole environment.
- The relay is a `worker_threads` thread, not a second copy of the host's executable. Under Flatpak
  the Electron binary is zypak-wrapped, and a child launched with `ELECTRON_RUN_AS_NODE=1` aborts in
  zypak when the whitelisted environment has no session bus; the packaged host also fuses
  `runAsNode` off. A thread is Node code in this process, so it never launches Electron.
- The pack-facing service is `relayAdapter.ts`: `connect({ url, certificateSha256 })` opens a
  pinned socket only to this host's relay, returns a tab-scoped connection and forwards opaque bytes.
  The host never parses a frame, and a token from one tab cannot be spent by another.
- The host's space-document key is the host's own. It never holds an app document key.
- The order is: local space document first, then personal multi-device sync of structure, then
  shared spaces with presence and follow. Shared control is not planned.
- A shared space is the unit. Containers and other spaces stay private. Documents are shared by their
  apps, not by the host; the host shows shared/not-shared state and deep-links to the app's
  share UI.
- Presence is ephemeral. Authority is signed membership and roles, not a CRDT field. A CRDT-based ACL
  is a vulnerability.
- Collaboration is shared context, not remote control. Follow is a local action; a collaborator
  cannot move another person's windows or launch apps.

## What this spike deliberately leaves out

- app-widget capture delivery (app widgets render; captures are not sent);
- Screen sync across devices (#199; a portable `.screen` file is manual);
- per-document keys, relay frame verification, the header index and gap recovery (S7.2–S7.6, #304);
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
