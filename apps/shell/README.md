# Suite Shell (spike)

The desktop host. One installed Electron app; each app is a sandboxed, signed pack opened as a tab.

This is a spike, not the shipping desktop app. Canvas, Planner, Budget, Help, Start and Sync remain
separate Flatpaks. The point of this tree is to prove the host boundary before anything migrates:

- one window, a host-owned tab strip, and a pack view per tab;
- each pack on its own `suite-pack://<container>.<id>` origin and its own session partition;
- renderer-only packs: no Node, no raw filesystem, no network unless the manifest declares it;
- a scoped document API that carries opaque bytes and never a path;
- a scoped `files` service with relative paths, host-owned backups and locks;
- a user-consented external file surface: a host-owned picker, opaque handles and import;
- a shell-owned Loro space document that restores tabs and is container-ready;
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
`SUITE_SHELL_USER_DATA` override the data and profile directories for a test.

The shared pack work lives outside this app: `packages/pack` owns the manifest and signature,
`packages/pack-runtime` owns the pack-side service types, and `packages/pack-host` owns the scoped
file store and the archive reader. The spike uses the shared pack id, path and capability
vocabulary. Contributions and multi-window work are the next slices.

The pinned pack key is shared with Suite Go, but the manifest is not: Go requires `independent` and
`isolation`, has its own capability list and different canonical bytes. A desktop `.suitepack` is
refused by Go and a Go `.pack` is refused here until the formats are unified (#202).
[Status](../../docs/reference/status.md) records the split.

## Installing a pack

The launcher's **Install pack…** button opens the host's file picker for a `.suitepack`. The host reads
at most 64 MiB, verifies the manifest signature against the pinned key and every file hash, refuses
extra files and paths that leave the pack root, and only then writes
`<dataRoot>/packs/<id>/<version>/`. Installs are additive and an existing version is never
overwritten. A Go `.pack` is a different manifest format and is refused; it is not an import path.

A newly installed app appears in the launcher immediately and opens now. A tab that is already open
keeps its loaded view; running a replaced version of that pack needs a Suite restart, because the
pack session's protocol handler is bound when its first view loads. The install IPC exists on the
chrome bridge only; a pack has no installer channel.

## The shape

```text
Suite (one BaseWindow)
├── chrome view (full window, sandboxed renderer)
│   ├── tab strip
│   └── launcher
└── pack views (one WebContentsView per tab, below the tab bar)
    ├── suite-pack://default.welcome  → persist:default:welcome
    └── suite-pack://default.scratch  → persist:default:scratch
```

The chrome view is the only renderer the host itself draws. A pack view covers the content area when
its tab is active; switching tabs only hides the other views, so a half-typed document survives a
trip through the launcher. Closing a tab destroys its view.

The default container id is already in the data model: documents live under
`documents/default/<pack>`, pack files under `files/<container>/<pack>`, a pack origin is
`suite-pack://default.<pack>`, and its session is `persist:default:<pack>`. Adding more containers is
a UI change, not a storage migration.

A **Space** is the user-facing grouping — not necessarily work. A **Container** is the data
identity. A **Session** is the local set of open windows and tabs. The spike’s space document still
stores the live tabs; the multi-window phase splits session state into its own local store.

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
  documents: { list, create, open, save, remove },
  files: {
    list, stat, mkdir, read, write, rename, remove, backup, lock,
    pickOpen, pickSave, importFile,
  },
  setTitle(title),
  openExternal(url),
};
```

The document API requires the `documents` capability; without it, every document call returns
nothing. `documents` is scoped by the sender's container and pack id, so the same pack in two
containers has two separate document roots. A document id is a name inside that pack's root; it is
never a path. `save` writes bytes atomically. The host does not parse a document, so the pack owns
its format. `welcome` stores a JSON note; `scratch` stores plain UTF-8 text.

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

- a remote pack index, uninstall and pack updates;
- the host's blind relay transport for pack sync;
- a user-visible space document file, export and backup;
- document-first launcher entries, recents and cross-app search;
- tab tear-off and split view (the view tree is ready; the UI is not);
- host-rendered pack contributions (commands, menus, toolbar, status, widgets);
- containers and saved spaces in the UI (the space document already carries a space id);
- space-document sync, shared spaces, presence and follow;
- Windows and macOS packaging.

## Sample packs

These directories load only with `SUITE_SHELL_DEV_PACKS=1`; their launcher cards carry a `dev` pill.

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
token ownership and cancellation, import into the pack root, space document open/close/title and
persistence, and the channel names the two preloads spell out by hand. The platform dialog itself is
not exercised: tests use an injected picker, because a native dialog cannot run headlessly.
