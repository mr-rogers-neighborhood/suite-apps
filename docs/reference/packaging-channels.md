# Packaging channels

The suite ships the same applications through more than one channel. The channels differ in **who
owns the installed files**, and that decides who may update them.

| Form | Built for | Who owns the files | Updates arrive by | Root |
| --- | --- | --- | --- | --- |
| AppImage | the three apps and the hub | the user, under `~/Applications` | Start for the apps it placed; the release page for the hub | no |
| Arch package | the hub | root, under `/opt` | the package manager | yes |
| Flatpak | the three apps and the hub | Flatpak, inside a sandbox | an OSTree remote | no for `--user` |
| Relay tarball | the relay | the person, under `/opt` | the person replaces the tree | yes |

The three apps and the hub ship as AppImage and Flatpak; the hub also has the Arch package. `deb` is
not a configured target any more, and `rpm` and `snap` were never built.

The release tiers a build can carry, and what each promises, are [Channels](../explanation/channels.md).

## The rule

**Suite Start can only replace a file it can write, or ask the writer that owns it.**

An AppImage under `~/Applications/Suite/<App>/<version>/` belongs to the person who installed it, so
Start can download the next version and put it there. A package under `/usr` or `/opt` belongs to the
package manager, so Start cannot update it. A Flatpak deployment belongs to Flatpak, so Start asks
Flatpak.

That is why the suite has two kinds of writer:

- **The hub is packaged in every form.** An AppImage hub does not update itself, so its own row links
  to the release page; an Arch hub belongs to the package manager. A Flatpak hub is Flatpak's to
  update, and its row offers that update. Packaging the hub buys a menu entry, a registered `suite://`
  handler and no FUSE.
- **The apps are AppImages or Flatpaks.** Start installs, updates and removes the AppImages it placed,
  and asks Flatpak to install or update a deployment. Either way the person can rehearse the path.

## AppImage

The AppImage is the one-file build. Arch uses its package, and an immutable desktop can use the
Flatpak. The release tag carries the image; the signed `latest-linux.yml` is committed under
`feeds/<app>/` and served from the raw GitHub host, which
[Package and release](../how-to/package-and-release.md#what-a-release-is) owns. The manifest
names the image by absolute URL on that tag and records its SHA-512. Start verifies the manifest's
signature first, then the checksum before placing an app.

An AppImage needs FUSE 2; many distributions no longer install it. `--appimage-extract-and-run`
works without FUSE, and an unpacked build keeps the Electron sandbox. The AppImage itself may need
`--no-sandbox` because `chrome-sandbox` cannot be setuid on a read-only mount.

Details and the checksum step are in
[Installing Suite Start](../../apps/start/docs/how-to/install.md).

## Arch package

`apps/start/packaging/arch/PKGBUILD` builds `suite-start-bin` by repackaging the published AppImage,
so the package and the feed cannot describe different releases. Its `source` line names `suite-apps`
and the `start-v<version>` tag; `scripts/release.mjs` rewrites that line from the image it built. It
extracts with `--appimage-extract`, which removes the FUSE dependency.

The hub is the only app packaged this way.

## Relay tarball

`suite-sync` is a server binary, not an app: it has no Electron shell, no Flatpak and no update
feed. It ships as `suite-sync-<version>-<arch>.tar.gz` on `sync-v<version>`, with a `SHA256SUMS` list
signed by the same update key. The tarball carries the CLI, its JavaScript dependencies and a
launcher, but not a Node runtime; the launcher needs Node.js 22 or later on the host.

Suite Start supervises a relay it finds through `SUITE_SYNC_BIN` or `PATH`; it never updates one.
The download, checksum and signature checks are in
[Leave a relay running](../../apps/sync/docs/how-to/relay.md#1-install-the-relay).

## Flatpak

Flatpak is a second channel for Canvas, Planner, Budget and the hub. Each has a manifest beside the
others:

```
packaging/flatpak/run.suite.canvas.yml
packaging/flatpak/run.suite.planner.yml
packaging/flatpak/run.suite.budget.yml
packaging/flatpak/run.suite.start.yml
```

The manifest packages the unpacked build `package:dir` produced, using zypak from
`org.electronjs.Electron2.BaseApp`, so the Flatpak carries the same bytes as the AppImage. The
wrapper, `.desktop`, `.metainfo.xml` and hicolor icons live beside the manifest.

```sh
node scripts/flatpak.mjs                       # Canvas: package, build, publish, install
node scripts/flatpak.mjs --app planner         # Planner, same path
node scripts/flatpak.mjs --app budget          # Budget, same path
node scripts/flatpak.mjs --app start           # the hub, same path
node scripts/flatpak.mjs --app planner --no-build   # reuse release/linux-unpacked
node scripts/flatpak.mjs --app planner --channel slop  # pre-release id on branch slop
flatpak run run.suite.planner
```

Canvas stays the default so an existing habit keeps working. The script exports to
`~/suite-flatpak/repo`, adds it as the user remote `suite-local`, and installs from that remote, so
`flatpak update` is the real update path. Start does not assume that name: it probes `suite` first and
then `suite-local`, so a machine that followed this page's remote setup is found.

A stable Canvas, Planner or Budget reaches one documents folder and nothing broader:

```
--filesystem=xdg-documents/Suite:create
```

Canvas writes `Documents/Suite/Canvas`, Planner writes `Documents/Suite/Planner` and Budget writes
`Documents/Suite/Budget`; `:create` lets a first launch make the folder. Canvas and Planner also have
`--share=network` because they sync a workspace with the other devices in it. Budget has no network
permission: it has no bank sync, no updater and no other client.

The `.desktop` file is named for the Flatpak id, and each app's `desktopName` is that id, so Wayland
associates the window with the entry and keeps its icon. Planner and Budget follow that rule; Canvas's
shell still declares the older `suite-canvas.desktop` name. A pre-release reuses the stable manifest's
runtime but replaces its documents grant: the stable folder is read-only, and the pre-release writes
`Suite Slop`. It generates its own id, desktop entry, metainfo and icon names.

### The hub as a Flatpak

`node scripts/flatpak.mjs --app start` builds `run.suite.start` from the same unpacked tree and zypak
base. Its exported desktop entry registers `x-scheme-handler/suite`, and `run.suite.start` is both the
application id and the window's WM class. The hub has no pre-release identity, so `--channel` is
refused for `start`.

The hub's sandbox is wider because it is the package manager. The manifest grants the host Flatpak
service (`org.freedesktop.Flatpak`, used through `flatpak-spawn --host`), `~/Applications/Suite`, the
applications and icons under `xdg-data`, `xdg-data/suite`, `xdg-config/suite`, and the documents tree
read-only. The host service is effectively host command execution: that is the trade that lets a
sandboxed hub run the host's `flatpak` and manage deployments. It never writes a document.

When Flatpak deploys the hub, its own row says `Flatpak` and offers **Update Start**. Flatpak replaces
the deployment, and the new build starts next launch. An AppImage hub still updates the apps it placed
but cannot replace itself, so its row links to the release page; an Arch hub is updated by the package
manager.

**OSTree owns updates inside Flatpak.** The sandbox sets `FLATPAK_ID`, and Canvas, Planner and Budget
then skip their own feed check and write a "not checked" report instead of offering a download.
`flatpak update` replaces the deployment, and Start's card asks Flatpak for the update rather than the
app's feed. A Canvas or Planner AppImage outside Flatpak still checks its signed feed and updates
itself, unless Start launched it; a Budget copy has no updater, because Start's catalogue checks its
feed.

`scripts/store-key.sh` makes the store's signing key once. When it has run, `flatpak.mjs` signs the
repository summary, exports the public key beside the fingerprint in `~/suite-flatpak`, and adds the
remote with `--gpg-import`, so every later `flatpak install` and `flatpak update` verifies what it
downloads. A remote that an earlier run added unsigned is switched to verification on the next run.
Without a key the remote is added with `--no-gpg-verify`, which is for local testing only, and the
script says so.

### The signed remote on suite-dev

The same signed repository is published to `suite-dev`, so another machine installs and updates the
apps and the hub without building them. The remote answers on the lab network at:

```
http://10.28.20.200:8088/
```

`node scripts/flatpak-remote.mjs` is a dry run. It prints the branch, the refs and the bytes it would
copy, and refuses a dirty tree or a HEAD that `.dev/gate-status.json` does not prove, with the same
rule `scripts/release.mjs` uses. With `--publish` it runs
`flatpak build-update-repo --gpg-sign=<store key>` on `~/suite-flatpak/repo`, verifies the fresh
summary in a throwaway Flatpak installation, writes `~/suite-flatpak/suite.flatpakrepo`, and rsyncs
the repository to `suite-dev:/home/aurora/flatpak/repo`. It publishes the repository the local flow
builds; it never builds a second one. Publication copies bytes and commits nothing, so the gate proof
stays on HEAD.

The host runs `suite-flatpak-http.service`, a systemd user unit whose source is
[`scripts/suite-flatpak-http.service`](../../scripts/suite-flatpak-http.service). It serves only that
directory, on port 8088, and nothing else on the host uses either. `loginctl enable-linger` keeps the
user manager — and with it the unit — alive between SSH sessions. The gate's transient `suite-gate-*`
units and `~/ci` are separate and untouched by a publication.

Add the remote and install:

```sh
flatpak remote-add --user --if-not-exists --from suite \
  http://10.28.20.200:8088/suite.flatpakrepo
flatpak install --user suite run.suite.planner
flatpak update --user
```

The `.flatpakrepo` file embeds the store's public key in `GPGKey=`, so `remote-add --from` imports it
and `flatpak` verifies the summary from the first fetch. `flatpak remote-ls suite` lists the apps and
branches the remote offers.

The stable apps and the hub are on `master`, which the file names as `DefaultBranch`, so the command
above needs no branch. Publishing a tier writes the same repository on branch `slop`, `canary` or `beta`; the
default branch stays `master`, so adding a tier does not change what a stable install resolves to.
Install a tier explicitly:

```sh
flatpak install --user suite run.suite.slop.planner//slop
```

`flatpak remote-ls suite` lists the stable refs and every tier branch the remote carries. The script
refuses a branch the repository does not carry instead of inventing one.

### Pre-release tiers

A pre-release shares one id, `run.suite.slop.<app>`, across `slop`, `canary` and `beta`; stable keeps
`run.suite.<app>`. The two ids are two cards and two profiles, so stable and one pre-release can be
installed side by side. The tier is the branch, not part of the id, so moving from slop to canary
replaces the pre-release instead of adding a third install. **One pre-release install at a time is the
supported shape.**

```sh
node scripts/flatpak.mjs --app planner --channel slop
flatpak install --user suite-local run.suite.slop.planner//slop
flatpak run run.suite.slop.planner
```

`--channel` accepts `slop`, `canary` or `beta`; anything else is refused before the build. The
generated manifest uses `run.suite.slop.<app>` for the app id, command, desktop file and icon name,
and `NoDisplay=false` keeps the card visible beside stable. Its desktop entry carries **no**
`MimeType` line and **no** `x-scheme-handler/*`, so it registers neither the stable documents nor
`suite://`; stable keeps both. The pre-release `suite.app.json` gets the id `slop-<app>`, no file
extensions and no stable update feed. An installed build whose manifest still carries the older
`slop.<app>` id is read as a pre-release too; nothing writes that form any more. The packaging script
also writes a `suite.channel.json` beside it; no app reads that file yet, so the id is what carries
the pre-release identity.

The Flatpak and AppImage paths sign different things and keep doing so:

- Flatpak signs the OSTree summary with the store key. A tier branch is published on the same remote;
  the stable refs are not rewritten. `scripts/flatpak-remote.mjs --channel slop --publish` signs the
  summary, verifies it and copies the repository.
- The AppImage path signs `latest-linux.yml` with the update key. A pre-release artifact is tagged
  `<tier>-<app>-v<version>` — `slop-planner-v0.3.0` — and its manifest and signature are attached to
  that tag. It **never** writes `feeds/<app>/`: the stable feed and its summary are untouched.
  `node scripts/release.mjs planner --channel slop --publish` is the publish step; without `--publish`
  it is a dry run.

`flatpak remote-ls suite` shows both identities, for example `run.suite.planner` on `master` and
`run.suite.slop.planner` on `slop`. A pre-release is not an automatic update for stable and stable is
not an automatic update for a pre-release.

The transport is plain HTTP because no certificate exists on `suite-dev`; adding one is separate
work. The connection is readable, and a machine on the path can deny service or stall an update. It
cannot substitute software: the summary is GPG-signed with the store key, and every object is named
by a content hash inside the signed summary. The one unprotected step is the first fetch of
`suite.flatpakrepo`, which carries the public key an attacker on the path could replace. That is the
accepted boundary on the trusted lab network: treat the remote as a lab store, and compare its
`GPGKey` with `~/suite-flatpak/suite-store.gpg` on the publisher when the network is not trusted.
When a certificate does exist, replace the unit's `ExecStart` with a TLS-terminating static server;
HTTP with a signed summary is the documented transport until then.

Start lists Flatpak installs, including its own deployment, launches them through `flatpak run`, asks
Flatpak to remove one, and — when the store offers the app — asks Flatpak to install it or to replace a
deployment whose commit is behind. Start reads the commits and never writes a deployment itself. The
signed local store has been exercised end to end: a second published commit turns the card into
`update available`, and **Update** returns it to `Flatpak` with the new commit deployed.

`XDG_DATA_HOME` decides which Flatpak installation is visible. A tool that points it at a per-session
directory, such as Orca, hides the real user installation; run with
`XDG_DATA_HOME=$HOME/.local/share` to see it.

## Pre-release documents

A pre-release install is a second identity (`run.suite.slop.<app>`), not a second window on the
stable data. Stable keeps `Documents/Suite/<App>`. A pre-release keeps `Documents/Suite Slop/<App>`;
a stable document handed to it by a path, a link, or a file manager is copied into that folder and the
copy is opened, so the stable file, its backup and its temporary file are never written. Export is
explicit, writes where the person chooses, and refuses the stable folder. The rule is in
[Canvas's paths](../../apps/canvas/desktop/src/main/paths.ts),
[Planner's workspace location](../../apps/planner/src/main/workspaceLocation.ts) and
[Budget's library](../../apps/budget/src/main/library.ts), with tests beside each.

## Platforms

Linux is the only platform with published builds. macOS and Windows are configured but have no
signing identity, so there is nothing to download.

## Update feeds

Each app's manifest names a feed. Start's catalogue asks every feed what version it has and shows one
of four states: not installed, no release found, an update available, or up to date. Budget's manifest
names its feed for that catalogue; the app itself has no updater and no network client. Start can also
show an app's own update report, which it reads from the app's data directory; Planner writes it
there. The artifact is the one named by the verified manifest, and its sha512 is checked before
installation.

The feeds are static files in this repository:

```
feeds/canvas/latest-linux.yml
feeds/planner/latest-linux.yml
feeds/budget/latest-linux.yml
feeds/start/latest-linux.yml
```

Only a stable release writes these files. A pre-release attaches its signed manifest to its own
`<tier>-<app>-v<version>` tag and leaves `feeds/<app>/` alone.

The manifest is committed, so it is served straight from the repository: the base URL for an app is
`https://raw.githubusercontent.com/mr-rogers-neighborhood/suite-apps/main/feeds/<app>`. A detached
ed25519 signature sits beside each manifest as `latest-linux.yml.sig`; the same base URL is compiled
into the app's `suite.app.json`, its electron-builder config and Start's catalogue.

The host choice is [Package and release](../how-to/package-and-release.md#what-a-release-is)'s;
nothing is lost to it, because the manifest is signed — the signature is checked, and the host only
has to return the bytes that were committed.

The manifest keeps the shape electron-builder writes, with one difference: its artifact URL is
absolute, pointing at `https://github.com/mr-rogers-neighborhood/suite-apps/releases/download/<app>-v<version>/<file>`.
The bytes therefore stay a release asset while the manifest stays a small committed file. A single
monorepo `releases/latest` cannot serve several different `latest-linux.yml` files; per-app tags and
the `feeds/<app>/` folders are what let all four resolve at once.

`scripts/release.mjs` writes the pair and signs the exact bytes it commits. A dry run is the default;
`--publish` uploads and commits, and `--verify` reads the published feed back. Which file owns a
version and which tag a release uses is [Version ownership](../how-to/package-and-release.md#version-ownership);
this page does not repeat it.

### The update key

The manifest is signed, and an installed build verifies it with the update key compiled into that
build. Replacing the key at the publisher does not reach an installed copy: the old build keeps
refusing feeds signed with the new key, and its cards report no release rather than offering a
download. The order that avoids this is a new Start first — the AppImage from its release page, the
Arch package, or the Flatpak from the store — then a feed signed with the new key;
[the decision record](decisions.md#packaging) states it. The private key's location, the fingerprints
that identify it, and the backup it needs are on [Manage signing keys](../how-to/keys.md).

Recovery from a rotation that already happened is one manual install of the current Start, which then
verifies the feeds with the new key.

A release whose manifest names a feed host that no longer serves the file is retired rather than
annotated: delete the release and its tag, so the artifact stops being a download that installs an app
which cannot update itself. The successor release is then the only current download, and no feed file
on `main` points at a tag that has been removed.
