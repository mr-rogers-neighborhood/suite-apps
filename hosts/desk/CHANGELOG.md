# Changelog

Written for people, not commits. This app is a spike; its version is its own until it becomes the
shipped host.

## [0.5.0] - 2026-11-27

### Release

- **Screens are a grid you can edit.** A Screen is four cells wide. Drag a tile by its handle, resize
  it from the corner, pick a size class (`1×1`, `1×2`, `2×1`, `2×2`, full row), and remove it with one
  confirmation. The widget browser has a search field and names each widget's source and default size.
  On a narrow window the grid returns to one column and the editing handles hide.
- **The chrome is one host-drawn bar.** Desk draws the menu bar from the pack's own slots instead of
  each pack drawing a second band. A crowded pack row folds into the host's `…` menu, and Help stops
  drawing a header when a host is already drawing one.
- **The first run is a wizard, not a default tab.** Choose apps, palette, brightness and density, watch
  the selected apps install concurrently, and land on an empty Home.
- **The pack library is one grid.** Installed packs come first, each id appears once at its highest
  version, and an installed pack offers an update only when a newer trusted version is available on
  this host.
- **Suite Go stays at 0.2.0 (versionCode 3);** this release does not bump it.

### Added

- **A new tab asks two questions.** First the surface — Recents, Packs, Screens, Open a file…,
  Settings — then the document inside it, with **New \<noun\>** where a pack declares one.
- **Settings, a tab menu and the pack rail.** A pack's page shows its mark, description and one
  primary action; publisher, key, capabilities and signature sit behind **More details**.
- **Bar descriptors.** A control can report its value and tone, a refused control says why, and a
  closed set of choices draws as a real radiogroup.
- **Theme choices.** Catppuccin joins the palette set, Suite and Warm are separate, and density
  reaches the hosts and the packs.

### Changed

- **Screen documents are schema v3.** Every placement carries `x` and `y`; the size class remains the
  single source of width and height. A v2 document migrates in place, packing its entries in order
  into the first free cells without dropping one.
- **The catalogue is declarative.** A pack publishes its card, descriptor and slots; the host draws
  them, and a publish that does not parse is dropped at the boundary rather than half-drawn.

### Fixed

- **The bar's keyboard order.** A checked menu row takes focus, tabs and the dropdown complete with
  arrows, Home and End, and a control's help text reaches menu rows, tabs and buttons.
- **The widget grid.** A tile cannot run past the fourth column, a row keeps at least two items, and
  Backspace no longer removes a widget.

## [0.4.0] - 2026-11-25

### Release

- **Suite Desk is the name.** Product, package, directory, Flatpak ids, gate row, window and install
  names, and docs are Desk. Stable is `run.suite.desk`; the pre-release ids are
  `run.suite.<channel>.desk` for `slop`, `nightly` and `preview`.
- **Fresh start.** The new id starts with an empty data root; the old `run.suite.shell` install and
  data are not migrated. The old releases and refs are being retired deliberately.
- **The four packs are mobile-ready.** Canvas, Planner, Budget and Help declare desktop and mobile,
  carry card sidecars beside their archives and are in the catalogue index. Suite Go stays at 0.2.0
  (versionCode 3); this release does not bump it.

### Changed

- **The host is Suite Desk all the way down.** The product name from #335 now reaches the identity:
  the package is `@suite/desk`, the directory is `hosts/desk`, the Flatpak is `run.suite.desk`, and
  the pre-release ids are `run.suite.slop.desk`, `run.suite.nightly.desk` and
  `run.suite.preview.desk`. The environment is `SUITE_DESK_*`, the gate row is `desk`, and release
  artifacts are `suite-desk-*`. This is a deliberate breaking rename.
- **The new id starts with a fresh data root.** `run.suite.desk` is a new application identity, not
  an update of `run.suite.shell`. There is no migration: an old `~/.var/app/run.suite.shell` install
  and its data are ignored and may be removed by the owner. Stable, slop, nightly and preview keep
  their separate data roots under their own `.desk` ids.

## [0.3.0] - 2026-11-24

### Added

- **The host owns the theme.** One choice covers the host and every pack, and the per-app pickers
  are gone. Help and Canvas keep a readable fallback when they open outside a host.
- **One consent record and one consent surface.** Every capability asks at the tier the spec names
  — install, first use, a thirty-day token or every use — through one dialog that says which pack,
  capability and reason. The record is plain JSON beside the publisher trust store, keyed by
  publisher, pack, version and capability; a refusal is a stored row, and a pack's answers never
  reach another pack. Recents and the host-wide reminder permission migrate once instead of asking
  again, and an unmappable answer is re-asked rather than silently granted.
- **The host runs the reminders a pack declares.** The queue survives the pack closing and a host
  restart, asks once for the notification tier, shows a denial instead of hiding it, and routes a
  click back to the pack. A failed or refused delivery stays queued and retries with a backoff
  rather than re-arming in the same tick.
- **The host carries the file and library surface.** Reveal in folder, the recent list, the document
  watch and folder import are host calls, so a pack presents a file without ever holding a host
  path and the library refreshes while it is open.
- **A publisher is trusted, not just the Suite key.** The trust store records a publisher and its
  key, verifies signed rotation and revocation advisories, derives a per-pack identity key, and
  keeps two publishers that reuse a pack id apart. The install confirmation names the publisher and
  the fingerprint it recorded.
- **The catalogue reads the published index.** The operator key is pinned in the shell, and the
  index is verified before an entry is listed: signature, `sequence`, `previous` and `expires` are
  all checked against the last verified head. A tampered, unsigned, wrong-operator, expired or
  rolled-back index is refused with a sentence naming the reason, and the catalogue says whether it
  is showing the published index or the local directory.
- **Install, update, remove and reinstall are catalogue actions.** A person chooses the action from
  the row, an update is additive and explicit, and removing a pack deletes its installed version and
  clears its consent and reminder rows while its documents stay in the host's document store.
- **Budget and Planner ship as packs, and Canvas and Help build as packs.** Budget is the first
  pack that opens a document: its entry, prelude and assets serve over `suite-pack://`, its
  renderer mounts over the pack bridge, and a budget round-trips through the host document envelope
  with no second file path. A pack declares the platforms it supports, and a desktop-only pack is
  refused by a host that cannot serve it. The test suite mounts a pack renderer over the same
  `window.suite` services the preload exposes; the Electron view itself stays outside the headless
  gate.
- **The Screens manager belongs to the host.** A person can create, rename, duplicate and delete a
  Screen and choose which one is Home. `screens.json` remembers the role, the last Screen is kept,
  and deleting Home asks for its replacement first. The rule and its tests moved from Start (#314).
- **Documents carry a host envelope.** Each pack document is a magic-and-version prefix, a canonical
  header (publisher, pack, document, schema, payload length, payload checksum) and the pack's payload
  bytes untouched. Saves are serialized, atomic, backed up and recovered after a crash; a file that
  does not verify is quarantined, a newer envelope or schema is refused with its path, and a
  pre-envelope file is left as it is.
- **Declared documents migrate through the host.** A pack's manifest entries are carried into the
  installed pack, the host proves a single migration chain before it writes, takes one backup and
  invokes each declared entry with a handle scoped to that document. The schema stamp makes a second
  run a no-op, a failed entry restores the backup, and a projection refuses a document whose schema
  is not current. The entry runner is injected; binding it to a pack renderer is still open.
- **Blobs are classified and export is a bundle.** A pack's `asset`, `derived` and `cache` blobs live
  in three pack-scoped, content-addressed stores; a read re-hashes and refuses a mismatch, and
  clearing cache touches no asset or derived blob. Export runs the pack's declared `export` entry
  with a host save handle, writes every asset as its original bytes with a verified SHA-256 and a
  manifest entry, and records a missing export entry as `packExport: null` while still exporting the
  assets. The entry runner is injected and the stores are not on the bridge yet.
- **A pack's declared schema is what the host stamps.** A manifest document declaration now supplies
  the envelope's schema version and the newest version the host opens. A pack that writes one format
  under many names declares it once with `mode: "multi"`; Budget declares its snapshot at schema 1.

### Changed

- **Suite Desk is the host's name and the only desktop host.** The Flatpak id stays
  `run.suite.shell`, so an existing install updates in place. Install it once, then install, update,
  remove and reinstall packs from its catalogue. Suite Start is retired (#314): the frozen Flatpaks
  keep their `flatpak install` lines, and no second hub lists or updates them.
- **The relay stops shipping a tray app.** The Sync code stays as the protocol, the client library
  and the relay implementation; the host is where its surface will live, and the signed remote keeps
  the last published ref for anyone who already has it (#315).

## [0.2.0] - 2026-11-22

### Added

- **Home is a Screen.** The host opens a shell-owned Home Screen before any pack, renders the pack
  grid as a host widget, and draws declared app widgets and named placeholders for unknown ones.
- **Screen tabs.** A tab is either a pack or a host Screen. Opening, switching and restoring a Screen
  tab works without creating a pack view, and the space document stores both tab kinds.
- **The pack catalogue and lifecycle.** A local directory of `.suitepack` files is verified before
  it is listed, trusted entries install, and uninstall and additive updates are explicit actions
  with a refusal sentence for anything that fails verification.
- **Routing.** `suite://<pack-id>/<path>` links resolve through one host-owned function and open the
  current installed pack; a malformed, unknown or uninstalled target is refused with a sentence.
- **The external file surface.** A host-owned picker hands a pack opaque handles, and import copies
  a person's file into the pack root without exposing a host path.
- **Packaging as `run.suite.shell`.** The host now builds as a Flatpak named Suite Desk, with a narrower
  sandbox than Start: no host Flatpak service, no host filesystem grants, and no scheme handler yet.

## [0.1.0] - 2026-11-22

### Added

- **One host, many packs.** A `BaseWindow` with a host-owned tab strip, a launcher and one
  `WebContentsView` per pack tab.
- **A real pack boundary.** Each pack is served from `suite-pack://<container>.<id>`, uses its own
  session partition, runs with no Node, and reaches documents only through a sender-scoped API.
- **Opaque documents.** Create, list, open, save and remove a pack's documents; the host carries
  bytes, never a path, and never parses the format.
- **A Loro space document.** Tabs, titles and the active tab restore from `spaces.loro`; the shape is
  container-ready, with one default space and one default container.
- **Three sample packs.** Welcome exercises notes and the two boundary failures (network, sibling
  path); Scratch proves a second pack and a second document root; Conformance exercises the scoped
  files service: relative paths, backups, locks and refusals.
