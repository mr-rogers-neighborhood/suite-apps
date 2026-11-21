# Release

A Canvas release is a Flatpak deployment on the signed OSTree remote, built from a commit the gate
has proven. Canvas is one app in a suite, and each app keeps its own version and release notes.

## Before the build

```sh
mise exec -- node scripts/gate.mjs --fresh
```

The version comes from `apps/canvas/desktop/package.json`. `desktop/suite.app.json` carries the app's
version and must agree with it. The gate proof is a commit, not a working tree.

## Build and install locally

```sh
node scripts/flatpak.mjs --app canvas
```

That packages the unpacked tree, exports it to `~/suite-flatpak/repo`, signs the summary with the
store key, adds the local remote and installs. `--no-build` reuses `desktop/release/linux-unpacked`.

## Publish

```sh
node scripts/flatpak-remote.mjs --app canvas            # dry run
node scripts/flatpak-remote.mjs --app canvas --publish  # sign, verify and copy to suite-dev
```

The publish refuses a dirty tree or a HEAD the gate has not proven. It copies the repository the
local flow built; it never builds a second one.

A pre-release is a branch, not a second app:

```sh
node scripts/flatpak.mjs --app canvas --channel slop
node scripts/flatpak-remote.mjs --app canvas --channel slop --publish
```

The stable id stays `run.suite.canvas`; the pre-release is `run.suite.slop.canvas` on branch `slop`,
`canary` or `beta`. There is no AppImage, update feed or Arch package.
[Packaging channels](../../../../docs/reference/packaging-channels.md) owns the remote, the store key
and the pre-release rules.
