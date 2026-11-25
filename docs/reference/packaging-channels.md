# Packaging channels

Linux desktop apps in the suite ship as Flatpaks. Suite Go ships as a release-signed Android APK on
four channels. `run.suite.sync` was the last relay Flatpak: it had a tray app for a desktop and the
same app's CLI for a machine with no display, and it is retired as a shipped artifact (#315). The forms
differ in **who owns the installed files**, and that decides who may update them.

| Form | Built for | Who owns the files | Updates arrive by | Root |
| --- | --- | --- | --- | --- |
| Flatpak | Suite Desk, Canvas, Planner, Budget and Help | Flatpak, inside a sandbox | an OSTree remote | no for `--user` |
| Release APK | Suite Go | the person, through `adb` or the file manager | the person installs the next APK | no |

There is no AppImage, Arch package, `deb`, `rpm` or `snap`. Help is a Flatpak like the rest, and Suite
Go has no Play Store listing.

Canvas, Planner, Budget and Help are **frozen legacy apps**: their code and last Flatpak artifact stay
available, but they get no new release and no new pre-release channel until they become packs. Suite
Desk and Suite Go are the superapp; [Channels](../explanation/channels.md) owns the model and
[Status](status.md) lists which rows are frozen. Sync is **retired**, not frozen: its code stays as
the protocol, client library and relay implementation, and the signed remote keeps the last published
`run.suite.sync` ref without publishing a new one.

The release channels a build can carry, and what each promises, are [Channels](../explanation/channels.md).

## The rule

**Flatpak owns a Flatpak deployment; the host owns its packs.**

The frozen apps and the host are Flatpaks. Flatpak installs, updates and removes them, and no Suite
process writes into a deployment or replaces it. A person uses the one `flatpak install` line the
release page prints, and `flatpak update --user` for every installed ref.

The host is a different writer for packs. It verifies a signed `.suitepack`, extracts it under its own
data directory, and keeps the old version until a person removes it. That is the pack lifecycle, not
a second Flatpak manager.

## Flatpak

Suite Desk, Canvas, Planner, Budget and Help each have a manifest beside the others. The retired
`run.suite.sync` keeps its manifest too, so the last build can still be reproduced from the tree:

```
packaging/flatpak/run.suite.canvas.yml
packaging/flatpak/run.suite.planner.yml
packaging/flatpak/run.suite.budget.yml
packaging/flatpak/run.suite.help.yml
packaging/flatpak/run.suite.shell.yml
packaging/flatpak/run.suite.sync.yml
```

The manifest packages the unpacked build `package:dir` produced, using zypak from
`org.electronjs.Electron2.BaseApp`. The wrapper, `.desktop`, `.metainfo.xml` and hicolor icons live
beside the manifest.

The commit carries no build-only tools: the BaseApp's asar patchers
(`/bin/patch-desktop-filename` and `/bin/patch-electron-desktop-filename`) are cleaned from `/app`
because only `build-commands` ever runs them. It also carries one Chromium locale, `en-US.pak`.
Nothing in the tree has an i18n framework or a translated string, so electron-builder keeps only
`en-US` (`electronLanguages`) and drops the other 54 `locales/*.pak`, about 7.5 MiB per app.

```sh
node scripts/flatpak.mjs                       # Canvas: package, build, publish, install
node scripts/flatpak.mjs --app planner         # Planner, same path
node scripts/flatpak.mjs --app budget          # Budget, same path
node scripts/flatpak.mjs --app shell           # the host, same path
node scripts/flatpak.mjs --app help             # Help
node scripts/flatpak.mjs --app sync             # the retired relay build, local only
node scripts/flatpak.mjs --app planner --no-build   # reuse release/linux-unpacked
node scripts/flatpak.mjs --app shell --channel slop    # the slop id on branch slop
flatpak run run.suite.slop.shell
```

Canvas stays the default so an existing habit keeps working. The script exports to
`~/suite-flatpak/repo`, adds it as the user remote `suite-local`, and installs from that remote, so
`flatpak update` is the real update path.

A deployment updates from the remote it was installed from: Flatpak reads its own `origin`, so a copy
from `suite-local` is not measured against the public `suite` store. The host does not compare commits
or offer an update button; `flatpak update --user` is the path for every Flatpak.

A stable Canvas, Planner or Budget reaches one documents folder and nothing broader:

```
--filesystem=xdg-documents/Suite:create
```

Canvas writes `Documents/Suite/Canvas`, Planner writes `Documents/Suite/Planner` and Budget writes
`Documents/Suite/Budget`; `:create` lets a first launch make the folder. Canvas and Planner also have
`--share=network` because they sync a workspace with the other devices in it. Budget has no network
permission: it has no bank sync, no updater and no other client.

The last `run.suite.sync` build was the one app granted no documents folder at all. Its sandbox had
`--share=network` because it is the relay other devices connect to,
`--talk-name=org.kde.StatusNotifierWatcher` for its tray item, and one host path,
`--filesystem=xdg-config/autostart:create`, for the single autostart entry it wrote when a person
asked. Its store and certificate pair live in the app's own data directory. A host that runs the relay
keeps the same "no documents grant" rule.

The `.desktop` file is named for the Flatpak id, and each app's `desktopName` is that id, so Wayland
associates the window with the entry and keeps its icon. Planner and Budget follow that rule; Canvas's
shell still declares the older `suite-canvas.desktop` name. A frozen mini-app's pre-release session
build reuses the stable manifest's runtime but replaces its documents grant: the stable folder is
read-only, and it writes `Suite Slop`. The superapp has no documents grant at all, so its channel's
id and sandbox are what keep its data apart. Either way the generated files carry the channel's own
id, desktop entry, metainfo and icon names.

### The relay's last Flatpak

`node scripts/flatpak.mjs --app sync` builds `run.suite.sync` from the same unpacked tree and zypak
base. It is no longer published (#315); the signed remote keeps the last ref and the command is how a
contributor reproduces that build locally. The last app had two entry points inside the one sandbox:

```sh
flatpak run run.suite.sync                                  # tray app and window
flatpak run --command=suite-sync run.suite.sync serve …     # the relay without a window
```

The second is a launcher that runs the app's own binary with `ELECTRON_RUN_AS_NODE=1`, because the
base app carries no Node runtime. `scripts/flatpak.mjs` refuses `--channel` for Sync: it ships no
`suite.app.json`, and a channel would be a second mailbox on the same data. The tray is not the target
surface; the relay becomes a host capability, and [Decisions](decisions.md#retiring-the-sync-tray-app-315)
records the two shapes still owed.

### Suite Desk as a Flatpak

`node scripts/flatpak.mjs --app shell` builds `run.suite.shell` as **Suite Desk**, from the same unpacked
tree and zypak base. Its sandbox is the narrow one: `--share=ipc`, `--share=network`, Wayland with an
X11 fallback, and `--device=dri`. The network namespace is there because a pack with the `network`
capability runs inside the host's sandbox; the per-pack session policy and that capability still
decide whether a pack may reach HTTPS or WSS. It has no `--talk-name=org.freedesktop.Flatpak` and no
host filesystem grant, because the host is not the package manager: it installs packs into its own
data directory, `~/.var/app/run.suite.shell`, and the picker and links go through the document and
desktop portals.
Its desktop entry claims `x-scheme-handler/suite`, and the app claims the scheme at runtime, so a
`suite://` link reaches the host after Start's retirement. The host has no `suite.app.json`, so a
pre-release is generated by rewriting this manifest rather than reading a second one; `--channel` is
accepted for Suite Desk, as [Pre-release channels](#pre-release-channels) describes.

```sh
flatpak install --user suite run.suite.shell
```

**OSTree owns updates inside Flatpak.** The sandbox sets `FLATPAK_ID`, and Canvas, Planner and Budget
then skip their own update check and write a "not checked" report instead of offering a download.
`flatpak update` replaces the deployment. There is no second copy or rollback version.

`scripts/store-key.sh` makes the store's signing key once. When it has run, `flatpak.mjs` signs the
repository summary, exports the public key beside the fingerprint in `~/suite-flatpak`, and adds the
remote with `--gpg-import`, so every later `flatpak install` and `flatpak update` verifies what it
downloads. A remote that an earlier run added unsigned is switched to verification on the next run.
Without a key the remote is added with `--no-gpg-verify`, which is for local testing only, and the
script says so.

### The signed remote

The same signed repository is published to the public store at
<https://flatpak.suite.run/>, so another machine installs and updates the host and the apps without
building them. The store is a private S3 bucket read through CloudFront with an ACM certificate; DNS
is at Cloudflare. [`scripts/lib/flatpakRemote.mjs`](../../scripts/lib/flatpakRemote.mjs) owns the URL,
the S3 cache classes and the invalidation paths.

`node scripts/flatpak-remote.mjs` is a dry run. It prints the branch, the refs and the bytes it would
publish, and refuses a dirty tree or a HEAD that `.dev/gate-status.json` does not prove, with the same
rule the gate uses. With `--publish` it first merges the refs already on the bucket, then runs
`flatpak build-update-repo --generate-static-deltas --gpg-sign=<store key>` on
`~/suite-flatpak/repo`, verifies the fresh summary in a throwaway Flatpak installation, writes
`~/suite-flatpak/suite.flatpakrepo`, and publishes the same bytes. It never builds a second
repository. Publication copies bytes and commits nothing, so the gate proof stays on HEAD. The merge
is [one summary names every channel](#one-summary-names-every-channel).

Both `flatpak.mjs` and the publisher pass `--generate-static-deltas`, so `~/suite-flatpak/repo`
carries a `deltas/` tree and its `delta-indexes/`: an update from one build to the next downloads the
objects that changed instead of the whole ref. A delta is named for the pair of commits it joins and
an index for the commit it describes, so a name never describes different bytes, and a client asks
for the index before the superblock. Deltas for the `Debug` runtime are skipped
(`--static-delta-ignore-ref=run.suite.*.Debug`, matched against the ref's app id): it is `autodelete`
and `no-autodownload`, so no client ever fetches one.

The public store is the path a person installs from:

```sh
node scripts/flatpak-remote.mjs --target s3              # dry run: every aws command
node scripts/flatpak-remote.mjs --target s3 --publish    # upload, then invalidate CloudFront
```

`--target s3` needs `SUITE_FLATPAK_S3_BUCKET` and `SUITE_FLATPAK_CLOUDFRONT_DISTRIBUTION` (or
`--bucket` and `--distribution`), and `--publish` also needs the `aws` CLI on `PATH`; it refuses
without them. The upload syncs `objects/`, `refs/`, `summaries/`, `deltas/` and `delta-indexes/` with
`Cache-Control: public,max-age=31536000,immutable`, and copies `summary`, `summary.sig`,
`summary.idx`, `summary.idx.sig` and `suite.flatpakrepo` with `Cache-Control: no-cache`. The object
trees never pass `--delete`: OSTree objects, static deltas and delta indexes are content-addressed, so
an old one is harmless and a client may still be fetching it. `summaries/` is the cached-summary tree
an OSTree client fetches after reading `summary.idx`; publishing the index without it fails the client
with a 403. After the upload it invalidates those five summary paths, because they are the only names
that change between publications; a new delta is a new path, so nothing invalidates it.

### One summary names every channel

The public remote is one OSTree repository and one `summary`, and every channel writes it. A
publication therefore does not sign from the local repository alone: with `--target s3 --publish` it
first copies `refs/` and the metadata subset of `objects/` (`*.commit`, `*.commitmeta`,
`*.commitmeta2`, `*.dirtree`, `*.dirmeta`) from the bucket into the repository `flatpak.mjs` built,
then signs a summary naming every ref the refs tree holds. The refs this build made are written back
after the copy, so the merge cannot replace the branch being published with the previous commit; the
signed summary names the new build. The refs this run did not build are its **foreign refs**; a
nightly publication keeps stable and preview this way instead of replacing them.

After signing, the publisher reads the refs the new summary advertises and refuses to upload when a
merged ref is missing. A summary that omits a ref hides an install whose ref and objects are still in
the bucket even though nothing else is wrong. A first publication has no refs to merge, and
`--no-merge-published` is the deliberate override for a bucket whose refs should go away; a normal
channel publication never needs it.

When a foreign ref exists, `flatpak build-update-repo` runs with `--no-update-appstream`: the foreign
tree is not local, so appstream cannot be regenerated, and the `appstream` ref merged from the bucket
is preserved rather than replaced. A newly published channel is therefore not in the appstream
metadata a software centre shows until a later publication regenerates it; `flatpak install` and
`flatpak update` read the signed summary, so the channel still installs and updates. Static deltas are
skipped for each foreign app id (`--static-delta-ignore-ref=<app-id>`), because a delta needs the tree
this run did not build.

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

The host and the stable apps are on `master`, which the file names as `DefaultBranch`, so the command
above needs no branch. Publishing a pre-release channel writes the same repository on branch `slop`,
`nightly` or `preview`; the default branch stays `master`, so adding a channel does not change what a
stable install resolves to. Install a pre-release explicitly:

```sh
flatpak install --user suite run.suite.nightly.shell//nightly
```

`flatpak remote-ls suite` lists the stable refs and every pre-release branch the remote carries. The
script refuses a branch the repository does not carry instead of inventing one.

### Pre-release channels

Stable keeps `run.suite.<app>`; each pre-release channel has an id of its own:
`run.suite.slop.<app>`, `run.suite.nightly.<app>` or `run.suite.preview.<app>`, on the branch of the
same name. The id and the branch both name the channel, so stable, slop, nightly and preview are four
installs with four data roots, and each can be installed and updated beside the others. Slop keeps
the id it has always had; nightly and preview moved from the shared `run.suite.slop` id, so a nightly
or preview install made before the change reinstalls once under the new id. No pre-release data is
migrated: the new id starts with an empty data root.

```sh
node scripts/flatpak.mjs --app shell --channel nightly
flatpak install --user suite-local run.suite.nightly.shell//nightly
flatpak run run.suite.nightly.shell
```

`--channel` accepts `slop`, `nightly` or `preview`; `canary`, `beta` and anything else is refused
before the build. A pre-release branch is not published for a frozen legacy app (Canvas, Planner,
Budget or Help), and the builder refuses to create one unless `--session` names a factory session
build, which is local only. Suite Desk carries a channel too: `run.suite.<channel>.shell` on the same
three branches, with its data in the channel's Flatpak sandbox rather than a `Documents/Suite Slop`
folder. Sync refuses `--channel`: it is not a superapp.

The generated manifest uses `run.suite.<channel>.<app>` for the app id, command, desktop file and
icon name, and `NoDisplay=false` keeps the card visible beside stable. Its desktop entry carries **no**
`MimeType` line and **no** `x-scheme-handler/*`, so it registers neither the stable documents nor
`suite://`; stable keeps both. A frozen mini-app's pre-release `suite.app.json` keeps the `slop-<app>`
id and no file extensions, because those apps classify exactly that marker as a pre-release; the
superapp ships no `suite.app.json` at all. An installed build whose manifest still carries the older
`slop.<app>` id is read as a pre-release too; nothing writes that form any more. The packaging script
also writes a `suite.channel.json` beside it; no app reads that file yet, so the id is what carries
the pre-release identity.

The public store is HTTPS: CloudFront serves the private bucket through an ACM certificate, so the
first fetch of `suite.flatpakrepo` and every later object is protected in transit. The local test
remote is plain HTTP because no certificate exists on `suite-dev`; a machine on the lab network can
read that traffic, deny service or stall an update. Neither transport can substitute software: the
summary is GPG-signed with the store key, and every object is named by a content hash inside the
signed summary. On the local test remote the first fetch of `suite.flatpakrepo` is the one unprotected
step, because it carries the public key an attacker on the path could replace. Treat it as a lab
store, and compare its `GPGKey` with `~/suite-flatpak/suite-store.gpg` on the publisher when the
network is not trusted.

The signed local store has been exercised end to end: a second published commit is what
`flatpak update --user` deploys. No Suite process reads or writes a deployment to decide that.

`XDG_DATA_HOME` decides which Flatpak installation is visible. A tool that points it at a per-session
directory, such as Orca, hides the real user installation; run with
`XDG_DATA_HOME=$HOME/.local/share` to see it.

## The relay

The relay is no longer a shipped app (#315). `run.suite.sync` stopped being the install path: no new
build is published, the signed remote keeps the last published ref for a person who already has it,
and the tray app is not the target surface. `apps/sync` stays in the tree as the protocol, the client
library and the relay implementation, and its gate row still runs.

The last published app had two entry points, and the headless one is what a relay operator still uses
from it:

- **The tray app.** `flatpak run run.suite.sync` kept an embedded relay serving while its window was
  hidden. It showed the address, the relay code and the certificate fingerprint, started and stopped
  the relay, and could write the one autostart entry that starts it at login. That surface is retired;
  the host's tray absorbs its states and controls, and the host's shape for the relay is still owed
  ([Decisions](decisions.md#retiring-the-sync-tray-app-315)).
- **The headless CLI.** `flatpak run --command=suite-sync run.suite.sync serve …` is the same relay
  without a window, for a machine that has no desktop. The launcher runs the app's binary with
  `ELECTRON_RUN_AS_NODE=1`, because the Flatpak base carries no Node runtime.

[Leave a relay running](../../apps/sync/docs/how-to/relay.md) is the operation guide. A relay's reach
was a stored choice in the app: loopback by default, the machine's tailnet when Tailscale is running,
or the whole network after a confirmation. `SUITE_SYNC_BIND` overrides the bind for a test or a host
unit. The host seam that owns the relay decides how that choice is stored and shown next.

A contributor can still reproduce the last build from a checkout: `node scripts/flatpak.mjs --app sync`
publishes it to `suite-local` and installs it from there. That is a local check of the last artifact,
not a release path. The `sync-v<version>` tarball releases are retired too: they remain downloadable
history, and nothing in this repository builds, signs or documents one as an install path any more.

## Android APK

Suite Go ships as an APK attached to the rolling `suite-YYYY.MM.DD` release, in the same four
channels as the desktop superapp. It is an `assembleRelease` build signed by the Suite Android
release key, not by a build machine's debug keystore. There is no Play Store listing.

| Channel | Asset | Package id |
| --- | --- | --- |
| `stable` | `suite-go-<version>.apk` | `run.suite.go` |
| `slop` | `suite-go-slop-<version>.apk` | `run.suite.slop.go` |
| `nightly` | `suite-go-nightly-<version>.apk` | `run.suite.nightly.go` |
| `preview` | `suite-go-preview-<version>.apk` | `run.suite.preview.go` |

Every asset has a `.sha256` beside it. Stable also uploads the same bytes as `suite-go.apk`, the
stable name [Suite Go's README](../../apps/go/README.md#install-the-apk) links through
`releases/latest`; the versioned asset stays canonical. A pre-release has no stable alias, so a
channel download cannot be mistaken for the stable one.

Every channel is a package id with its own data tree, so stable, slop, nightly and preview install and
update side by side. Nightly and preview moved from the shared `run.suite.slop.go` id, so an install
made before the change reinstalls once under the new id; no app data is migrated. The channel is in
the display and version name, so a person can tell the installed build apart.

`versionCode` is derived from the one number in `apps/go/app.config.json`; the rule and the identity
table live in [Android](../../apps/go/docs/reference/android.md#the-four-channels).

```sh
mise exec -- pnpm android:key status                     # is the release key the pinned one?
mise exec -- node scripts/android-release.mjs             # stable, build and name the APK
mise exec -- node scripts/android-release.mjs --channel slop
mise exec -- node scripts/android-release.mjs --publish   # attach it to the rolling release
```

`scripts/android-release.mjs` builds, verifies the APK's certificate against the pinned fingerprint,
checks the package id and `versionCode` with `aapt`, then names and checksums the artifact. It
refuses a debug-signed or mislabelled APK, so a debug build is a dev-loop path and never a public
artifact. `--publish` attaches the asset to the rolling release while that release is a draft, after
`release-status.mjs --draft` has created it; `release-status.mjs --publish` then publishes the drafts.
No device or emulator is involved.

The keystore, its password file, the fingerprint pin and the rotation order are in [Android
notes](../../apps/go/docs/reference/android.md#release-signing-and-channels) and [Manage signing
keys](../how-to/keys.md#android-release-keystore).

## Pre-release documents

A pre-release install is its own identity, not a second window on the stable data. Stable Desk keeps
`~/.var/app/run.suite.shell`; each pre-release channel keeps its own sandbox, so a preview build
cannot open slop data. Stable Go keeps its app data under `run.suite.go`, and each pre-release
package id has its own.

A frozen mini-app is the exception, because its pre-release build is a local factory session rather
than a shipped channel: it keeps `Documents/Suite Slop/<App>` while stable keeps
`Documents/Suite/<App>`. A stable document handed to it by a path, a link, or a file manager is
copied into that folder and the copy is opened, so the stable file, its backup and its temporary file
are never written. Export is explicit, writes where the person chooses, and refuses the stable
folder. The rule is in [Canvas's paths](../../apps/canvas/desktop/src/main/paths.ts),
[Planner's workspace location](../../apps/planner/src/main/workspaceLocation.ts) and
[Budget's library](../../apps/budget/src/main/library.ts), with tests beside each.

## Packs and cards

Canvas, Planner, Budget and Help build as signed `.suitepack` archives, and the release index job
stages all four. Each manifest declares `"platforms": ["desktop", "mobile"]`: the desktop build is
unchanged, and Suite Go serves `documents`, `files`, `storage`, `recents`, `notifications` and
`network`, so all four packs are available there. Help asks for no capability and is available
immediately. The host's catalogue is what refuses an uninstallable pack, and its sentence names the
missing capability.

A pack build also writes a **card sidecar** beside the archive:

```
packs/canvas-0.1.13.suitepack
packs/canvas-0.1.13.card.json
```

The card URL is the archive URL with `.suitepack` replaced by `.card.json`, in the same `/packs/`
directory. The signed `index.json` entry does **not** gain a field for it: a stable host with the
strict entry parser keeps reading the index, and a host that has verified an entry can derive the
card URL and fetch it for an uninstalled shadow tile without downloading the archive.

The card is one JSON object, format `suite.pack.card`, version `1`:

| Field | What it is |
| --- | --- |
| `format`, `version` | `"suite.pack.card"` and the card format version, `1`. |
| `id`, `packVersion` | The pack id and the archive version the card describes. |
| `name`, `description` | The catalogue name and the manifest's one-line description. |
| `shelf` | The suite Home order: Canvas 1, Planner 2, Budget 3, Help 4. |
| `icon` | A base64 `data:image/svg+xml` or `data:image/png` URI. |

Canvas, Planner and Budget use the glyph their `AppMark` already draws; Help uses the headset in its
own `resources/icon.svg`. `@suite/pack` owns the card shape, parser and URL helper, so the phone
reads the same contract as the release build. A card is presentation only and is not signed. The
archive's publisher signature and file hashes remain the proof, and the catalogue entry is what a
host verifies before it offers an install. `scripts/release-index.mjs` uploads every archive, then
its card, then the detached index signature, and writes `index.json` last; a build whose archive has
no card fails before anything is published.

## Platforms

Linux is the only desktop platform with published builds. Android has release-signed APKs on the
rolling release. macOS and Windows are configured but have no signing identity, so there is nothing
to download. A pack's `platforms` declaration is what a host compares with its own kind and served
capabilities; it does not create a build that does not exist.

## Signing

The Flatpak store key signs the OSTree summary; `flatpak install` and `flatpak update` verify the
summary and every object's content hash against the public half in the `.flatpakrepo`. The Android
release certificate signs the APKs, and Android compares it with the installed app's certificate
before accepting an update. The relay's update key signed the retired tarball's `SHA256SUMS` and now
signs nothing the suite ships; the key and its pin are kept until they are retired deliberately.
[Manage signing keys](../how-to/keys.md) owns the procedures.
