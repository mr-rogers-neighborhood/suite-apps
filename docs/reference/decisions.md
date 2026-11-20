# Decisions

The rules that shape this repository. Each is current; the code follows it.

## Workspace

- One pnpm workspace. The root lockfile is the only one installed.
- Shared packages are `workspace:*`. Never reintroduce a git-tag pin or a `link:` path.
- Each app owns its gate. The root gate builds shared packages once, then runs each app's gate in
  dependency order.
- The gate is local. `--fresh` proves a commit, not the working tree. No CI service gates a pull
  request.
- `@suite/desktop` is shared Electron policy. Canvas's shell is `@suite/canvas-desktop`.

## Layout

- Apps live under `apps/<name>`. Each app owns its private packages: Canvas has `desktop/` and
  `packages/graph`, Planner has `pack/` and `packages/core`, and so on.
- Packages used by two or more apps live at the root `packages/`.
- `harness/` is archive material. Do not add work there.

## Packaging

- Start replaces only a file it can write. It installs, updates and removes the apps it placed.
- The hub is packaged; the apps are AppImages. A copy a person placed manages itself.
- Flatpak is a second channel: Start lists and launches installs, installs from the store, updates a
  deployment whose commit is behind, and removes through Flatpak. Flatpak is the writer, never Start.
- Signed manifests live at `feeds/<app>/latest-linux.yml` in this repository, served by GitHub Pages.
  The artifact they name stays an asset on the app's `<app>-v<version>` release tag.
- `scripts/release.mjs` is the release path. It refuses a dirty tree, a version with no changelog
  heading, a commit the gate has not proven, and a manifest whose artifact is missing. It is a dry
  run unless `--publish` is passed.
- A version lives in one place and a tag names one app's release. [Version ownership](../how-to/package-and-release.md#version-ownership)
  states which file owns it and which prefix the tag uses.
- Linux is the published platform. macOS and Windows have no signing identity.

## Product boundary

- A document is a file the user owns. The hub returns a path or bytes; it never parses a document.
- No account, no telemetry, no project-operated server.
- Sync is a server the user runs. It persists and authenticates; it does not own the truth.
- Collaboration is a session while devices are connected. A sleeping device is not woken.
