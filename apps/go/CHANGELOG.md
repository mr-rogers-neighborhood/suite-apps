# Changelog

What changed, in a person's words rather than commits.

Versions here are Suite Go's own. Its version lives in [`app.config.json`](app.config.json), the copy
the Android build reads; `package.json` and Gradle repeat it because the build needs all three. A
release is tagged `go-v<version>`; the APK itself is attached to the rolling Suite release. The rules
are in [Version ownership](../../docs/how-to/package-and-release.md#version-ownership).

## [0.2.0] - 2026-11-24

### Added

- **The catalogue installs from the signed index.** **Browse apps** fetches the published index
  from the store's own origin, verifies the operator signature, and refuses a tampered, expired or
  rolled-back index before a row is shown. The row then installs, updates, reinstalls or removes the
  version it displayed. The index, the pinned key and the verifier are the same ones the desktop
  host reads, so the phone and the desktop agree on what is offered.

### Changed

- **Packs are read through the shared archive contract.** The loader now uses
  `@suite/pack-host/archive` instead of decompressing untrusted bytes with `unzipSync`, so the
  compressed, per-file, total and entry-count caps, safe paths, duplicate refusal and
  symlink/non-regular refusal apply on the phone exactly as they do on the desktop.
- **Every installed file is verified again when packs are discovered.** A pack edited after
  install is refused with the same `files` reason rather than trusted because its manifest was
  signed once.
- **A publish cannot go backwards.** Before Gradle runs, the release path reads the newest published
  release manifest for the package id and refuses a `versionCode` lower than one already shipped, so
  a channel move cannot strand an install.

### Fixed

- **An archive could write files its manifest did not list.** Install now compares the archive's
  file set with the manifest, refuses extras and missing files, and writes only the files the
  manifest names.

## [0.1.0] - 2026-11-18

The first version with a real domain in it, and the first with a number in more than one place.

### Added

- **Planner runs here.** It installs as a signed pack and opens a real `.planner`: edit, leave the
  module, come back, kill the app and reopen, and the document is there. The container still knows no
  domain — everything Planner knows about itself lives in its own repository.
- **`android:release`**, which builds a release APK from a keystore in the environment and refuses to
  start without one. A debug build is what you iterate with; this is the one that is a promise.
- **A version**, in `app.config.json`, repeated in `package.json` and passed to Gradle. A test fails
  if the three disagree, because an APK whose version disagrees with its own package tells every
  install there is no update.

### Changed

- **A pack that does not declare `network` now has to prove it cannot reach one.** Its entry document
  must carry a `Content-Security-Policy` with `default-src 'self'` and `connect-src 'self'` (or
  `'none'`), and the install refuses it otherwise. `'self'` rather than `'none'` because Loro's wasm
  is fetched same-origin — `'none'` produces a blank frame.
- **`pnpm check` verifies the committed package output.** It ships for git consumers, and a `dist`
  that disagrees with its source hands them something nobody built.

### Fixed

- **A pack asking for its own documents received every module's.** The module filter was dropped on
  the way to the shell, so a pack could open another domain's file — and could enumerate them.
- **A request that was never answered stalled every later one.** Replies are dropped when a frame's
  window is gone, and the requests share one queue, so a lost reply silently stopped the debounced
  save. It now fails after ten seconds and names the method.

**The container exists, and it has not been sold a lie yet.**

`@suite/go` is the module contract: a domain declares an id, a name, which capabilities it claims and
which capture kinds it accepts, and the container routes on that declaration without running a line of
domain code. `ModuleHost` hands a mounted module a document store that carries bytes and cannot read
them, namespaced key-value storage, the container's chrome, and resolved theme values.

The shell is a Capacitor app with a home screen in three bands: a capture bar that doubles as the
target picker, pinned domain tiles, and recents. With no domains installed it says so, in the places
the content will appear rather than in a modal that apologises for an empty state.

`pnpm android:install` builds an APK, installs it over USB and launches it; `pnpm android:watch` repeats
that on every save. `pnpm doctor` reports the toolchain and prints the command that fixes whatever is
missing — including the two failures that only ever happen to a person setting this up once.
