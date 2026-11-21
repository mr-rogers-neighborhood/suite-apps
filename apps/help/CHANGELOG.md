# Changelog

Written for people, not commits: what you can do now that you could not before, and what changed
underneath enough to matter.

Versions here are Suite Help's own. It ships through Flatpak, so the deployment version follows
this file and there is no AppImage release tag.

## [Unreleased]

### Fixed

- **Handbook links stay in Help.** A link between two pages now opens the handbook route
  (`/handbook/…`) instead of the retired `/docs/…` URL, including a link whose label wraps across
  lines. Links that leave `docs/` open GitHub, as before.
- **The app manifest reports the version it ships.** `suite.app.json` follows `package.json`, so
  Start's card reads 0.1.1 rather than the stale 0.1.0. A unit test now compares the two.

## [0.1.1] - 2026-11-21

### Added

- **Help wears the suite's theme.** The reader now offers the shared presets and a
  Brightness control — System, Light or Dark — in both navigator footers, remembered per device as
  `suite.theme`, instead of carrying a second neutral palette of its own. The Fumadocs tokens map
  to the suite roles, and Shiki follows the resolved light or dark mode.

### Changed

- **One mark for Help everywhere.** The app, the window frame, the packaged icon and the Flatpak
  entry all use the headset on the hub's ink tile that Start already shows on its card.

## [0.1.0] - 2026-11-21

### Added

- **The documentation reader is an app.** Suite Help ships the Browser, Modules and Tours explorer
  and the Handbook as one local-first Electron app. It runs from a static build over
  `suite-help://app/`, needs no checkout or server, and installs through Flatpak.
- **The handbook keeps the Fumadocs look without the Next stack.** The pages under `docs/` are
  compiled by Fumadocs MDX and read through the Fumadocs headless source loader in React Router.
  Search runs over a generated index, so it works offline.
