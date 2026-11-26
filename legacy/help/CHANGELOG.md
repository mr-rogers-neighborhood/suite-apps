# Changelog

Written for people, not commits: what you can do now that you could not before, and what changed
underneath enough to matter.

Versions here are Suite Help's own. It ships through Flatpak, so the deployment version follows
this file and there is no AppImage release tag.

## [0.1.4] - 2026-11-26

### Added

- **Help fits a phone.** At phone width the explorer's navigator opens as a drawer and closes back
  to the page a person was reading; above the breakpoint the desktop navigator stays in the shell.

### Changed

- **Help owns its renderer and documentation generator.** The explorer, handbook reader and index
  generator build from the pack's own source, so the pack and the frozen desktop app compile one
  copy.

## [0.1.3] - 2026-11-24

### Added

- **Help is mobile-ready.** The pack now declares `desktop` and `mobile`, so Suite Go can install it:
  it asks for no host capability and reads only its own archive. The build also writes a card
  sidecar with Help's own headset mark, its one-line description and shelf order 4.

- **Help is a pack.** The same explorer and handbook now build as a signed `.suitepack` for the
  Suite host, with the generated index and compiled documentation pages inside the archive. The
  pack asks the host for no capability: it reads only its own bundle, and hash routes keep Browser,
  Modules, Tours and the handbook working from one entry file.

## [0.1.2] - 2026-11-21

### Changed

- **A smaller install and faster updates.** The Flatpak ships one locale instead of 55,
  production files drop source maps, declarations and test fixtures, and static deltas make
  an update a delta instead of a full download.

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
