# Package and release

The suite has one repository and two artifact forms: Flatpaks for Linux desktop apps and a tarball
for the relay. Each app keeps its own version and release notes; the root owns the gate and the two
publishing paths.

## What a release is

A desktop release is a Flatpak deployment on the signed OSTree remote, built from a commit the gate
has proven, with a changelog section for the version in the app's `CHANGELOG.md`. The relay release is
a tarball on `sync-v<version>` with a signed `SHA256SUMS`.

There is no app update feed, AppImage, Arch package or second copy to roll back to. Flatpak owns the
deployment and the remote is the update channel.

## Desktop apps

Run the local build first:

```sh
node scripts/flatpak.mjs --app planner
```

That builds the unpacked tree, exports it to `~/suite-flatpak/repo`, signs the repository summary with
the store key, adds the remote and installs. `--no-build` reuses `release/linux-unpacked`;
`--no-install` publishes without touching the client.

Publish to the shared remote:

```sh
node scripts/flatpak-remote.mjs                 # dry run: branch, refs and bytes
node scripts/flatpak-remote.mjs --publish       # sign, verify and copy to suite-dev
```

The publish refuses a dirty tree or a HEAD that `.dev/gate-status.json` does not prove. It publishes
the repository the local flow built; it never builds a second one. Publication copies bytes and
commits nothing, so the gate proof stays on HEAD.

## Pre-release tiers

A pre-release is a build of the same app on the `slop`, `canary` or `beta` branch. It is not a second
app: it shares `run.suite.slop.<app>` across the three tiers and takes the tier as its Flatpak branch.
Stable keeps `run.suite.<app>`, so both can be installed at once. One pre-release install at a time is
the supported shape; moving tier replaces it.

```sh
node scripts/flatpak.mjs --app planner --channel slop
node scripts/flatpak-remote.mjs --channel slop --publish
```

The tier branch is published on the same signed remote; the stable refs are not rewritten. See
[Packaging channels](../reference/packaging-channels.md#pre-release-tiers) for the identity and the
desktop-entry rule.

## GitHub releases

GitHub shows one "Latest" release per repository, so this repository has one rolling Suite release
tagged `suite-YYYY.MM.DD` and marked Latest. Its body is a table of every app's current version, its
release date, a link to that app's own release and the install command. Per-app releases
(`start-v<version>`, `canvas-v<version>`, `sync-v<version>`) stay as history and are not marked
Latest.

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
moved. The relay's release is the exception: `scripts/release.mjs sync --publish` owns its tarball,
so this script only edits that release's body and refuses when no relay release exists, or when the
existing release carries no tarball or checksum asset.

[`RELEASES.md`](../../RELEASES.md) is the human mirror of the Latest release. It can be written
before publication, so a row whose release does not exist yet says **pending** instead of linking a
page that is not there; `--publish` rewrites the page with real links once the releases exist.
`--write` needs no tag plan, so a row whose tag or release cannot be resolved yet is written as
**pending** rather than stopping the refresh.

The signed Flatpak remote above remains the update path. Per-app releases carry no app binaries, and
GitHub Packages is not used for the Flatpaks.

## The relay

```sh
node scripts/release.mjs sync              # dry run
node scripts/release.mjs sync --publish    # upload tarball, checksums and signature
node scripts/release.mjs sync --verify     # read the published assets back
```

The relay is a server tarball, not a desktop app. It has no Flatpak and no update feed; the person
replaces the tree deliberately. Its assets, checksum and signature are described in
[Leave a relay running](../../apps/sync/docs/how-to/relay.md#building-and-publishing-a-release).

Useful options:

| Option | Effect |
| --- | --- |
| `--publish` | Upload the relay assets. Without it, the command is a dry run. |
| `--tag <name>` | Release under another tag; the default is `sync-v<version>`. |
| `--feed-dir <path>` | Copy the artifact, checksums and signature into a local folder. |
| `--no-build` | Reuse the last build in the relay's output folder. |
| `--verify` | Check the published assets instead of building anything. |

## What the script refuses

It stops before building when any of these is true, and prints every reason it found:

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
node scripts/flatpak-remote.mjs                # a clean dry run
node scripts/flatpak-remote.mjs --publish
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
| Suite Go | `apps/go/app.config.json` | none yet |
| A shared package (`@suite/*`) | `packages/<name>/package.json` | none; consumed as `workspace:*` |

## Signing

The Flatpak store key signs the OSTree summary; the remote's `.flatpakrepo` carries its public half.
The relay's update key signs `SHA256SUMS`, and `release.mjs` refuses a key that does not match the pin.
[Manage signing keys](keys.md) owns both procedures.
