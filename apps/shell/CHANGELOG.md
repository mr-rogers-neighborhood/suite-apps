# Changelog

Written for people, not commits. This app is a spike; its version is its own until it becomes the
shipped host.

## [Unreleased]

### Changed

- **Documents carry a host envelope.** Each pack document is a magic-and-version prefix, a canonical
  header (publisher, pack, document, schema, payload length, payload checksum) and the pack's payload
  bytes untouched. Saves are serialized, atomic, backed up and recovered after a crash; a file that
  does not verify is quarantined, a newer envelope or schema is refused with its path, and a
  pre-envelope file is left as it is.

### Added

- **Declared documents migrate through the host.** A pack's manifest entries are carried into the
  installed pack, the host proves a single migration chain before it writes, takes one backup and
  invokes each declared entry with a handle scoped to that document. The schema stamp makes a second
  run a no-op, a failed entry restores the backup, and a projection refuses a document whose schema
  is not current. The entry runner is injected; binding it to a pack renderer is still open.

## [0.2.0] - 2026-11-22

### Added

- **Home is a Screen.** The host opens a shell-owned Home Screen before any pack, renders the pack
  grid as a host widget, and draws declared app widgets and named placeholders for unknown ones.
- **Screen tabs.** A tab is either a pack or a host Screen. Opening, switching and restoring a Screen
  tab works without creating a pack view, and the space document stores both tab kinds.
- **The pack catalogue and lifecycle.** A local directory of `.suitepack` files is verified before
  it is listed, trusted entries install, and uninstall and additive updates are explicit actions
  with a refusal sentence for anything that fails verification.
- **Routing.** `suite://<pack-id>/<path>` links resolve through one host-owned function and open the
  current installed pack; a malformed, unknown or uninstalled target is refused with a sentence.
- **The external file surface.** A host-owned picker hands a pack opaque handles, and import copies
  a person's file into the pack root without exposing a host path.
- **Packaging as `run.suite.shell`.** The host now builds as a Flatpak named Suite Shell, with a narrower
  sandbox than Start: no host Flatpak service, no host filesystem grants, and no scheme handler yet.

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
