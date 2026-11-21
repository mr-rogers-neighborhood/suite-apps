# Packaging channels

Linux desktop apps in the suite ship as Flatpaks. The relay is a server tarball. The two forms differ
in **who owns the installed files**, and that decides who may update them.

| Form | Built for | Who owns the files | Updates arrive by | Root |
| --- | --- | --- | --- | --- |
| Flatpak | Canvas, Planner, Budget, Help and the hub | Flatpak, inside a sandbox | an OSTree remote | no for `--user` |
| Relay tarball | `suite-sync` | the person, under `/opt` | the person replaces the tree | yes |

There is no AppImage, Arch package, `deb`, `rpm` or `snap`. Help is a Flatpak like the rest, and the
relay is not an app.

The release tiers a build can carry, and what each promises, are [Channels](../explanation/channels.md).

## The rule

**Start asks the writer that owns the deployment. It never replaces a Flatpak itself.**

Flatpak owns every desktop deployment. Start lists it, launches it, reveals it, and asks Flatpak to
install, update or remove it. A folder copy a person places is not Start's either: the card offers
Open, Reveal and Forget, and its updates are the person's to make.

That is why there are two writers, and neither is Start:

- **The hub is a Flatpak.** Flatpak owns `run.suite.start`, and its own row offers **Update Start**
  only when the installed commit differs from the newest commit on that deployment's own origin. A
  hub cannot replace its own running binary; Flatpak replaces the deployment and the new build starts
  next launch.
- **The apps are Flatpaks.** Start asks Flatpak to install or update a deployment. A placed folder
  copy is first-class but separate: Start can open, reveal and forget it, not update it.

## Flatpak

Canvas, Planner, Budget, Help and the hub each have a manifest beside the others:

```
packaging/flatpak/run.suite.canvas.yml
packaging/flatpak/run.suite.planner.yml
packaging/flatpak/run.suite.budget.yml
packaging/flatpak/run.suite.help.yml
packaging/flatpak/run.suite.start.yml
```

The manifest packages the unpacked build `package:dir` produced, using zypak from
`org.electronjs.Electron2.BaseApp`. The wrapper, `.desktop`, `.metainfo.xml` and hicolor icons live
beside the manifest.

```sh
node scripts/flatpak.mjs                       # Canvas: package, build, publish, install
node scripts/flatpak.mjs --app planner         # Planner, same path
node scripts/flatpak.mjs --app budget          # Budget, same path
node scripts/flatpak.mjs --app start           # the hub, same path
node scripts/flatpak.mjs --app help             # Help
node scripts/flatpak.mjs --app planner --no-build   # reuse release/linux-unpacked
node scripts/flatpak.mjs --app planner --channel slop  # pre-release id on branch slop
flatpak run run.suite.planner
```

Canvas stays the default so an existing habit keeps working. The script exports to
`~/suite-flatpak/repo`, adds it as the user remote `suite-local`, and installs from that remote, so
`flatpak update` is the real update path.

Start does not assume that name for an installed app. It reads the deployment's own `origin` remote
and compares that remote's commit, so a copy installed from `suite-local` is not measured against the
public `suite` store. A fresh install probes `suite` first, then `suite-local`. When the origin offers
a different commit the card says `update available`, and **Update** asks Flatpak to replace the
deployment.

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
service (`org.freedesktop.Flatpak`, used through `flatpak-spawn --host`), the applications and icons
under `xdg-data`, `xdg-data/suite`, `xdg-config/suite`, and the documents tree read-only. The host
service is effectively host command execution: that is the trade that lets a sandboxed hub run the
host's `flatpak` and manage deployments. It never writes a document.

When Flatpak deploys the hub, its own row says `Flatpak` and offers **Update Start**. Flatpak replaces
the deployment, and the new build starts next launch.

**OSTree owns updates inside Flatpak.** The sandbox sets `FLATPAK_ID`, and Canvas, Planner and Budget
then skip their own update check and write a "not checked" report instead of offering a download.
`flatpak update` replaces the deployment, and Start's card asks Flatpak for the update. There is no
second copy or rollback version for Start to keep.

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
rule the gate uses. With `--publish` it runs `flatpak build-update-repo --gpg-sign=<store key>` on
`~/suite-flatpak/repo`, verifies the fresh summary in a throwaway Flatpak installation, writes
`~/suite-flatpak/suite.flatpakrepo`, and rsyncs the repository to `suite-dev:/home/aurora/flatpak/repo`.
It publishes the repository the local flow builds; it never builds a second one. Publication copies
bytes and commits nothing, so the gate proof stays on HEAD.

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
above needs no branch. Publishing a tier writes the same repository on branch `slop`, `canary` or
`beta`; the default branch stays `master`, so adding a tier does not change what a stable install
resolves to. Install a tier explicitly:

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
`suite://`; stable keeps both. The pre-release `suite.app.json` gets the id `slop-<app>` and no file
extensions. An installed build whose manifest still carries the older `slop.<app>` id is read as a
pre-release too; nothing writes that form any more. The packaging script also writes a
`suite.channel.json` beside it; no app reads that file yet, so the id is what carries the pre-release
identity.

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
deployment whose origin offers a different commit. Start reads the commits and never writes a
deployment itself. The signed local store has been exercised end to end: a second published commit
turns the card into `update available`, and **Update** returns it to `Flatpak` with the new commit
deployed.

`XDG_DATA_HOME` decides which Flatpak installation is visible. A tool that points it at a per-session
directory, such as Orca, hides the real user installation; run with
`XDG_DATA_HOME=$HOME/.local/share` to see it.

## Relay tarball

`suite-sync` is a server binary, not an app: it has no Electron shell, no Flatpak and no update feed.
It ships as `suite-sync-<version>-<arch>.tar.gz` on `sync-v<version>`, with a `SHA256SUMS` list signed
by the update key. The tarball carries the CLI, its JavaScript dependencies and a launcher, but not a
Node runtime; the launcher needs Node.js 22 or later on the host.

Suite Start supervises a relay it finds through `SUITE_SYNC_BIN` or `PATH`; it never updates one. The
download, checksum and signature checks are in
[Leave a relay running](../../apps/sync/docs/how-to/relay.md#1-install-the-relay).

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

## Signing

The Flatpak store key signs the OSTree summary; `flatpak install` and `flatpak update` verify the
summary and every object's content hash against the public half in the `.flatpakrepo`. The relay's
update key signs `SHA256SUMS`, and a person verifies it before installing the tree. The two keys are
separate and rotate separately. [Manage signing keys](../how-to/keys.md) owns the procedures.
