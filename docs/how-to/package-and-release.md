# Package and release

The suite has one repository and two artifact forms: Flatpaks for Linux desktop apps — the relay is
one of them — and a release-signed APK for Suite Go. Each app keeps its own version and release notes;
the root owns the gate and the publishing paths.

## What a release is

A desktop release is a Flatpak deployment on the signed OSTree remote, built from a commit the gate
has proven, with a changelog section for the version in the app's `CHANGELOG.md`. Suite Go's release
is a release-signed APK attached to the rolling Suite release, on the stable or a pre-release
channel. The relay is a Flatpak on the same remote as the other desktop apps; it has no separate
artifact.

There is no app update feed, AppImage, Arch package or second copy to roll back to. For the desktop
apps, Flatpak owns the deployment and the remote is the update channel.

## Desktop apps

Run the local build first:

```sh
node scripts/flatpak.mjs --app planner
```

That builds the unpacked tree, exports it to `~/suite-flatpak/repo`, signs the repository summary with
the store key, adds the remote and installs. The export also writes static deltas
(`--generate-static-deltas`), so an update from the previous build fetches the objects that changed
rather than the whole ref. `--no-build` reuses `release/linux-unpacked`; `--no-install` publishes
without touching the client.

Publish the same repository. The public store is the path people install from:

```sh
node scripts/flatpak-remote.mjs --target s3              # dry run: every aws command
node scripts/flatpak-remote.mjs --target s3 --publish    # upload, then invalidate CloudFront
```

`--target s3` reads `SUITE_FLATPAK_S3_BUCKET` and `SUITE_FLATPAK_CLOUDFRONT_DISTRIBUTION` (or
`--bucket` and `--distribution`), and refuses to publish without them or when `aws` is not on `PATH`.
The dry run prints every `aws s3 sync`, `aws s3 cp` and `aws cloudfront create-invalidation` command
and runs none of them. Publication signs the summary, verifies it, writes the `.flatpakrepo`, then
uploads the same bytes; it never builds a second repository.

The cache rule follows from the names. The content-addressed trees (`objects/**`, `refs/**`,
`summaries/**`, `deltas/**`, `delta-indexes/**`) sync with
`Cache-Control: public,max-age=31536000,immutable` and no `--delete`, because an old object or delta
is harmless. The summary and the `.flatpakrepo` change on every publication, so they are copied with
`Cache-Control: no-cache` and CloudFront invalidates only those paths afterwards.
[`packaging-channels.md`](../reference/packaging-channels.md) names the files and the exact
invalidation paths.

`suite-dev` remains the local test remote, at `http://10.28.20.200:8088/`:

```sh
node scripts/flatpak-remote.mjs --target lan --publish
```

The publish refuses a dirty tree or a HEAD that `.dev/gate-status.json` does not prove. It publishes
the repository the local flow built; it never builds a second one. Publication copies bytes and
commits nothing, so the gate proof stays on HEAD.

## Pre-release channels

A pre-release is a build of the same app on the `slop`, `nightly` or `preview` branch. It is not a
second app: it shares `run.suite.slop.<app>` across the three channels and takes the channel as its
Flatpak branch. Stable keeps `run.suite.<app>`, so both can be installed at once. One pre-release
install at a time is the supported shape; moving channel replaces it.

```sh
node scripts/flatpak.mjs --app shell --channel slop
node scripts/flatpak-remote.mjs --target s3 --channel slop --publish
```

A frozen legacy mini-app (Canvas, Planner, Budget, Help) is refused here: it keeps its last stable ref
and gets no new pre-release. `--session` builds one locally for the factory profile, and that build is
never published.

The pre-release branch is published on the same signed remote; the stable refs are not rewritten. See
[Packaging channels](../reference/packaging-channels.md#pre-release-channels) for the identity and the
desktop-entry rule.

## GitHub releases

GitHub shows one "Latest" release per repository, so this repository has one rolling Suite release
tagged `suite-YYYY.MM.DD` and marked Latest. Its body has a Desktop table and a Mobile table, each
row naming the app's current version, its release date, a link to that app's own release and how it
installs — a `flatpak install` command for desktop, the APK asset for Suite Go. Per-app releases
(`start-v<version>`, `canvas-v<version>`, `go-v<version>`, `sync-v<version>`) stay as history and are
not marked Latest.

Both come from the versions already in the tree. The script reads `package.json` and the
`## [version] - YYYY-MM-DD` section of the changelog, refuses a version with no section or a date
that is not a real calendar day, and does nothing to GitHub unless `--publish` is passed. Pass one
of `--publish`, `--write` and `--dry-run`; they are modes, not flags to combine:

```sh
mise exec -- node scripts/release-status.mjs             # dry run: every command and body
mise exec -- node scripts/release-status.mjs --write     # refresh RELEASES.md only
mise exec -- node scripts/release-status.mjs --publish   # create or update the releases
```

A missing tag is created at the commit that added its changelog section; an existing tag is never
moved. Every per-app release is created when missing and edited in place when it exists; the artifact
itself already exists on the signed remote or on the rolling release.

[`RELEASES.md`](../../RELEASES.md) is the human mirror of the Latest release. It can be written
before publication, so a row whose release does not exist yet says **pending** instead of linking a
page that is not there; `--publish` rewrites the page with real links once the releases exist.
`--write` needs no tag plan, so a row whose tag or release cannot be resolved yet is written as
**pending** rather than stopping the refresh.

The signed Flatpak remote above remains the update path. Per-app releases carry no app binaries, and
GitHub Packages is not used for the Flatpaks.

## Release Suite Shell (the host)

Suite Shell is the desktop host and the first row of the rolling release's Desktop table. One command runs
its publish sequence in the order that keeps every artifact on a commit the gate proved:

```sh
mise exec -- node scripts/release-suite.mjs --publish                 # the public store
mise exec -- node scripts/release-suite.mjs --target lan --publish    # the suite-dev fallback
```

It runs, in order: `node scripts/gate.mjs --fresh`; `pnpm --filter @suite/shell package:dir`;
`node scripts/flatpak.mjs --app shell`; `node scripts/flatpak-remote.mjs --target s3|lan --publish`;
`node scripts/release-status.mjs --publish`; `node scripts/android-release.mjs --publish`; then
`node scripts/release-status.mjs --publish` again so the rolling body and `RELEASES.md` link the APK.

`--target s3` is the public store and the update path people install from; it reads its own bucket,
distribution and credentials inside `flatpak-remote.mjs`, and `release-suite.mjs` passes only the
target. `--target lan` publishes the same repository to the `suite-dev` test host, which is the
fallback when the store is not reachable. `--skip-gate` reuses the existing proof, and `--skip-apk`
leaves the APK steps out for a desktop-only release.

Without `--publish` the command is a dry run: it prints every step and passes `--publish` to no
child, so nothing is built, signed, uploaded or written. A publish refuses unless
`.dev/gate-status.json` names HEAD, says `ok`, came from a clean `--fresh` export and is not an
`--only` run. `--skip-gate` does not waive that rule; it only avoids running the gate again. The
sequence prints the install lines for `run.suite.shell` and the APK path and alias at the end.

## Suite Go (Android)

Suite Go's artifact is an APK on the rolling release, not on `go-v<version>`. It sits after the
release that will carry it:

```sh
mise exec -- node scripts/release-status.mjs --publish   # creates the rolling release
mise exec -- node scripts/android-release.mjs --publish  # builds and uploads the stable APK
mise exec -- node scripts/android-release.mjs --channel slop --publish
mise exec -- node scripts/release-status.mjs --publish   # relinks the body and RELEASES.md
```

The first command creates the rolling release with empty assets. Until the stable APK is uploaded,
the Go row names the file instead of linking it and the body says the asset is not attached; the
release script prints a non-fatal warning naming the upload command. Run
`release-status.mjs --publish` again after the upload so the GitHub body and `RELEASES.md` link the
download instead of describing it as missing.

`--channel` accepts `stable` (the default), `slop`, `nightly` and `preview`. The stable asset keeps
`suite-go-<version>.apk` and the `suite-go.apk` alias, so
`https://github.com/mrrnbhd/suite-apps/releases/latest/download/suite-go.apk` always
names the newest stable build. A pre-release is `suite-go-<channel>-<version>.apk` and has no stable
alias.

A release build is signed by the key at `~/.config/suite/keys/suite-go-release.jks`, and the script
verifies the APK's certificate against the pinned fingerprint before it uploads anything. `pnpm
android:key status` answers the same question by hand. The debug keystore is the dev loop only: it
is a different signer, so it cannot update a release install.
[Suite Go's README](../../apps/go/README.md#install-the-apk) owns the install path, and [Android
notes](../../apps/go/docs/reference/android.md#release-signing-and-channels) own the channels, the
`versionCode` rule and the keystore.

## The relay

The relay is a Flatpak like the apps, so it has no release of its own beyond the same signed remote:

```sh
node scripts/flatpak.mjs --app sync                    # package, sign, install locally
node scripts/flatpak-remote.mjs --target s3 --publish  # publish the shared repository
```

Its manifest is `packaging/flatpak/run.suite.sync.yml` and it refuses `--channel`: a channel would be a
second mailbox on the same data. The `sync-v<version>` tarball releases it used to ship are retired
and stay on GitHub as history only; [Leave a relay
running](../../apps/sync/docs/how-to/relay.md#building-and-publishing-a-release) has the build and
publish detail.

## What a publish refuses

The publish paths stop before copying or building when any of these is true, and print every reason
they found:

1. The tree has uncommitted changes.
2. The version in the app's `package.json` has no `## [version]` heading in its changelog.
3. `.dev/gate-status.json` does not name this commit, does not say `ok`, or came from a working-tree
   run rather than a clean export.

It does not bump a version and it does not read tags to guess one.

## Before you publish

```sh
mise exec -- node scripts/gate.mjs --fresh      # writes .dev/gate-status.json for this commit
mise exec -- node scripts/docs-check.mjs       # if docs changed
pnpm keys status                               # the publisher key matches the pin
node scripts/flatpak-remote.mjs --target s3     # a clean dry run
node scripts/flatpak-remote.mjs --target s3 --publish
```

Packaging is not proven until the built app runs. Install the Flatpak and open a document after the
release, not before the gate.

## Build without publishing

```sh
node scripts/flatpak.mjs --app start              # package, build, install locally
node scripts/flatpak.mjs --app planner --no-build # reuse the unpacked tree
```

Each app has its own packaging path inside the shared script. Run the owning app's gate first; the
Flatpak script does not run it.

## Version ownership

A version has one home: the app's entry `package.json`. Nothing else restates it — not this page, not
a README, not a tag name. The release path reads it, refuses a changelog without a section for it, and
stamps it into the artifact.

| What | Where the version lives | Its tag |
| --- | --- | --- |
| Start, Planner, Budget, Help | `apps/<app>/package.json` | `<app>-v<version>` |
| Canvas | `apps/canvas/desktop/package.json` | `canvas-v<version>` |
| The relay (`suite-sync`) | `apps/sync/package.json` | `sync-v<version>` |
| Suite Go | `apps/go/app.config.json` | `go-v<version>` |
| A shared package (`@suite/*`) | `packages/<name>/package.json` | none; consumed as `workspace:*` |

## Signing

The Flatpak store key signs the OSTree summary; the remote's `.flatpakrepo` carries its public half.
The relay's update key signed the retired tarball's `SHA256SUMS` and no longer signs anything the suite
ships; it and its pin are kept until they are retired deliberately. [Manage signing
keys](keys.md) owns both procedures.
