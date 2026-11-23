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
and runs none of them. A publication first merges the refs already on the bucket into the repository
it built, then signs a summary naming every channel, verifies it, writes the `.flatpakrepo`, and
uploads the same bytes; it never builds a second repository. A summary that lost a merged ref refuses
before any upload, and a first publication has nothing to merge.
[Packaging channels](../reference/packaging-channels.md#one-summary-names-every-channel) owns the
rule, the appstream caveat and `--no-merge-published`.

A pipeline that built the repository in an earlier step names it instead of relying on the default:

```sh
node scripts/flatpak-remote.mjs --target s3 \
  --from-repo "$SUITE_FLATPAK_REPO" \
  --commit-file .dev/release/flatpak-commits --publish
```

`--from-repo` falls back to `SUITE_FLATPAK_REPO` and then `~/suite-flatpak/repo`, so a run that
built the repository this time needs no extra flag. `--commit-file` is written after this run signs
the summary and before the upload: one `<commit>  <ref>` line for each app ref on the published
branch. The summary is re-signed by the publish, with the same key and the same semantics; the
commits are not rewritten, so attest the commit file rather than the signed summary. The file is
written before the upload starts, so a failed upload leaves behind the commits the run tried to ship.

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
that is not a real calendar day, and does nothing to GitHub by default. Pass one of `--draft`,
`--publish`, `--write` and `--dry-run`; they are modes, not flags to combine:

```sh
mise exec -- node scripts/release-status.mjs             # dry run: every command and body
mise exec -- node scripts/release-status.mjs --draft     # create or update the drafts
mise exec -- node scripts/release-status.mjs --publish   # publish the drafts, then write RELEASES.md
mise exec -- node scripts/release-status.mjs --write     # refresh RELEASES.md only
mise exec -- node scripts/release-status.mjs --draft --channel preview
                                                        # suite-preview-<date>, prerelease
mise exec -- node scripts/release-status.mjs --prune --channel nightly --keep 14
                                                        # delete older nightly releases
```

Stable publishes `suite-<date>` and is the repository's Latest release. A pre-release channel
publishes its own `suite-<channel>-<date>` release, marked *pre-release*; it never moves Latest, and
the stable release body links the newest preview and nightly pages.

Publication is two phases because a published GitHub release is immutable: its tag, assets and body
lock at publication. The order is draft → attach assets → publish.

1. `--draft` creates every per-app release and the rolling release as a draft, with its body and tag
   plan. Rerunning it updates the same drafts, so it is idempotent; an app whose current version is
   already published is skipped, not edited, and it never writes `RELEASES.md`.
2. Attach the artifacts the release carries while it is still a draft. For Suite Go that is
   `node scripts/android-release.mjs --upload <apk>`; `--publish` builds the APK and attaches it in
   one step.
3. `--publish` refreshes each draft body from the assets it now carries, publishes the drafts with
   `gh release edit --draft=false`, and writes `RELEASES.md` with real links.

`--publish` only flips drafts, so it cannot clobber a published asset or body. An app that is already
published is immutable and is skipped with a message naming it; the run continues for the others. A
version with no draft is refused instead, because publishing it would attach nothing: run `--draft`
first. `--publish` writes `RELEASES.md` from the state GitHub has after the run, so repeating it once
everything is out refreshes the page and changes nothing on GitHub.

There is one rolling release per date. A second publication on the same day needs `--date` with a new
day, because the earlier `suite-YYYY.MM.DD` tag is already published and cannot be reused.

A missing tag is created at the commit that added its changelog section; an existing tag is never
moved.

[`RELEASES.md`](../../RELEASES.md) is the human mirror of the Latest release. `--write` and
`--publish` write it; `--draft` does not. It can be written before publication, so a row whose release
is not published yet says **pending** instead of linking a page that is not there. `--write` needs no
tag plan, so a row whose tag or release cannot be resolved yet is written as **pending** rather than
stopping the refresh.

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
`node scripts/release-status.mjs --draft`; `node scripts/android-release.mjs --publish`, which attaches
the APK to those drafts; `node scripts/release-status.mjs --publish`, which publishes the drafts and
writes `RELEASES.md` with the APK link.

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

Suite Go's artifact is an APK on the rolling release, not on `go-v<version>`. The rolling release is
drafted first, the APK is attached to the draft, and only then is the release published:

```sh
mise exec -- node scripts/release-status.mjs --draft     # draft the rolling release
mise exec -- node scripts/android-release.mjs --publish  # build and attach the stable APK to the draft
mise exec -- node scripts/android-release.mjs --channel slop --publish
mise exec -- node scripts/release-status.mjs --publish   # publish the drafts and write RELEASES.md
```

The order is the point: an asset cannot be added after a release is published. Until the stable APK
is attached, the Go row names the file instead of linking it and the draft body says the APK is
attached during the same promotion. `--publish` re-renders the body from the draft's assets before it
flips the draft, so the published page links the download. Running `--draft` again after publication
skips the released page with a message rather than editing it.

`release-status.mjs` has no `--channel` input: the row always names the stable
`suite-go-<version>.apk`. A pre-release APK is an extra asset on the same rolling release and is not
the row's install link.

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

A pipeline that already built and attested the APK uploads those exact bytes with `--upload`:

```sh
mise exec -- node scripts/android-release.mjs --upload .dev/release/suite-go-0.1.0.apk --publish
mise exec -- node scripts/android-release.mjs --upload "$APK" --channel slop --publish
```

The upload path never runs Gradle and never reads the keystore. It checks the APK's certificate
against the pinned release certificate, reads the package id and version name from `aapt`, and
stages the same bytes under the asset name, writing the checksum into `apps/go/.dev/release`. A
stable APK names its own channel; a pre-release shares `run.suite.slop.go` across slop, nightly and
preview, so `--channel` is required and is checked against both the package id and the version name
suffix. Without `--publish` the command verifies the APK and prints the upload only, like the build
path.

An `--upload` publish needs a draft rolling release. A published release is refused because its
assets are locked; `--allow-published` is the explicit exception, and only for a repository that has
not enabled immutable releases. An unknown immutability state is refused rather than guessed. The
build path (`--publish` without `--upload`) still builds and uploads in one step for a workstation,
and re-hashes the staged APK immediately before the upload so the bytes sent are the bytes it
checked.

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
