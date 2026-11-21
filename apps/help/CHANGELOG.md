# Changelog

Written for people, not commits: what you can do now that you could not before, and what changed
underneath enough to matter.

Versions here are Suite Help's own. It ships through Flatpak, so the deployment version follows
this file and there is no AppImage release tag.

## [Unreleased]

No changes yet.

## [0.1.0] - 2026-11-21

### Added

- **The documentation reader is an app.** Suite Help ships the Browser, Modules and Tours explorer
  and the Handbook as one local-first Electron app. It runs from a static build over
  `suite-help://app/`, needs no checkout or server, and installs through Flatpak.
- **The handbook keeps the Fumadocs look without the Next stack.** The pages under `docs/` are
  compiled by Fumadocs MDX and read through the Fumadocs headless source loader in React Router.
  Search runs over a generated index, so it works offline.
