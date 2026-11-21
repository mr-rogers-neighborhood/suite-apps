# Release

A release is a tag, an artifact and a note. Canvas is one app in a suite of four, and each ships its
own version, because they release on their own schedules.

## Before the tag

```sh
mise exec -- node scripts/release.mjs canvas
```

That is a dry run from the repository root: it checks the tree, the version, the changelog and the
last gate run, then builds and signs without writing anything. A version with no changelog heading or
a commit the gate has not proven stops it there.

## The tag

Tags name one app, because four apps share this repository: Canvas releases are `canvas-v<version>`.
[Version ownership](../../../../docs/how-to/package-and-release.md#version-ownership) names the file
that owns the number and the prefix each app uses.

The version comes from `apps/canvas/desktop/package.json`. `desktop/suite.app.json` carries the
**app's** version and must agree with it: the tag, the manifest and the package describe one commit.

## The package

`electron-builder` writes the artifact and the feed file beside it. The release script runs it:

```sh
mise exec -- node scripts/release.mjs canvas --no-build   # reuse desktop/release
```

That produces `suite-canvas-<version>-x86_64.AppImage` and `latest-linux.yml` in `desktop/release`.
The yml names a version, an artifact, its sha512 and its size. Linux is the only package this
repository produces; macOS and Windows are configured and need a signing identity it does not have.

## Publishing

```sh
mise exec -- node scripts/release.mjs canvas --publish
mise exec -- node scripts/release.mjs canvas --verify
```

`--publish` creates the `canvas-v<version>` release with the artifact, the manifest and its signature,
then commits `feeds/canvas/latest-linux.yml`. `--verify` reads that file back and checks the signature
and the artifact it names.

The feed is committed, so it is served straight from the repository:
`https://raw.githubusercontent.com/mr-rogers-neighborhood/suite-apps/main/feeds/canvas/latest-linux.yml`.
Both the app's own updater and Start read it, so the two cannot disagree about what is newest. A single
`releases/latest` could not serve four apps' manifests; [channels](../../../../docs/reference/packaging-channels.md)
has the whole picture.

## Signing the feed

An update feed is one URL, and anything that can answer it can offer a version. The artifact's sha512
protects a download, not the manifest that named it, so the manifest is signed with the publisher's
ed25519 key. The script does this; `latest-linux.yml.sig` sits beside the manifest.

The private key is at `~/.config/suite/keys/update-key.pem` on the publisher's machine, or wherever
`SUITE_UPDATE_KEY` points. **It is not in this repository and must not be.** Back it up somewhere you
control: anyone holding it can push an update to every install. [Manage signing keys](../../../../docs/how-to/keys.md)
covers the directory and the backup, and the root repository's `keys status` check proves the key in
hand is the one the apps pin before anything is built.

The public half is `SUITE_UPDATE_PUBLIC_KEY` in `@suite/desktop`, with `updateKeyFingerprint()` to
check that what you signed with is what the apps pin. A new key is a new trust root: an installed app
verifies with the key it was built with, so a rotation ships a new Start first and only then publishes
a feed signed with the new key.

## What is still missing

The script automates the build, the signature, the upload and the feed commit. What it does not remove
is the deliberate act: someone decides to publish, and someone holds the key. There is no CI service to
hand it to, and Actions is unavailable on this account, so the key stays on one machine and the raw
file host serves the manifest. If that changes, a secret is **not** a backup (GitHub never shows it
again), and a secret is readable by any workflow that runs on a tag.
