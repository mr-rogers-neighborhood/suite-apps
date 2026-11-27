# Suite Desk

The desktop host. One installed Electron app; each app is a sandboxed, signed pack opened as a tab.

Suite Desk is the desktop host and the only desktop install path. Canvas, Planner, Budget and Help
remain frozen Flatpaks beside it; the relay runs as a supervised worker of the host (#315). The host
boundary it proves is:

- one window, a host-owned tab strip, pack views and host-rendered Screen tabs;
- each pack on its own `suite-pack://<container>.<id>` origin and its own session partition;
- renderer-only packs: no Node, no raw filesystem, no network unless the manifest declares it;
- a scoped document API that carries opaque bytes and never a path;
- a scoped `files` service with relative paths, host-owned backups and locks;
- one host-owned consent record for every capability: install, first use, every use and token, with
  a refusal shown on the pack's card and re-askable only there;
- a host-owned reminder queue: a pack declares a projection, the host validates display rows and
  schedules them with the pack closed; a denial is visible and a removed pack takes its rows with it;
- a host-owned Command Surface: one input with Capture, Command and Search modes, pack-declared
  commands and scopes, deterministic ranking and session recency, and a separate scoped command
  channel that carries no document bytes;
- a supervised relay worker and a narrow pack-facing relay service: a pinned socket, opaque frames and
  no documents grant;
- a user-consented external file surface: a host-owned picker, opaque handles, single-file import
  and a bounded folder import that copies into the pack's own root;
- the person's file and library surface: reveal a document where the host keeps it, a host recent
  list, and a document watch that reports changes while the pack is closed and while it is open;
- a catalogue that reads local `.suitepack` files and the operator-signed published index, with
  verified install/refusal entries;
- install, update, reinstall and uninstall, version by version;
- `suite://<pack-id>/<path>` routing and a launch context per tab;
- a host-owned Loro space document that restores tabs, models pack and screen tabs, and is
  container-ready;
- a host-owned Home Screen that opens before any pack, renders the pack grid as a host widget,
  and draws declared app widgets and named placeholders for unknown ones;
- three sample packs that exercise the boundary on purpose.

## Run it

```sh
mise exec -- pnpm --filter @suite/desk dev
```

`dev` builds the shared pack packages and the host, then opens the window. It sets
`SUITE_DESK_DEV_PACKS=1` for both steps, so the unsigned sample directories in `packs/` load while
iterating. To build without launching: `mise exec -- pnpm --filter @suite/desk build:all`.

`start` is plain: it opens a window with only verified installed packs. Do not run it in a headless
session; the check path is:

```sh
mise exec -- node scripts/gate.mjs --only desk
```

The app loads signed installs from `<dataRoot>/packs/<id>/<version>`. It never reads
`resources/packs`, and `SUITE_DESK_DEV_PACKS=1` is ignored in a packaged build. A development pack
directory is `packs/<id>/` beside the checkout and only loads when that switch is set. Data lives
under Electron's `userData` directory (`~/.config/Suite Desk/desk` on Linux); `SUITE_DESK_DATA` and
`SUITE_DESK_USER_DATA` override the data and profile directories for a test. The local catalogue
is `<dataRoot>/catalogue`; `SUITE_DESK_CATALOGUE` points it at another directory. The publisher
trust store is `<dataRoot>/trust/publishers.json` and the consent record is
`<dataRoot>/trust/consent.json`; `SUITE_DESK_TRUST` points both elsewhere. The
catalogue index is `https://flatpak.suite.run/index.json`; `SUITE_DESK_INDEX` points at another
index or, with `none`, leaves only the local directory.

The shared pack work lives outside this app: `packages/pack` owns the manifest and signature,
`packages/pack-runtime` owns the pack-side service types, and `packages/pack-host` owns the scoped
file store and the archive reader. The host uses the shared pack id, path and capability vocabulary. Menus, toolbar and status
contributions and multi-window work are the next slices; commands, search and scopes are served now.

The pinned pack key is shared with Suite Go, but the manifest is not: Go requires `independent` and
`isolation`, has its own capability list and different canonical bytes. A desktop `.suitepack` is
refused by Go and a Go `.pack` is refused here until the formats are unified (#202).
[Status](../../docs/reference/status.md) records the split.

## Install as a Flatpak

The host installs as the Flatpak **Suite Desk**, id `run.suite.desk`:

```sh
flatpak install --user suite run.suite.desk
flatpak run run.suite.desk
```

The `run.suite.desk` id is a fresh start. An existing `run.suite.shell` install does not update into
it, so remove that old card if it is there; the new id opens an empty data root, and
`~/.var/app/run.suite.shell` is ignored and may be deleted. No data is copied or migrated.

Updates arrive through Flatpak: `flatpak update --user` replaces the deployment, and the app does
not check for or install its own update. From a checkout, `node scripts/flatpak.mjs --app desk`
builds the same unpacked tree into the local store.

A pre-release channel is the same build under its channel's id — `run.suite.slop.desk`,
`run.suite.nightly.desk` or `run.suite.preview.desk` — on the branch of the same name:

```sh
node scripts/flatpak.mjs --app desk --channel nightly
flatpak install --user suite-local run.suite.nightly.desk//nightly
```

The id, the branch, the desktop name (`Suite Desk (nightly)`) and the desktop entry, metainfo, icon
and launcher names carry the channel. Each channel is its own install, so stable, slop, nightly and
preview sit side by side. Nightly and preview had already moved from a shared pre-release id (#380),
and this rename moves all four Desk ids to `.desk`. An older install does not update into the new id;
it installs once and the old card is removed by hand. There is no data migration.

The pre-release keeps the stable sandbox grants and gets its own profile from its id. Its data root is
that channel's sandbox, `~/.var/app/run.suite.nightly.desk/config/Suite Desk/desk` for nightly, with its
own `packs/` and `spaces.loro`; stable's `~/.var/app/run.suite.desk/config/Suite Desk/desk` and every
other channel's root are never opened by it. The host has no `Documents/Suite` grant to split, and
the pre-release does not gain a `Documents/Suite Slop` folder: files still cross only through the
portals.

Packs live in the sandbox data directory, `~/.var/app/run.suite.desk`, not in the checkout. A
development pack under `packs/` therefore does not load in the Flatpak, and `SUITE_DESK_DEV_PACKS=1`
stays a convenience of an unpackaged build. The Flatpak's desktop entry claims
`x-scheme-handler/suite`, and the app claims the scheme at runtime, so a `suite://` link reaches the
host.

## Installing, updating and removing a pack

The catalogue has two sources, and the Apps widget names the one in use. The local directory is
`.suitepack` files under `<dataRoot>/catalogue` (or `SUITE_DESK_CATALOGUE`). The published index is
`https://flatpak.suite.run/index.json` (or `SUITE_DESK_INDEX`), fetched at launch and verified
against the operator key pinned in `packages/pack/src/pinnedKey.ts`, which both hosts import. The
pin is a compile-time constant, never a value the index supplies. An index entry is listed only
after the index verified; the archive it names is still read and verified before it is listed, and
again before install.

The catalogue is in **Settings → Packs**, the same installed-pack and catalogue widget a Screen can
hold; it can also be added to any Screen from **Edit**. A trusted entry offers **Install**,
**Update** or **Reinstall** as its state requires; a refused entry stays visible with the sentence
that explains it and cannot be installed. A `.suitepack` file can also be opened on its own.
Removing a pack leaves its documents and files on disk until the person removes them.

The index refusals are named, not silent: an index changed after signing, an unsigned index, an
index signed by an operator key this host does not pin, an expired index, a lower `sequence` than
the last verified head (`<dataRoot>/trust/index-head.json`), and a `previous` that does not name
that head's digest are all refused before any entry appears. When the index is refused or
unreachable, the local directory stays usable and the widget says why the published index is not in
use (S12.1). Every archive is read with the shared archive reader and verified: the publisher key in
the manifest against the local trust store, the manifest signature with that key, the host contract
and capability list, and every file hash. An indexed entry must also match the id, version, size and
SHA-256 the index displayed. A trusted entry offers **Install**, **Update** or **Reinstall** as its
state requires; a refused entry stays visible with its refusal sentence and cannot be installed.
Listing never extracts
an archive, so a refusal leaves nothing behind. Each card body shows the mark, name, sentence,
capabilities and status, with the publisher id and key fingerprint kept behind a
keyboard-accessible disclosure.

The trust store is `<dataRoot>/trust/publishers.json` (`SUITE_DESK_TRUST` moves it). It is created
with the first-party Suite key preinstalled; that pin always wins, even if the file is edited. Another
key is added only through the install dialog: a pack signed by an unknown key is refused with the
key's SHA-256 fingerprint in the refusal, and **Trust this publisher** adds that key only after the
person has seen it. A malformed store is ignored rather than guessed at, so a broken file trusts the
first-party key and nothing else.

Before an install or update writes anything, the host shows the publisher id, key fingerprint, pack
id, version and capability list and waits for confirmation; the result notice repeats them. A
development directory has no publisher and says so.

The local directory remains a first-class distribution path: a person may install from a file with
no index and no network (S12.1). The published index adds the store's catalogue; it never replaces
the local directory or the **Add pack…** picker.

The **Add pack…** button is the original file picker. The host reads at most 64 MiB, verifies the
archive with the same rules, refuses extra files and paths that leave the pack root, and only then
writes `<dataRoot>/packs/<id>/<version>/`, with the active publisher recorded beside the versions.
Installs are additive and an existing version is never overwritten except by an explicit reinstall. A
Go `.pack` is a different manifest format and is refused; it is not an import path.

The install identity is `(publisher id, pack id)`. A different publisher under an existing pack id is
refused unless the host passes the explicit migration, and even then it starts with no documents,
files or session storage: those are keyed by both ids. The first-party publisher keeps the old
`documents/<container>/<pack>` and `persist:<container>:<pack>` paths so an existing install is not
moved; any other publisher gets a segment containing its id.

Updating is installing a newer archive for the same id and the same publisher. The loader selects the
highest valid version for the active publisher, so the new version runs after a restart (or
immediately when no tab is open). The old version stays on disk until the person removes it; Home
lists each non-current version with an explicit **Remove** action. Nothing is deleted silently.

**Reinstall** replaces the version directory that is already installed. The new archive is verified
and extracted into a temporary sibling first; only then is the old directory moved aside and the new
one renamed into place. A refused or failed reinstall puts the previous version back, and its
documents and files were never part of the swap.

A publisher key can rotate without changing the publisher id. The publisher signs a rotation
statement carrying the outgoing key, the new key, the same id and a sequence; **Rotate a key…** opens
that file and the host verifies it before showing the new fingerprint. Only the confirmation that
follows that display rewrites `<dataRoot>/trust/publishers.json`. The outgoing key is retired, not
deleted: a version installed before the rotation still loads, and the next update must be signed by
the new key. A replayed sequence or a signature from any key but the outgoing one is refused. The
first-party pin is a release constant and is not changed at runtime.

A revocation is a signed advisory delivered as a small JSON file. **Add revocation…** opens it; the
pack's own publisher signs with the key that signed the pack (a retired key still counts), and the
person may record an unsigned local advisory. A publisher cannot revoke another publisher's pack. A
recorded advisory blocks a new install and marks the catalogue entry as refused; it never disables
or removes an installed pack. A catalogue operator is a valid issuer in the spec; the index key is
pinned, but an advisory has no operator verification path yet, so that form is still refused.
Advisories live in `<dataRoot>/trust/revocations.json` beside the publisher store.

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

## Theme tokens a pack can rely on

A pack has no theme setting and no copy of `@suite/theme`. The host resolves the preset and mode
once, then injects one `:root` sheet into every pack view: **57 custom properties**, all of them
complete in the first sheet injected and replaced as a set when the person changes the theme. A
pack reads `var(--token)` and imports nothing at runtime.

| Layer         | Variables                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Colour (30)   | `--canvas`, `--surface`, `--surface-sunk`, `--surface-strong`, `--accent`, `--accent-strong`, `--danger`, `--success`, `--warning`, `--ink`, `--ink-muted`, `--ink-faint`, `--hairline`, `--border-strong`, `--focus`, `--on-accent`, `--on-danger`, `--on-success`, `--on-warning`, `--hue-slate`, `--hue-blue`, `--hue-green`, `--hue-amber`, `--hue-rose`, `--hue-violet`, `--chart-1` … `--chart-5` |
| Type (10)     | `--text-caption`, `--text-label`, `--text-body`, `--text-title`, `--text-display`, and `--leading-caption`, `--leading-label`, `--leading-body`, `--leading-title`, `--leading-display`                                                                                                                                                                                                                 |
| Density (7)   | `--control-height`, `--control-height-sm`, `--control-padding-x`, `--control-padding-x-sm`, `--control-gap`, `--control-gap-sm`, `--row-padding-y`                                                                                                                                                                                                                                                      |
| Radius (4)    | `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl`                                                                                                                                                                                                                                                                                                                                              |
| Elevation (2) | `--shadow-xl`, `--shadow-2xl`                                                                                                                                                                                                                                                                                                                                                                           |
| Motion (4)    | `--duration-fast`, `--duration-base`, `--duration-slow`, `--ease-standard`                                                                                                                                                                                                                                                                                                                              |

The sheet also carries `color-scheme`, and the host sets `data-theme`, `data-theme-mode`, the
`.dark` class and `style.color-scheme` on the document element, because a stylesheet sometimes
needs the answer as a rule rather than as a value.

The values are the ones that already shipped: the same type steps, the `cozy` density, Tailwind's
four radius steps and two shadows, and the base transition duration a `transition-colors` already
ran at. Publishing them moves no pixel. The type, density, radius, shadow and motion record is
`scaleVariables(density)` in
[`packages/theme/src/scale.ts`](../../packages/theme/src/scale.ts); the colour record is
`cssVariables(preset, mode)`. The host injects `scaleVariables(DEFAULT_DENSITY)` with the resolved
colour values in `themeCss()`, so a pack does not need a separate scale handshake.

## The shape

```text
Suite Desk (one BaseWindow)
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

The tab strip is a **React island**. `shell.js` still draws the rest of the chrome, but the strip is
`HostTabBar` from `@suite/ui`, built by `vite.island.config.ts` into `dist/renderer/tab-bar.js` and
`tab-bar.css`. The island receives a snapshot from `shell.js` and calls back into it; tab state stays
in the legacy page until the rest of the chrome moves. Tailwind is compiled for the island only,
without preflight, so the page's own base styles are unchanged.

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

Home is the host's own Screen, `desk-home`, stored at `<dataRoot>/screens/desk-home.loro`. It is a
role, not a permanent tab: launch restores the saved session, and the brand and the `+` button open
Home again, so closing its tab is safe. A fresh data root shows the first-run wizard instead; its
last step opens Home. A Home that has never been edited is empty and offers **Open** (the first
installed app, preferring Canvas), **Create a document** and **Choose an app**; with no apps it offers
**Install from a file…** and **Choose an app**.

Home can be changed in two places: a Screen tab's context menu or the tab's `Shift+F10` menu offers
**Set as Home**, and **Settings → Home** lists every Screen with the same action. Settings is the
host surface for appearance (palette, brightness and density), Home and the catalogue; it opens from
the new-tab picker, the View menu's **Settings…** item, or from a tab's menu.

The first-run wizard is host chrome from `@suite/ui/chrome`. It selects every trusted catalogue app
by default, chooses palette, brightness and density, and installs the selection concurrently through
the same verified installer the catalogue uses. Before **Install**, the appearance step lists every
chosen app's publisher id, key fingerprint, pack id, version and capabilities, so the selection is
informed consent and the host does not ask once per app. Completion is recorded at
`<dataRoot>/onboarding.json`; a missing, unreadable or older record repeats the wizard. A root that
already has a space document or a Screen is an upgrade, not a first run. **Skip choosing for now**
leaves every app unselected and continues to the look step.

The composition is the same content area the launcher used to fill. A composed Home looks like this:

```json
{
  "format": "suite.screen",
  "version": 2,
  "id": "desk-home",
  "name": "Home",
  "widgets": [
    {
      "kind": "row",
      "size": "full",
      "layout": "row",
      "items": [
        { "registryId": "planner.quick-task", "weight": 2 },
        { "registryId": "budget.saved-views", "weight": 1 }
      ]
    }
  ]
}
```

A Screen tab is host-rendered. Opening, activating, switching away from and closing one are ordinary
tab actions, and no pack view is created for it. While a screen tab is active every pack view is
hidden, which exposes the chrome's composition; switching to a pack tab shows that pack's view and
hides the composition. Closing the last tab shows an empty state with one way back to Home, not a
second copy of the pack grid.

`desk.apps` is an optional **host widget**, not a `SuiteWidget` descriptor: it lives in a host table
keyed by registry id and has no capture action or app behind it. It draws the installed-pack grid,
the search field, the local catalogue and **Add pack…**. A new Home does not include it, and the first
launch on an upgraded root removes the old default placement from Home, because the picker and the
catalogue are host surfaces rather than a widget the person has to dismiss. Removal happens once; a
person who adds it back keeps it. Host widgets are resolved first, so an installed pack cannot shadow
`desk.apps`.

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

A row groups two to eight widgets one level deep. Its items declare a `weight`, which is their share
of the row on a wide window; at phone width the row becomes one horizontal, snapping line instead of
squeezing them. The shared `screenLayout` computes both modes, children stay in document order, and a
host that cannot draw a row flattens it to a stacked list rather than dropping it. Rows are drawn in
this slice and are not edited inline; their placements and settings survive every flat edit.

The Screens manager exports the current Screen as a `.screen` file and imports one. The file is a Loro
snapshot in a `SUITE-SCREEN` envelope with a canonical header (Screen version, id, name, Home flag and
payload length); the extension is `.screen` and the media type is `application/vnd.suite.screen`.
Export writes through a temporary sibling into the path the person chose. Import validates the
envelope, version and shape before touching the store: a newer file is refused with a sentence that
names the next action, and the existing Screens and Home choice are untouched. A valid import always
adds a new Screen; a colliding id gets a new one, and a file that was Home on the writer's device
becomes Home here.

The screen store writes a snapshot through a temporary file and rename, keeps the previous good
snapshot as `<id>.loro.bak`, and renames an unreadable or oversized file to `<id>.loro.corrupt-<time>`
before starting a fresh Home. It never deletes the only copy and never repairs a newer version by
guessing. The same migration chain runs for a stored snapshot and an imported file, with one fixture
per version in `@suite/screens`.

## Command Surface

One host-owned input opens over any surface with `Ctrl/Cmd+K` or the **Commands** button. It has three
modes:

- **Command** lists the host's own commands and the commands installed packs declare in
  `contributions.commands`. Ranking is deterministic: exact title, then prefix, then keyword, then the
  host session's recency, then title. **Clear recents** empties that session list; nothing is written
  to a profile, sent anywhere or keyed to another app.
- **Capture** chooses an app and one of its declared scopes, then sends the typed line to that pack.
- **Search** asks each open pack that declares a `search` provider and aggregates its opaque result
  ids plus display metadata. The host never indexes content and opens a hit through its `suite://`
  link.

A pack declares its providers in the one `contributions.providers` list. Each entry is
`{kind, entry, scopes?}` where `kind` is `commands`, `search` or `scopes`, `entry` is the pack-side
method, and `scopes` names the ids it serves. An undeclared entry is refused, not called. A pack must
also declare the `commands` capability, and the first call asks for that grant at its install tier; a
denial is remembered on the pack's card.

Invocation uses `suite:command:*`, a separate scoped channel. The host sends
`{commandId, scope, arguments}` — string values only — and the pack answers `{ok, message, open?}`.
The host parses `open` as a `suite://` link. No document bytes, path or file handle crosses this
channel, and the sender still decides the pack. A closed pack cannot answer: scope rows come from the
in-memory display-row cache with an age and **Open app to refresh**, and a command asks the person to
open the app. An app or scope this build cannot resolve stays as a named placeholder.

Planner is the first provider. It binds `commands` and `scopes`; `planner.quick-task` captures through
Planner's own parser and document layer, and the `today` and `inbox` scopes return item rows with a
`suite://planner/...` link. Its source is `packs/planner/pack/src/provider.ts`.

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
  identity: { pack: () => Promise<PackIdentity>, sign: (bytes) => Promise<string> },
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

The `identity.pack` capability gives a pack its own key: `identity.pack()` resolves to
`{ publisherId, packId, algorithm: "Ed25519", publicKey, fingerprint }`, derived by the host from
`(publisher id, pack id)` and its device key. The device key and the derived secret never cross the
bridge. `identity.sign(bytes)` asks the host to sign the pack's own data; the signing call refuses a
relay frame, a relay role record and a membership change (S2.6, S4.7). A pack without the capability
gets a rejected call. Suite Go does not derive this key yet, so one identity across both hosts is
still owed.

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
parsing them. The declared `version` is the schema version the host stamps into the envelope and the
newest it will open; a pack that writes one format under many names declares it once with
`mode: "multi"` and the host applies it to every name. The envelope's schema version records each
completed step, so a second run invokes no entry and leaves the file unchanged; a failed entry
restores the backup, so the old document stays readable (S6.6). The runner that executes an entry is
injected into `src/documentMigrations.ts`; binding it to a pack renderer is not built yet.

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

The spike serves `documents`, `files`, `identity.pack`, `network`, `recents`, `notifications`,
`relay` and `commands`. A manifest that declares `storage` is refused until the matching service
exists; the shared capability vocabulary is wider than this host, and loading a pack into a missing
service would only produce buttons that fail.

## Sync and the relay worker

The host owns the relay's lifecycle. `src/relaySupervisor.ts` starts `src/relayWorker.ts` as a
`worker_threads` thread with only `--store <dataRoot>/relay --host 127.0.0.1 --port 0`, waits for one
JSON readiness line before it reports sync as available, and applies a bounded restart policy. The
thread runs the relay's own child entry (`services/relay/src/child.ts`), which closes its listener,
console and store before it writes `stopped`; the host sends `{"type":"stop"}` before it exits and
terminates the thread after the bound. `build:all` builds `@suite/sync-server` first, and
`SUITE_DESK_RELAY_WORKER` names another entry for a test.

The relay is a thread, never a second copy of the host's executable. Under Flatpak the Electron binary
is zypak-wrapped, and a child launched with `ELECTRON_RUN_AS_NODE=1` aborts in zypak
(`DetermineZygoteStrategy: Assertion failed: bus`) because the whitelisted environment has no session
bus; the packaged host also fuses `runAsNode` off, so that child could not have run the relay anyway.
A thread is Node code in this process, ships inside the app's asar with its `@suite/sync-server`
dependency, and stays inside the host's sandbox.

The host chrome shows the state the tray app used to own: on/off, the advertised address, the
certificate fingerprint, the `suite://relay` code, start/stop and the last crash. The relay has no
`documents` grant; the supervisor passes a whitelisted environment and no document path.

A pack with the `relay` capability calls `relay.connect({ url, certificateSha256 })`. The host opens
the socket only to the relay it supervises, verifies the same pin it shows, and returns a tab-scoped
connection whose `send`, `onFrame`, `onClose` and `close` carry opaque bytes. The host never parses a
frame, and a token from one tab cannot be spent by another. Per-document keys, frame verification,
the header index and gap recovery are still S7.2–S7.6 (#304).

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
- sign a relay frame, a relay role record or a membership change with its own key;
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
- **The host owns its space document.** It may parse `spaces.loro`; it never parses `.canvas`,
  `.planner`, `.budget` or a pack's own bytes.
- **The host owns updates.** A pack has no IPC to the updater or installer. Pack installation is
  user-initiated, host-only selectable from a file, and signature-verified before it is extracted.

This is capability-level isolation inside one OS sandbox, not a separate OS sandbox per pack. A
compromised host can read everything it brokers; a Chromium escape is still a Chromium escape. The
decision record owns that trade.

## What is not built yet

- `identity.pack` parity in Suite Go, so a pack sees one identity across desktop and mobile;
- app-widget capture delivery (app widgets render their declared fields, but the host does not send
  a capture to the pack yet);
- per-document keys, relay frame verification, the header index and gap recovery (S7.2–S7.6, #304);
- binding a declared migration, projection or export entry to a pack renderer, and any app's own
  migration bodies (the host's chain, backup, idempotence and failed-migration path exist and are
  tested);
- backing up `asset` and `derived` blobs, and exposing the blob stores or export over the bridge
  (the stores and the bundle writer exist and are tested);
- a user-visible space document file, export and backup;
- document-first launcher entries and cross-app search across closed packs (the Command Surface
  searches open packs and cached display rows only);
- tab tear-off and split view (the view tree is ready; the UI is not);
- the remaining pack contributions: menus, toolbar and status (commands, search and scopes are
  host-rendered now);
- Screen sync across a person's devices (#199; a portable `.screen` file is a manual copy);
- containers and saved spaces in the UI (the space document already carries a space id);
- space-document sync, shared spaces, presence and follow;
- Windows and macOS packaging.

## Sample packs

These directories load only with `SUITE_DESK_DEV_PACKS=1`; their cards on Home carry a `dev` pill.

- `packs/welcome` — notes, title updates, and three deliberate boundary tests: a blocked `fetch`, a
  refused sibling-path open, and a refused `files` call without the capability.
- `packs/scratch` — one `scratch.txt`, plus a probe that cannot read Conformance's file from another
  pack root.
- `packs/conformance` — the `files` service end to end: write/list/read, `mkdir`, rename, backup,
  remove, lock/refuse/unlock, traversal refusals and a cross-pack marker.

## Checks

```sh
mise exec -- pnpm --filter @suite/desk exec biome check .
mise exec -- pnpm --filter @suite/desk exec tsc --noEmit -p tsconfig.json
mise exec -- pnpm --filter @suite/desk test
mise exec -- pnpm --filter @suite/desk build
```

The tests cover pack manifest discovery and traversal, document scoping, the `files` service's
per-pack and per-container isolation, lock ownership, the external surface's filter validation,
token ownership and cancellation, import into the pack root, declared-document resolution, a
declared schema version stamped into the envelope, a two-step migration's idempotence and
failed-migration restore, projection refusal before the schema is current, the three blob class
stores and their content addressing, two publishers' blob stores
staying apart under one pack id, cache clearing that keeps
assets and derived blobs, export-bundle manifests with a verified hash per asset, the no-export-entry
asset fallback and the save handle's path refusal, catalogue trust and refusal (valid, wrong-key,
tampered and unsigned), the published index's pin and its refusals (tampered, unsigned, wrong
operator, expired, rolled back and broken chain), install from the
catalogue, additive updates,
version-only uninstall and symlink refusal, uninstall planning for open tabs, `suite://` parsing and
refusals, launch contexts, space document open/close/title and persistence, version-1 and version-2
space documents with both tab kinds, Home creation and ordering, the screen store's save, backup and
quarantine, add/remove/move/resize including the keyboard's earlier/later path, unknown widget
placeholders, and the channel names the two preloads spell out by hand. The platform dialog itself
is not exercised: tests use an injected picker, because a native dialog cannot run headlessly. The
Electron window, protocol registration, `open-url`/`second-instance` delivery and the rendered
composition are not exercised headlessly; their pure model and view pieces are, and Budget's pack
renderer is mounted in its own suite over a fake `window.suite` rather than in an Electron view.
