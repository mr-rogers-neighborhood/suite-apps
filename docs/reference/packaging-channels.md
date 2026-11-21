# Packaging channels

The suite ships the same applications through more than one channel. The channels differ in **who
owns the installed files**, and that decides who may update them.

| Form | Who owns the files | Updates arrive by | Root |
| --- | --- | --- | --- |
| AppImage | the user, under `~/Applications` | Suite Start, from the signed feed | no |
| Arch package | root, under `/opt` | the package manager | yes |
| Flatpak | Flatpak, inside a sandbox | an OSTree remote | no for `--user` |
| Relay tarball | the person, under `/opt` | the person replaces the tree | yes |
| deb / rpm / snap | root, or the store | the package manager or store | yes |

The release tiers a build can carry, and what each promises, are [Channels](../explanation/channels.md).

## The rule

**Suite Start can only replace a file it can write.**

An AppImage under `~/Applications/Suite/<App>/<version>/` belongs to the person who installed it, so
Start can download the next version and put it there. A package under `/usr` or `/opt` belongs to the
package manager, so Start cannot update it.

That is why the suite ships two different things:

- **The hub is packaged.** Suite Start does not update itself; its own row links to the release page.
  Root ownership costs nothing and buys a menu entry, a registered `suite://` handler and no FUSE.
- **The apps are AppImages.** Start installs, updates and removes them, which is the update path a
  person can rehearse.

## AppImage

The AppImage is the default for every distribution except Arch. The release tag carries the image;
the signed `latest-linux.yml` is committed under `feeds/<app>/` and served by Pages. The manifest
names the image by absolute URL on that tag and records its SHA-512. Start verifies the manifest's
signature first, then the checksum before placing an app.

An AppImage needs FUSE 2; many distributions no longer install it. `--appimage-extract-and-run`
works without FUSE, and an unpacked build keeps the Electron sandbox. The AppImage itself may need
`--no-sandbox` because `chrome-sandbox` cannot be setuid on a read-only mount.

Details and the checksum step are in
[Installing Suite Start](../../apps/start/docs/how-to/install.md).

## Arch package

`packaging/arch/PKGBUILD` builds `suite-start-bin` by repackaging the published AppImage,
so the package and the feed cannot describe different releases. It extracts with
`--appimage-extract`, which removes the FUSE dependency.

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

Flatpak is a second channel for Canvas, Planner and Budget. Each app has a manifest beside the others:

```
packaging/flatpak/run.suite.canvas.yml
packaging/flatpak/run.suite.planner.yml
packaging/flatpak/run.suite.budget.yml
```

The manifest packages the unpacked build `package:dir` produced, using zypak from
`org.electronjs.Electron2.BaseApp`, so the Flatpak carries the same bytes as the AppImage and the
deb. The wrapper, `.desktop`, `.metainfo.xml` and hicolor icons live beside the manifest.

```sh
node scripts/flatpak.mjs                       # Canvas: package, build, publish, install
node scripts/flatpak.mjs --app planner         # Planner, same path
node scripts/flatpak.mjs --app budget          # Budget, same path
node scripts/flatpak.mjs --app planner --no-build   # reuse release/linux-unpacked
flatpak run run.suite.planner
```

Canvas stays the default so an existing habit keeps working. The script exports to
`~/suite-flatpak/repo`, adds it as the user remote `suite-local`, and installs from that remote, so
`flatpak update` is the real update path.

The sandbox reaches one documents folder and nothing broader:

```
--filesystem=xdg-documents/Suite:create
```

Planner writes `Documents/Suite/Planner` and Budget writes `Documents/Suite/Budget`; `:create` lets a
first launch make the folder. Planner also has `--share=network` because it syncs a workspace with the
other devices in it. Budget has no network permission: it has no bank sync and no other client.

The `.desktop` file is named for the Flatpak id, and each app's `desktopName` is that id, so Wayland
associates the window with the entry and keeps its icon. Planner and Budget follow that rule; Canvas's
shell still declares the older `suite-canvas.desktop` name.

**OSTree owns updates inside Flatpak.** The sandbox sets `FLATPAK_ID`, and the app then skips its own
feed check and writes a "not checked" report instead of offering a download. `flatpak update` replaces
the deployment, and Start's card asks Flatpak for the update rather than the app's feed. The AppImage
path is unchanged: a copy outside Flatpak still checks its signed feed and updates itself, unless
Start launched it.

`scripts/store-key.sh` makes the store's signing key once. When it has run, `flatpak.mjs` signs the
repository summary, exports the public key beside the fingerprint in `~/suite-flatpak`, and adds the
remote with `--gpg-import`, so every later `flatpak install` and `flatpak update` verifies what it
downloads. A remote that an earlier run added unsigned is switched to verification on the next run.
Without a key the remote is added with `--no-gpg-verify`, which is for local testing only, and the
script says so.

### The signed remote on suite-dev

The same signed repository is published to `suite-dev`, so another machine installs and updates the
apps without building them. The remote answers on the lab network at:

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

The stable apps are on `master`, which the file names as `DefaultBranch`, so the command above needs
no branch. A tier publishes its refs on its own branch and runs the script with `--branch <name>` to
make that the default; install one explicitly with:

```sh
flatpak install --user suite run.suite.planner//<branch>
```

No tier branch exists yet. The script refuses a branch the repository does not carry instead of
inventing one.

The transport is plain HTTP because no certificate exists on `suite-dev`; adding one is separate
work. The connection is readable, and a machine on the path can deny service or stall an update. It
cannot substitute software: the summary is GPG-signed with the store key, and every object is named
by a content hash inside the signed summary. The one unprotected step is the first fetch of
`suite.flatpakrepo`, which carries the public key an attacker on the path could replace. That is the
accepted boundary on the trusted lab network: treat the remote as a lab store, and compare its
`GPGKey` with `~/suite-flatpak/suite-store.gpg` on the publisher when the network is not trusted.
When a certificate does exist, replace the unit's `ExecStart` with a TLS-terminating static server;
HTTP with a signed summary is the documented transport until then.

Start lists Flatpak installs, launches them through `flatpak run`, asks Flatpak to remove one, and —
when the store offers the app — asks Flatpak to install it or to replace a deployment whose commit is
behind. Start reads the commits and never writes a deployment itself. The signed local store has been
exercised end to end: a second published commit turns the card into `update available`, and **Update**
returns it to `Flatpak` with the new commit deployed. The hub is still an AppImage and an Arch package;
packaging it as a Flatpak is a separate decision.

`XDG_DATA_HOME` decides which Flatpak installation is visible. A tool that points it at a per-session
directory, such as Orca, hides the real user installation; run with
`XDG_DATA_HOME=$HOME/.local/share` to see it.

## Platforms

Linux is the only platform with published builds. macOS and Windows are configured but have no
signing identity, so there is nothing to download.

## Update feeds

Each app declares a feed. Start asks every feed what version it has and shows one of four states: not
installed, no release found, an update available, or up to date. The artifact is the one named by the
verified manifest, and its sha512 is checked before installation.

The feeds are static files in this repository:

```
feeds/canvas/latest-linux.yml
feeds/planner/latest-linux.yml
feeds/budget/latest-linux.yml
feeds/start/latest-linux.yml
```

The manifest is committed, so it is served straight from the repository: the base URL for an app is
`https://raw.githubusercontent.com/mr-rogers-neighborhood/suite-apps/main/feeds/<app>`. A detached
ed25519 signature sits beside each manifest as `latest-linux.yml.sig`; the same base URL is compiled
into the app's `suite.app.json`, its electron-builder config and Start's catalogue.

A raw file server, not GitHub Pages: a Pages build needs GitHub Actions, and Actions is unavailable
on this account. Nothing is lost, because the manifest is signed — the signature is checked, and the
host only has to return the bytes that were committed.

The manifest keeps the shape electron-builder writes, with one difference: its artifact URL is
absolute, pointing at `https://github.com/mr-rogers-neighborhood/suite-apps/releases/download/<app>-v<version>/<file>`.
The bytes therefore stay a release asset while the manifest stays a small committed file. A single
monorepo `releases/latest` cannot serve several different `latest-linux.yml` files; per-app tags and
the Pages folder are what let all four resolve at once.

`scripts/release.mjs` writes the pair and signs the exact bytes it commits. A dry run is the default;
`--publish` uploads and commits, and `--verify` reads the published feed back. Which file owns a
version and which tag a release uses is [Version ownership](../how-to/package-and-release.md#version-ownership);
this page does not repeat it.

### The update key

The manifest is signed, and an installed build verifies it with the update key compiled into that
build. Replacing the key at the publisher does not reach an installed copy: the old build keeps
refusing feeds signed with the new key, and its cards report no release rather than offering a
download. The order that avoids this is a new Start first, then a feed signed with the new key;
[the decision record](decisions.md#packaging) states it. The private key's location, the fingerprints
that identify it, and the backup it needs are on [Manage signing keys](../how-to/keys.md).

Recovery from a rotation that already happened is one manual install of the current Start, which then
verifies the feeds with the new key.

A release whose manifest names a feed host that no longer serves the file is retired rather than
annotated: delete the release and its tag, so the artifact stops being a download that installs an app
which cannot update itself. The successor release is then the only current download, and no feed file
on `main` points at a tag that has been removed.
