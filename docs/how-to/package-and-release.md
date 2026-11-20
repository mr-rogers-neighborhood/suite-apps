# Package and release

The suite has one repository and several artifacts. Each app keeps its own version and release notes;
the root owns the gate and the packaging scripts.

## Build the hub

```sh
pnpm --filter @suite/start run package:dir
pnpm --filter @suite/start exec electron-builder --linux AppImage --publish never
```

The unpacked build keeps the Electron sandbox. The AppImage may need `--no-sandbox` because
`chrome-sandbox` cannot be setuid on a read-only mount. The Arch package repackages the published
AppImage, so the package and the feed describe the same release.

## Build an app

Each app has its own packaging path:

```sh
pnpm --filter @suite/canvas-desktop run package:dir   # unpacked Canvas
pnpm --filter @suite/planner run package
pnpm --filter @suite/budget run package
```

For a distributable Canvas build, run electron-builder from the shell package:

```sh
pnpm --filter @suite/canvas-desktop exec electron-builder --linux AppImage
```

Run the owning app's `pnpm verify` first. Packaging does not run the gate.

## Flatpak

```sh
node scripts/flatpak.mjs              # package, build, publish, install
node scripts/flatpak.mjs --no-build   # reuse release/linux-unpacked
```

The script publishes to `~/suite-flatpak/repo` and adds it as the user remote `suite-local`. Run
`scripts/store-key.sh` once to make the store's signing key: the script then signs the repository
summary and adds the remote with the public key, so `flatpak update` verifies what it downloads. With
no key the remote is added with `--no-gpg-verify` for local testing only, and the script says so. See
[Packaging channels](../reference/packaging-channels.md).

## Release notes and versions

- The version lives in the app's `package.json`. Do not restate it in a README or a doc page.
- The app's `CHANGELOG.md` records what changed, in a person's words.
- A release tag must not collide with another app's tag line. The hub's release tags and the shared
  packages' tags are different namespaces.

## The feed

Start asks each app's feed for its current version and installs the artifact named by the verified
manifest, after checking its sha512. A feed is therefore a signed manifest plus the artifact it names.

A single monorepo `releases/latest` cannot serve several different `latest-linux.yml` files. Per-app
feeds need per-app tags or a static feed host. Until that exists, the app repositories' releases remain
the last published feed.

## Before you publish

1. `mise exec -- node scripts/gate.mjs --fresh`
2. The owning app's `pnpm verify`.
3. `mise exec -- node scripts/docs-check.mjs` if docs changed.
4. Install the artifact and open a document. Packaging is not proven until the built app runs.

App-specific release steps are in that app's docs, for example
[Suite Start's packaging page](../../apps/start/docs/how-to/package.md).
