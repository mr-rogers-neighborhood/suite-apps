# Packaging channels

Linux desktop apps in the suite ship as Flatpaks. Suite Go ships as a debug-signed Android APK. The
relay is one of the Flatpaks: `run.suite.sync` has a tray app for a desktop and the same app's CLI for
a machine with no display. The forms differ in **who owns the installed files**, and that decides who
may update them.

| Form | Built for | Who owns the files | Updates arrive by | Root |
| --- | --- | --- | --- | --- |
| Flatpak | Canvas, Planner, Budget, Help, the hub and Sync | Flatpak, inside a sandbox | an OSTree remote | no for `--user` |
| Debug APK | Suite Go | the person, through `adb` or the file manager | the person installs the next APK | no |
| Relay tarball (retiring) | `suite-sync` on a host without Flatpak | the person, under `/opt` | the person replaces the tree | yes |

There is no AppImage, Arch package, `deb`, `rpm` or `snap`. Help is a Flatpak like the rest, Sync is an
app the hub lists like the rest, and Suite Go has no Play Store listing.

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

Canvas, Planner, Budget, Help, the hub and Sync each have a manifest beside the others:

```
packaging/flatpak/run.suite.canvas.yml
packaging/flatpak/run.suite.planner.yml
packaging/flatpak/run.suite.budget.yml
packaging/flatpak/run.suite.help.yml
packaging/flatpak/run.suite.start.yml
packaging/flatpak/run.suite.sync.yml
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
node scripts/flatpak.mjs --app sync             # the relay: tray app and headless CLI
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

Sync is the one app granted no documents folder at all. Its sandbox has `--share=network` because it
is the relay other devices connect to, `--talk-name=org.kde.StatusNotifierWatcher` for its tray item,
and one host path, `--filesystem=xdg-config/autostart:create`, for the single autostart entry it
writes when a person asks. Its store and certificate pair live in the app's own data directory.

The `.desktop` file is named for the Flatpak id, and each app's `desktopName` is that id, so Wayland
associates the window with the entry and keeps its icon. Planner, Budget and Sync follow that rule;
Canvas's shell still declares the older `suite-canvas.desktop` name. A pre-release reuses the stable
manifest's runtime but replaces its documents grant: the stable folder is read-only, and the
pre-release writes `Suite Slop`. It generates its own id, desktop entry, metainfo and icon names.

### The relay as a Flatpak

`node scripts/flatpak.mjs --app sync` builds `run.suite.sync` from the same unpacked tree and zypak
base. The app has two entry points and both are inside the one sandbox:

```sh
flatpak run run.suite.sync                                  # tray app and window
flatpak run --command=suite-sync run.suite.sync serve …     # the relay without a window
```

The second is a launcher that runs the app's own binary with `ELECTRON_RUN_AS_NODE=1`, because the
base app carries no Node runtime. `scripts/flatpak.mjs` refuses `--channel` for Sync: it ships no
`suite.app.json`, and a tier would be a second mailbox on the same data.

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

### The signed remote

The same signed repository is published to the public store at
<https://flatpak.suite.run/>, so another machine installs and updates the apps and the hub without
building them. The store is a private S3 bucket read through CloudFront with an ACM certificate; DNS
is at Cloudflare. [`scripts/lib/flatpakRemote.mjs`](../../scripts/lib/flatpakRemote.mjs) owns the URL,
the S3 cache classes and the invalidation paths.

`node scripts/flatpak-remote.mjs` is a dry run. It prints the branch, the refs and the bytes it would
publish, and refuses a dirty tree or a HEAD that `.dev/gate-status.json` does not prove, with the same
rule the gate uses. With `--publish` it runs `flatpak build-update-repo --gpg-sign=<store key>` on
`~/suite-flatpak/repo`, verifies the fresh summary in a throwaway Flatpak installation, writes
`~/suite-flatpak/suite.flatpakrepo`, and publishes the same bytes. It never builds a second
repository. Publication copies bytes and commits nothing, so the gate proof stays on HEAD.

The public store is the path a person installs from:

```sh
node scripts/flatpak-remote.mjs --target s3              # dry run: every aws command
node scripts/flatpak-remote.mjs --target s3 --publish    # upload, then invalidate CloudFront
```

`--target s3` needs `SUITE_FLATPAK_S3_BUCKET` and `SUITE_FLATPAK_CLOUDFRONT_DISTRIBUTION` (or
`--bucket` and `--distribution`), and `--publish` also needs the `aws` CLI on `PATH`; it refuses
without them. The upload syncs `objects/`, `refs/` and `summaries/` with
`Cache-Control: public,max-age=31536000,immutable`, and copies `summary`, `summary.sig`,
`summary.idx`, `summary.idx.sig` and `suite.flatpakrepo` with `Cache-Control: no-cache`. The object
trees never pass `--delete`: OSTree objects are content-addressed, so an old object is harmless and a
client may still be fetching it. `summaries/` is the cached-summary tree an OSTree client fetches
after reading `summary.idx`; publishing the index without it fails the client with a 403. After the
upload it invalidates those five summary paths, because they are the only names that change between
publications.

`suite-dev` stays the local test remote, at:

```
http://10.28.20.200:8088/
```

```sh
node scripts/flatpak-remote.mjs --target lan --publish
```

That path rsyncs the repository to `suite-dev:/home/aurora/flatpak/repo`. The host runs
`suite-flatpak-http.service`, a systemd user unit whose source is
[`scripts/suite-flatpak-http.service`](../../scripts/suite-flatpak-http.service). It serves only that
directory, on port 8088, and nothing else on the host uses either. `loginctl enable-linger` keeps the
user manager — and with it the unit — alive between SSH sessions. The gate's transient `suite-gate-*`
units and `~/ci` are separate and untouched by a publication.

Add the public remote and install:

```sh
flatpak remote-add --user --if-not-exists --from suite \
  https://flatpak.suite.run/suite.flatpakrepo
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

The public store is HTTPS: CloudFront serves the private bucket through an ACM certificate, so the
first fetch of `suite.flatpakrepo` and every later object is protected in transit. The local test
remote is plain HTTP because no certificate exists on `suite-dev`; a machine on the lab network can
read that traffic, deny service or stall an update. Neither transport can substitute software: the
summary is GPG-signed with the store key, and every object is named by a content hash inside the
signed summary. On the local test remote the first fetch of `suite.flatpakrepo` is the one unprotected
step, because it carries the public key an attacker on the path could replace. Treat it as a lab
store, and compare its `GPGKey` with `~/suite-flatpak/suite-store.gpg` on the publisher when the
network is not trusted.

Start lists Flatpak installs, including its own deployment, launches them through `flatpak run`, asks
Flatpak to remove one, and — when the store offers the app — asks Flatpak to install it or to replace a
deployment whose origin offers a different commit. Start reads the commits and never writes a
deployment itself. The signed local store has been exercised end to end: a second published commit
turns the card into `update available`, and **Update** returns it to `Flatpak` with the new commit
deployed.

`XDG_DATA_HOME` decides which Flatpak installation is visible. A tool that points it at a per-session
directory, such as Orca, hides the real user installation; run with
`XDG_DATA_HOME=$HOME/.local/share` to see it.

## The relay

`run.suite.sync` is the install path for the relay. It is a Flatpak like the apps, and it has two
entry points:
- **The tray app.** `flatpak run run.suite.sync` keeps an embedded relay serving while its window is
  hidden. It shows the address, the relay code and the certificate fingerprint, starts and stops the
  relay, and can write the one autostart entry that starts it at login. The store lives in the app's
  own data directory, `~/.var/app/run.suite.sync/data/suite-sync`.

  Who can reach it is a stored choice: loopback by default, the machine's tailnet when Tailscale is
  running, or the whole network after a confirmation in the window. The manifest needs no grant for
  the wider two — `--share=network` already shares the host's network namespace, which is also what
  makes `tailscale0` visible. The choice is `$XDG_CONFIG_HOME/suite-sync/relay.json` in the app's own
  config; `SUITE_SYNC_BIND` overrides the bind for a test or a host unit.
- **The headless CLI.** `flatpak run --command=suite-sync run.suite.sync serve …` is the same relay
  without a window, for a machine that has no desktop. The launcher runs the app's binary with
  `ELECTRON_RUN_AS_NODE=1`, because the Flatpak base carries no Node runtime.

[Leave a relay running](../../apps/sync/docs/how-to/relay.md) is the install and operation guide.

Today it is installed from a checkout: `node scripts/flatpak.mjs --app sync` publishes it to
`suite-local` and installs it. The public store does not carry `run.suite.sync` yet — it joins the
store with the release that publishes the app — so `flatpak install --user suite run.suite.sync` is
the command from that release on, not before. Every other sentence here about how the relay is
installed, run and updated is true of the local build now.

`suite-sync-<version>-<arch>.tar.gz` on `sync-v<version>` still exists: a tarball with the CLI, its
JavaScript dependencies and a launcher, but not a Node runtime, plus a `SHA256SUMS` list signed by the
update key. It is for a host without Flatpak. The release script still builds and signs it; removing it
from `scripts/release.mjs` is a separate change that has not landed. Nothing in the docs above makes a
new install use it.

Suite Start supervises a relay it finds through `SUITE_SYNC_BIN` or `PATH`; it never updates one, and a
Flatpak install is neither, so Start reports no relay and stays a launcher. Each device enters the
address and pin the app shows.

## Android APK

Suite Go ships as `suite-go-<version>.apk` on the rolling `suite-YYYY.MM.DD` release, with
`suite-go-<version>.apk.sha256` beside it. It is an `assembleDebug` build of the committed Android
project: the debug keystore signs it, no release signing key exists, and there is no Play Store
channel.

The debug signature belongs to the machine that built it, so an APK from another machine is a
different signer; changing machines means `adb uninstall run.suite.go` once before installing.
`scripts/android-release.mjs` builds, names and checksums the artifact, and `--publish` attaches both
files to the rolling release after `release-status.mjs --publish` has created it. It also uploads the
same bytes as `suite-go.apk`, the stable name
[Suite Go's README](../../apps/go/README.md#install-the-apk) links through `releases/latest`; the
versioned asset stays canonical, and that README owns the sideload line and what debug-signed means.

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

Linux is the only desktop platform with published builds. Android has a debug-signed APK on the
rolling release. macOS and Windows are configured but have no signing identity, so there is nothing
to download.

## Signing

The Flatpak store key signs the OSTree summary; `flatpak install` and `flatpak update` verify the
summary and every object's content hash against the public half in the `.flatpakrepo`. The relay's
update key still signs the retiring tarball's `SHA256SUMS`, and a person verifies it before installing
that tree. The two keys are separate and rotate separately. [Manage signing
keys](../how-to/keys.md) owns the procedures.
