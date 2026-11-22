# Changelog

Written for people, not commits. This app is a spike; its version is its own until it becomes the
shipped host.

## [Unreleased]

No changes yet.

## [0.1.0] - 2026-11-22

### Added

- **One host, many packs.** A `BaseWindow` with a host-owned tab strip, a launcher and one
  `WebContentsView` per pack tab.
- **A real pack boundary.** Each pack is served from `suite-pack://<container>.<id>`, uses its own
  session partition, runs with no Node, and reaches documents only through a sender-scoped API.
- **Opaque documents.** Create, list, open, save and remove a pack's documents; the host carries
  bytes, never a path, and never parses the format.
- **A Loro space document.** Tabs, titles and the active tab restore from `spaces.loro`; the shape is
  container-ready, with one default space and one default container.
- **Three sample packs.** Welcome exercises notes and the two boundary failures (network, sibling
  path); Scratch proves a second pack and a second document root; Conformance exercises the scoped
  files service: relative paths, backups, locks and refusals.
