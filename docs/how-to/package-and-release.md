# Package and release

The suite has one repository and several artifacts. Each app keeps its own version and release notes;
the root owns the gate, the feed host and `scripts/release.mjs`.

## What a release is

A release is three things that must describe the same commit:

- an artifact attached to a release tag named `<app>-v<version>`;
- a signed manifest committed at `feeds/<app>/latest-linux.yml`;
- a changelog section for the version in the app's `CHANGELOG.md`.

The manifest is committed, so it is fetched straight from the repository at
`https://raw.githubusercontent.com/mr-rogers-neighborhood/suite-apps/main/feeds/<app>/latest-linux.yml`.
Its detached signature sits beside it as `latest-linux.yml.sig`. The artifact stays a release asset;
the manifest names it by absolute URL on the app's tag, so the manifest can move while the bytes stay
where a release put them.

The host is the raw file server rather than GitHub Pages because a Pages build needs GitHub Actions,
and Actions is not available on this account. A signed manifest does not need a build step: the bytes
in the repository are the bytes served, and the signature is the trust anchor.

## One command per app

Run a dry run first. It builds, verifies and prints what it would publish, and stops before every
network write. A dry run is the default:

```sh
node scripts/release.mjs planner
```

Publish the same release. This uploads the artifact, manifest and signature, then commits the feed:

```sh
node scripts/release.mjs planner --publish
```

Re-read the published feed and prove it is signed by the key the apps pin, names the version in the
tree, and points at an artifact that answers:

```sh
node scripts/release.mjs planner --verify
```

The hub has an Arch package as well as its AppImage. `start` builds it when `makepkg` is available and
uploads it with the other files:

```sh
node scripts/release.mjs start --publish
```

Useful options:

| Option | Effect |
| --- | --- |
| `--publish` | Upload and commit. Without it, the command is a dry run. |
| `--tag <name>` | Release under another tag; the default is `<app>-v<version>`. |
| `--notes-file <path>` | Use a file for the release notes instead of the changelog section. |
| `--feed-dir <path>` | Copy the artifact, manifest and signature into a local folder. |
| `--no-build` | Reuse the last build in the app's `release/` folder. |
| `--verify` | Check the published feed instead of building anything. |

## What the script refuses

It stops before building when any of these is true, and prints every reason it found:

1. The tree has uncommitted changes.
2. The version in the app's `package.json` has no `## [version]` heading in its changelog.
3. `.dev/gate-status.json` does not name this commit, does not say `ok`, or came from a working-tree
   run rather than a clean export.
4. The app's `suite.app.json` names a different version from its `package.json`.

After packaging it also refuses a manifest whose version disagrees with `package.json`, or that names
an artifact that is not in the release folder. It does not bump a version and it does not read tags to
guess one.

## Before you publish

```sh
mise exec -- node scripts/gate.mjs --fresh      # writes .dev/gate-status.json for this commit
mise exec -- node scripts/docs-check.mjs       # if docs changed
node scripts/release.mjs <app>                # a clean dry run
node scripts/release.mjs <app> --publish
node scripts/release.mjs <app> --verify
```

Packaging is not proven until the built app runs. Install the artifact and open a document after the
release, not before the gate.

## Build without publishing

The release script is the publishing path. For a local build:

```sh
pnpm --filter @suite/start run package:dir
pnpm --filter @suite/start exec electron-builder --linux AppImage --publish never
```

The unpacked build keeps the Electron sandbox. The AppImage may need `--no-sandbox` because
`chrome-sandbox` cannot be setuid on a read-only mount. The Arch package repackages the published
AppImage, so the package and the feed describe the same release.

Each app has its own packaging path:

```sh
pnpm --filter @suite/canvas-desktop run build   # then electron-builder in apps/canvas/desktop
pnpm --filter @suite/planner run package
pnpm --filter @suite/budget run package
```

Run the owning app's gate first. Packaging does not run it.

## Flatpak

```sh
node scripts/flatpak.mjs              # package, build, publish, install
node scripts/flatpak.mjs --no-build   # reuse release/linux-unpacked
node scripts/flatpak.mjs --no-build --no-install   # publish, leave the client alone
```

The script publishes to `~/suite-flatpak/repo` and adds it as the user remote `suite-local`. Run
`scripts/store-key.sh` once to make the store's signing key: the script then signs the repository
summary and adds the remote with the public key, so `flatpak update` verifies what it downloads. With
no key the remote is added with `--no-gpg-verify` for local testing only, and the script says so. See
[Packaging channels](../reference/packaging-channels.md).

To watch Start update from the store, publish a second commit without installing it, then ask Start
to look again (with `XDG_DATA_HOME` pointing at the real user installation):

```sh
printf 'update check\n' > apps/canvas/desktop/release/linux-unpacked/update-check
node scripts/flatpak.mjs --no-build --no-install
```

The app's card says `update available` after **Check for updates**; **Update** asks Flatpak to
replace the deployment. Remove the marker and run `node scripts/flatpak.mjs --no-build` again to
publish the clean build and bring the client back to it.

## Version ownership

A version has one home: the app's entry `package.json`. Nothing else restates it — not this page, not
a README, not a tag name. The app's release path reads it, refuses a changelog without a section for
it, and stamps it into the artifact.

| What | Where the version lives | Its tag |
| --- | --- | --- |
| Start, Canvas, Planner, Budget | `apps/<app>/package.json` | `<app>-v<version>` |
| The relay (`suite-sync`) | `apps/sync/package.json` | `sync-v<version>` |
| Suite Go | `apps/go/app.config.json` | none yet |
| A shared package (`@suite/*`) | `packages/<name>/package.json` | none; consumed as `workspace:*` |

A tag names one app's release, not the repository's. The relay is three packages that ship as one
artifact: `apps/sync/package.json` carries the release version and
`apps/sync/packages/{protocol,host}/package.json` mirror it, so they move together. Its wire protocol
has its own integer, `RELAY_PROTOCOL_VERSION` in
[`apps/sync/packages/protocol/src/relay.ts`](../../apps/sync/packages/protocol/src/relay.ts), and a
protocol change does not rename the package release. Suite Go needs its version in `app.config.json`,
`package.json` and Gradle because the Android build reads all three; `app.config.json` is the home and
a test fails when the copies disagree.

The `v0.1.0`–`v0.1.8` tags predate this monorepo. They are Canvas releases from when Canvas was the
repository — not shared-package tags and not Start releases. They stay where GitHub put them; a new
release uses its app prefix.

A changelog is the release notes for a version, not a second version store. Every release adds its
`## [version]` section before it is tagged, and each app's `CHANGELOG.md` names the tag prefix that is
its own. Where a version shipped without written notes, the changelog says so in one sentence rather
than inventing a section.

The manifest's signature is made with the publisher key at `SUITE_UPDATE_KEY`, or
`~/.config/suite/update-key.pem` by default. The private half never enters this repository.
