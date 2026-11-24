# Suite Shell (spike)

The desktop host. One installed Electron app; each app is a sandboxed, signed pack opened as a tab.

This is a spike, not the shipping desktop app. Canvas, Planner, Budget, Help, Start and Sync remain
separate Flatpaks. The point of this tree is to prove the host boundary before anything migrates:

- one window, a host-owned tab strip, pack views and host-rendered Screen tabs;
- each pack on its own `suite-pack://<container>.<id>` origin and its own session partition;
- renderer-only packs: no Node, no raw filesystem, no network unless the manifest declares it;
- a scoped document API that carries opaque bytes and never a path;
- a scoped `files` service with relative paths, host-owned backups and locks;
- a user-consented external file surface: a host-owned picker, opaque handles and import;
- a local catalogue of `.suitepack` files with verified install/refusal entries;
- uninstall and additive pack updates, version by version;
- `suite://<pack-id>/<path>` routing and a launch context per tab;
- a shell-owned Loro space document that restores tabs, models pack and screen tabs, and is
  container-ready;
- a shell-owned Home Screen that opens before any pack, renders the pack grid as a host widget,
  and draws declared app widgets and named placeholders for unknown ones;
- three sample packs that exercise the boundary on purpose.

## Run it

```sh
mise exec -- pnpm --filter @suite/shell dev
```

`dev` builds the shared pack packages and the shell, then opens the window. It sets
`SUITE_SHELL_DEV_PACKS=1` for both steps, so the unsigned sample directories in `packs/` load while
iterating. To build without launching: `mise exec -- pnpm --filter @suite/shell build:all`.

`start` is plain: it opens a window with only verified installed packs. Do not run it in a headless
session; the check path is:

```sh
mise exec -- node scripts/gate.mjs --only shell
```

The app loads signed installs from `<dataRoot>/packs/<id>/<version>`. It never reads
`resources/packs`, and `SUITE_SHELL_DEV_PACKS=1` is ignored in a packaged build. A development pack
directory is `packs/<id>/` beside the checkout and only loads when that switch is set. Data lives
under Electron's `userData` directory (`~/.config/Suite/shell` on Linux); `SUITE_SHELL_DATA` and
`SUITE_SHELL_USER_DATA` override the data and profile directories for a test. The local catalogue
is `<dataRoot>/catalogue`; `SUITE_SHELL_CATALOGUE` points it at another directory. The publisher
trust store is `<dataRoot>/trust/publishers.json`; `SUITE_SHELL_TRUST` points it elsewhere.

The shared pack work lives outside this app: `packages/pack` owns the manifest and signature,
`packages/pack-runtime` owns the pack-side service types, and `packages/pack-host` owns the scoped
file store and the archive reader. The spike uses the shared pack id, path and capability
vocabulary. Contributions and multi-window work are the next slices.

The pinned pack key is shared with Suite Go, but the manifest is not: Go requires `independent` and
`isolation`, has its own capability list and different canonical bytes. A desktop `.suitepack` is
refused by Go and a Go `.pack` is refused here until the formats are unified (#202).
[Status](../../docs/reference/status.md) records the split.

## Install as a Flatpak

The host installs as the Flatpak **Suite Shell**, id `run.suite.shell`:

```sh
flatpak install --user suite run.suite.shell
flatpak run run.suite.shell
```

Updates arrive through Flatpak: `flatpak update --user` replaces the deployment, and the app does
not check for or install its own update. From a checkout, `node scripts/flatpak.mjs --app shell`
builds the same unpacked tree into the local store.

A pre-release channel is the same build under `run.suite.slop.shell`, on the `slop`, `nightly` or
`preview` branch:

```sh
node scripts/flatpak.mjs --app shell --channel nightly
flatpak install --user suite-local run.suite.slop.shell//nightly
```

All three pre-release channels share the one pre-release id; the branch, the desktop name (`Suite
Shell (nightly)`) and the desktop entry, metainfo, icon and launcher names carry the channel. Moving
from `slop` to `nightly` replaces the one pre-release install, so a machine holds stable plus at most
one pre-release.

The pre-release keeps the stable sandbox and gets its own profile from its id. Its data root is the
pre-release sandbox, `~/.var/app/run.suite.slop.shell/config/Suite/shell`, with its own `packs/` and
`spaces.loro`; stable's `~/.var/app/run.suite.shell/config/Suite/shell` is never opened by it. The
shell has no `Documents/Suite` grant to split, and the pre-release does not gain a `Documents/Suite
Slop` folder: files still cross only through the portals.

Packs live in the sandbox data directory, `~/.var/app/run.suite.shell`, not in the checkout. A
development pack under `packs/` therefore does not load in the Flatpak, and `SUITE_SHELL_DEV_PACKS=1`
stays a convenience of an unpackaged build. The Flatpak does not register `suite://` yet: Start keeps
the scheme in this phase, and the host routes a link that reaches it.

## Installing, updating and removing a pack

Home's `shell.apps` widget shows installed packs and the local catalogue together. The catalogue is a directory
of `.suitepack` files (`<dataRoot>/catalogue`, or `SUITE_SHELL_CATALOGUE`). Each archive is read with
the shared archive reader and verified before it is listed: the publisher key in the manifest against
the local trust store, the manifest signature with that key, the host contract and capability list, and
every file hash. A trusted entry offers **Install**; a refused entry stays visible with its refusal
sentence and cannot be installed. Listing never extracts an archive, so a refusal leaves nothing
behind. Each card shows the publisher id and key fingerprint, plus the declared capabilities.

The trust store is `<dataRoot>/trust/publishers.json` (`SUITE_SHELL_TRUST` moves it). It is created
with the first-party Suite key preinstalled; that pin always wins, even if the file is edited. Another
key is added only through the install dialog: a pack signed by an unknown key is refused with the
key's SHA-256 fingerprint in the refusal, and **Trust this publisher** adds that key only after the
person has seen it. A malformed store is ignored rather than guessed at, so a broken file trusts the
first-party key and nothing else.

Before an install or update writes anything, the host shows the publisher id, key fingerprint, pack
id, version and capability list and waits for confirmation; the result notice repeats them. A
development directory has no publisher and says so.

The catalogue is a local distribution path. A remote index is a later slice with the same trust
rule; it is not built here.

The **Add pack…** button is the original file picker. The host reads at most 64 MiB, verifies the
archive with the same rules, refuses extra files and paths that leave the pack root, and only then
writes `<dataRoot>/packs/<id>/<version>/`, with the active publisher recorded beside the versions.
Installs are additive and an existing version is never overwritten. A Go `.pack` is a different
manifest format and is refused; it is not an import path.

The install identity is `(publisher id, pack id)`. A different publisher under an existing pack id is
refused unless the host passes the explicit migration, and even then it starts with no documents,
files or session storage: those are keyed by both ids. The first-party publisher keeps the old
`documents/<container>/<pack>` and `persist:<container>:<pack>` paths so an existing install is not
moved; any other publisher gets a segment containing its id.

Updating is installing a newer archive for the same id and the same publisher. The loader selects the
highest valid version for the active publisher, so the new version runs after a restart (or
immediately when no tab is open). The old version stays on disk until the person removes it; Home
lists each non-current version with an explicit **Remove** action. Nothing is deleted silently.

**Uninstall** removes exactly `<dataRoot>/packs/<id>/<version>`. A symlinked install root, id
directory or version directory is refused, and the version must resolve inside the real pack root;
a path outside it, or a version that is not a safe segment, is refused before removal. If a tab for
that pack is open, the host closes it first and says so in the notice; the view is bound to the
version that loaded it and the host does not keep a second copy of that binding. The pack's documents
under `documents/<container>/<pack>` and its files under `files/<container>/<pack>` are never touched.

A newly installed app appears on Home immediately and opens now. A tab that is already open
keeps its loaded view; running a replaced version of that pack needs a Suite restart, because the
pack session's protocol handler is bound when its first view loads. The install and uninstall IPC
exist on the chrome bridge only; a pack has no installer or lifecycle channel.

## Suite links and launch

The host claims `suite://` and routes `suite://<pack-id>/<path>` in one pure function. A malformed
id, an unknown or uninstalled pack, and a pack with no entry are refused with a sentence shown on
Home. The path is metadata for the pack; the host loads the pack's current installed entry.
A deep link never installs or updates anything.

Linux and Windows deliver a link as an argument to a second launch: the single-instance lock keeps
one host, the second-instance event focuses it and routes the link. macOS delivers an `open-url`
event; a link that arrives before the window exists is held and drained at startup.

Each tab stores the context it was opened with. `window.suite.launch()` returns it from the main
process, keyed by the sender's tab, so a pack never parses a launch out of a URL and never names
another tab. A plain open is `{ kind: "launcher" }`; a deep link is
`{ kind: "deep-link", url }`. The chrome's own link opening is unchanged, and a pack still cannot
hand a link to the OS browser without `network`.

## The shape

```text
Suite Shell (one BaseWindow)
├── chrome view (full window, sandboxed renderer)
│   ├── tab strip
│   └── content area
│       ├── Home / Screen composition (a screen tab is active)
│       └── empty state (no tab is active)
└── pack views (one WebContentsView per pack tab, below the tab bar)
    ├── suite-pack://default.welcome  → persist:default:welcome
    └── suite-pack://default.scratch  → persist:default:scratch
```

The chrome view is the only renderer the host itself draws. A pack view covers the content area when
its tab is active; switching tabs only hides the other views, so a half-typed document survives a
switch. Closing a pack tab destroys its view. A Screen tab is host chrome: no view is created for it,
so hiding every pack view is what makes the composition visible.

The default container id is already in the data model: documents live under
`documents/default/<pack>`, pack files under `files/<container>/<pack>`, a pack origin is
`suite-pack://default.<pack>`, and its session is `persist:default:<pack>`. Adding more containers is
a UI change, not a storage migration.

A **Space** is the user-facing grouping — not necessarily work. A **Container** is the data
identity. A **Session** is the local set of open windows and tabs. The spike’s space document still
stores the live tabs; the multi-window phase splits session state into its own local store.

A stored tab is a discriminated union: a **pack** tab names a pack and entry, and a **screen** tab
names a host screen. The document is at `shell.version = 2`; a version-1 document has no `kind`, and
its tabs read as pack tabs. Old tabs are not dropped or rewritten on read.

## Home and Screens

Home is the shell's own Screen, `shell-home`, stored at `<dataRoot>/screens/shell-home.loro`. It is
created and opened before any pack view exists, its tab is first in the strip, and it is the active
tab on a first run. The brand and the `+` button open Home again, so closing it is safe. A restored
space document keeps its active tab; Home is still added at the front.

The composition is the same content area the launcher used to fill:

```json
{
  "format": "suite.screen",
  "version": 1,
  "id": "shell-home",
  "name": "Home",
  "widgets": [{ "registryId": "shell.apps", "size": "full" }]
}
```

A Screen tab is host-rendered. Opening, activating, switching away from and closing one are ordinary
tab actions, and no pack view is created for it. While a screen tab is active every pack view is
hidden, which exposes the chrome's composition; switching to a pack tab shows that pack's view and
hides the composition. Closing the last tab shows an empty state with one way back to Home, not a
second copy of the pack grid.

`shell.apps` is a **host widget**, not a `SuiteWidget` descriptor: it lives in a shell table keyed by
registry id and has no capture action or app behind it. It draws the installed-pack grid, the search
field, the local catalogue and **Add pack…** — the launcher's content, now inside Home. Host widgets
are resolved first, so an installed pack cannot shadow `shell.apps`.

App widgets come from `widgets` in each installed pack manifest, resolved through
`@suite/screens`'s registry as `<pack id>.<widget id>`. The host draws the declared title, fields and
resolved settings with its own components; the pack supplies data, never DOM. A registry id that
does not resolve is a named placeholder with a sentence, and the placement and its settings stay in
the document. This slice does **not** deliver captures: an app widget says so, rather than offering a
button that cannot work.

**Edit** on Home adds an inline edit surface. Every action has a named button and a key on the
focused widget:

| Action               | Key                     | Button                              |
| -------------------- | ----------------------- | ----------------------------------- |
| Move earlier / later | `↑` / `↓`               | Move earlier, Move later            |
| Smaller / larger     | `←` / `→`               | Size: … cycles `1x1`, `2x1`, `full` |
| Remove               | `Delete` or `Backspace` | Remove                              |

The size classes stay exactly `1x1`, `2x1` and `full`. Adding is a named **Add widget** control fed by
the host table and the installed packs. The chrome never keeps document state; every action names a
registry id and the main process answers with the new state. Unknown ids and unknown settings survive
editing, saving and reopening.

The screen store writes a snapshot through a temporary file and rename, keeps the previous good
snapshot as `<id>.loro.bak`, and renames an unreadable or oversized file to `<id>.loro.corrupt-<time>`
before starting a fresh Home. It never deletes the only copy and never repairs a newer version by
guessing.

## The pack contract

An installed pack is one version directory, `<dataRoot>/packs/<id>/<version>/`, holding
`manifest.json` and the files the manifest lists. It arrives as a `.suitepack` archive, which is a zip
whose `manifest.json` is signed. A development pack is a plain directory with the same shape under
`packs/` beside the checkout:

```json
{
  "format": "suite.pack",
  "id": "welcome",
  "name": "Welcome",
  "version": "0.1.0",
  "entry": "index.html",
  "contractVersion": 1,
  "capabilities": ["documents"],
  "description": "Demo pack for the host boundary."
}
```

The host exposes one global to a pack:

```js
window.suite = {
  packId,
  containerId,
  info(),
  launch: () => Promise<PackLaunchContext>,
  documents: { list, create, open, save, remove },
  files: {
    list, stat, mkdir, read, write, rename, remove, backup, lock,
    pickOpen, pickSave, importFile,
  },
  setTitle(title),
  openExternal(url),
};
```

`launch()` is asynchronous because it crosses the bridge. It resolves to `{ kind: "launcher" }` for
an ordinary open or `{ kind: "deep-link", url }` when a `suite://` link opened this tab.

The document API requires the `documents` capability; without it, every document call returns
nothing. `documents` is scoped by the sender's container and pack id, so the same pack in two
containers has two separate document roots. A document id is a name inside that pack's root; it is
never a path. `save` writes bytes atomically. The host does not parse a document, so the pack owns
its format. `welcome` stores a JSON note; `scratch` stores plain UTF-8 text.

Each document is a host envelope: magic, envelope version, publisher, pack id, document id, schema
version, payload length and a SHA-256 of the payload, then the pack's bytes untouched. The host reads
the header and verifies the payload hash; it never decodes the payload. Saves are serialized, kept
atomic, backed up as `<name>.bak` and recovered after a crash; a file that does not verify is
quarantined as `<name>.corrupt-<timestamp>` and refused, and a newer envelope or schema is refused
with a sentence naming the file rather than replaced by a fresh document. `list` reports the payload
size, not the envelope size. A file written before the envelope is refused and left as it is.

A pack may declare its documents and a migration chain (S6.3). The host finds the declaration by id,
proves the chain before it writes, takes one backup and invokes each declared entry with a handle
scoped to that single document; the entry body is pack code, and the host passes bytes without
parsing them. The envelope's schema version records each completed step, so a second run invokes no
entry and leaves the file unchanged; a failed entry restores the backup, so the old document stays
readable (S6.6). The runner that executes an entry is injected into
`src/documentMigrations.ts`; binding it to a pack renderer is not built yet.

A pack's blobs live in three content-addressed class stores under
`blobs/<container>/<pack>/<class>/<sha256>`: `asset`, `derived` and `cache`. The first-party publisher
keeps that segment; any other publisher's store is `blobs/<container>/<publisher>~<pack>/<class>/<sha256>`,
so a migrated publisher starts with no blobs and an existing install is not moved. A manifest store
name declares its class, a read re-hashes the bytes and refuses a mismatch, and clearing the cache
removes only cache. Export writes every asset as its original bytes at `assets/<sha256>` in a
host-chosen bundle, records it with its hash and length and verifies every hash, then writes
`manifest.json` last. The pack's declared `export` entry runs first through a save handle that cannot
leave the bundle or write the host's manifest or assets; a pack that declares no export entry is
still exported for its assets with `packExport: null` (S6.7, S6.8). The blob stores and export entry
are not bound to a pack renderer yet.

The `files` service requires the `files` capability. It is a separate root from `documents`, created
lazily per `(container, pack)` at `files/<container>/<pack>` and never inside the pack's code
directory. Paths are relative and slash-separated; `..`, absolute paths, symlinks and non-regular
files are refused. Writes are atomic and may carry `expectedMtimeMs`; `backup` returns the relative
path of a dated sibling. `lock` returns a `FileLock`, and the host releases every lock a tab held
when its view is destroyed. A pack without `files` gets a rejected call, not an empty success.

The spike serves `documents`, `files` and the `network` policy. A manifest that declares `storage`,
`recents`, `notifications`, `relay` or `commands` is refused until the matching service exists; the
shared capability vocabulary is wider than this host, and loading a pack into a missing service
would only produce buttons that fail.

External files are the consented half of `files`: the person, not the pack, chooses what to open or
where to save. `pickOpen(filters)` and `pickSave(suggestedName)` show a host-owned platform dialog
and resolve to a `FileHandle`, or to `null` when the person cancels. The host keeps the absolute path
in the main process; the pack receives an opaque token and `{ name, size, mtimeMs }`, and `read`,
`write` and `close` spend the token over IPC. A token is scoped to the sending tab's
`(container, pack, tab)`; another pack or tab is refused, and every handle a tab owns is released
when its view is destroyed, crashes or is replaced.

Filters are data: `{ name, extensions }` with bare lower-case extensions and no dot. A filter name
may not contain a path separator, a glob metacharacter or a drive colon, so it never names a path or
a pattern; invalid filters are refused before the dialog opens. The pack-host cap (`256 MiB`, exported
as `PACK_FILE_MAX_BYTES`) applies to both reads and writes.

The person chooses the save destination; picking one does not create or truncate it. A new
destination reports `{ name, size: 0, mtimeMs: 0 }`; an existing one reports its current values and
is left untouched. A handle's write
goes to a temporary sibling in the destination's own directory and is renamed over it only on
success. A failed write leaves the previous file in place and removes the temporary file; a
successful write replaces the file rather than truncating it in place. `importFile(handle, name?)`
reads the external bytes and copies them into the pack's own `files` root through `PackFileStore`,
returning a `FileEntry` whose `path` is relative to that root. It refuses an oversized source and
never returns an external path.

A pack's own browser storage (`localStorage`, IndexedDB) is per-pack and persistent because every
pack has its own session partition. The `storage` capability refers to a separate host-provided
key-value service, not to browser storage; that service is not implemented yet.

A pack cannot:

- use Node or `require`;
- read another pack's documents or files;
- ask for an absolute path or a path outside its own root, or learn the path of a file the person
  picked through the host dialog;
- write a download outside its document or file root;
- reach the network without the `network` capability, or hand a link to the OS browser through
  `openExternal` or `window.open`;
- open a window, navigate away from its own origin, or grant itself a permission;
- install or update another pack.

## Security notes

- **Pack identity comes from the main process.** The sender's `webContents` id maps to a pack and tab;
  the pack's own claim about its id is never trusted.
- **Every root is per pack and every path is validated.** A document name cannot contain a slash;
  a file path must be relative and may not contain `..`, an empty segment or a control character.
  Both refuse absolute paths before the filesystem is reached. A symlink or other non-regular file
  is refused, and `list` skips one. Backups and temp files use the same file root.
- **The pack session denies permissions wholesale.** A pack without `network` may load only its own
  `suite-pack://` origin; the protocol handler also sets a CSP. A pack with `network` may reach HTTPS
  and WSS only, and only it may hand an `http`/`https` link to the OS browser. `openExternal` and a
  pack's `window.open` are both refused without the capability; the chrome's own link opener is not
  gated, because it is the host.
- **The shell owns its space document.** It may parse `spaces.loro`; it never parses `.canvas`,
  `.planner`, `.budget` or a pack's own bytes.
- **The shell owns updates.** A pack has no IPC to the updater or installer. Pack installation is
  user-initiated, host-only selectable from a file, and signature-verified before it is extracted.

This is capability-level isolation inside one OS sandbox, not a separate OS sandbox per pack. A
compromised shell can read everything it brokers; a Chromium escape is still a Chromium escape. The
decision record owns that trade.

## What is not built yet

- a remote pack index (the catalogue is local only);
- app-widget capture delivery (app widgets render their declared fields, but the host does not send
  a capture to the pack yet);
- the host's blind relay transport for pack sync;
- binding a declared migration, projection or export entry to a pack renderer, and any app's own
  migration bodies (the host's chain, backup, idempotence and failed-migration path exist and are
  tested);
- backing up `asset` and `derived` blobs, and exposing the blob stores or export over the bridge
  (the stores and the bundle writer exist and are tested);
- a user-visible space document file, export and backup;
- document-first launcher entries, recents and cross-app search;
- tab tear-off and split view (the view tree is ready; the UI is not);
- host-rendered pack contributions (commands, menus, toolbar, status; widgets are host-rendered here,
  but a pack's non-widget contributions still are not);
- the Screens manager (create, rename, duplicate, delete, set Home) and a portable `.screen` file with
  export/import;
- containers and saved spaces in the UI (the space document already carries a space id);
- space-document sync, shared spaces, presence and follow;
- Windows and macOS packaging.

## Sample packs

These directories load only with `SUITE_SHELL_DEV_PACKS=1`; their cards on Home carry a `dev` pill.

- `packs/welcome` — notes, title updates, and three deliberate boundary tests: a blocked `fetch`, a
  refused sibling-path open, and a refused `files` call without the capability.
- `packs/scratch` — one `scratch.txt`, plus a probe that cannot read Conformance's file from another
  pack root.
- `packs/conformance` — the `files` service end to end: write/list/read, `mkdir`, rename, backup,
  remove, lock/refuse/unlock, traversal refusals and a cross-pack marker.

## Checks

```sh
mise exec -- pnpm --filter @suite/shell exec biome check .
mise exec -- pnpm --filter @suite/shell exec tsc --noEmit -p tsconfig.json
mise exec -- pnpm --filter @suite/shell test
mise exec -- pnpm --filter @suite/shell build
```

The tests cover pack manifest discovery and traversal, document scoping, the `files` service's
per-pack and per-container isolation, lock ownership, the external surface's filter validation,
token ownership and cancellation, import into the pack root, declared-document resolution, a
two-step migration's idempotence and failed-migration restore, projection refusal before the schema
is current, the three blob class stores and their content addressing, two publishers' blob stores
staying apart under one pack id, cache clearing that keeps
assets and derived blobs, export-bundle manifests with a verified hash per asset, the no-export-entry
asset fallback and the save handle's path refusal, catalogue trust and refusal (valid, wrong-key,
tampered and unsigned), install from the
catalogue, additive updates,
version-only uninstall and symlink refusal, uninstall planning for open tabs, `suite://` parsing and
refusals, launch contexts, space document open/close/title and persistence, version-1 and version-2
space documents with both tab kinds, Home creation and ordering, the screen store's save, backup and
quarantine, add/remove/move/resize including the keyboard's earlier/later path, unknown widget
placeholders, and the channel names the two preloads spell out by hand. The platform dialog itself
is not exercised: tests use an injected picker, because a native dialog cannot run headlessly. The
Electron window, protocol registration, `open-url`/`second-instance` delivery, the rendered
composition and an actual pack render are not exercised headlessly; their pure model and view pieces
are.
