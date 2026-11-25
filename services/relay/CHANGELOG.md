# Changelog

What changed, in a person's words rather than commits.

## Versioning

[`package.json`](package.json) is the version the relay reports and ships, and the version a release
is tagged with: `sync-v<version>` here, `v<version>` in the standalone repository this one was
imported from. The wire protocol has its own integer and is not this version; the rules are in
[Version ownership](../../docs/how-to/package-and-release.md#version-ownership).

Entries stop at 0.4.0 and resume at 0.11.3, the first version released from this repository.
Versions 0.5.0 through 0.11.2 carry tags in the standalone repository but no written notes here, and
this file does not invent them; every release from here adds its section first.

## [Unreleased]

No changes yet.

## [0.12.0] - 2026-11-21

### Changed

- **A smaller install and faster updates.** The tray app builds outside the linked package,
  so the Flatpak carries one Electron tree instead of two; it ships one locale, and static
  deltas make the next update a delta instead of a full download.

### Added

- **The relay as a desktop app.** `run.suite.sync` is a Flatpak with a tray and a small window. The
  relay runs in the app's own main process, so closing the window hides it to the tray and the relay
  keeps serving; the window shows the address, the relay code, the certificate fingerprint and the
  console, and can start or stop the relay. The same Flatpak is the headless relay:
  `flatpak run --command=suite-sync run.suite.sync serve`. It installs from the suite store like
  every other Flatpak; a checkout builds it with `node scripts/flatpak.mjs --app sync`.
- **Starting at login** writes one XDG autostart entry and nothing else outside the sandbox. The
  manifest grants exactly `--filesystem=xdg-config/autostart:create` for it.
- **Who can reach the relay is a choice, loopback by default.** The window's selector offers this
  device (the default), the tailnet (`tailscale0`, read from the shared network namespace), and the
  whole network. The network scope is the acknowledgement the CLI's `--trust-all-remote` asks for:
  it warns before it applies, the main process refuses an unconfirmed change, and the choice is
  stored in the app's own config so a login launch keeps it. `SUITE_SYNC_BIND` overrides the bind,
  and the window's sentence is derived from the address actually bound, so a literal bind says which
  network it exposes.
- **`@suite/host` can make the TLS pair it serves** (`ensureSelfSignedPair`), so an app that embeds a
  relay keeps one fingerprint across restarts. A bind that fails now rejects with the listen error
  instead of surfacing as an uncaught exception from the WebSocket server.

### Fixed

- **The Flatpak no longer ships a copy of its own build.** The app depends on `@suite/sync-server`,
  whose package root is `services/relay`, and electron-builder copied that whole directory into the
  asar — including `app/release`, the Electron distribution being built. A nested 224 MB `electron`
  made the install 878.5 MB. The unpacked build now lives outside the package at
  `.artifacts/sync-app`, the asar carries only the server's `dist`, and `package:dir` fails if a
  second Electron, a nested `linux-unpacked` or an oversized tree comes back.

### Removed

- **The relay tarball release.** `scripts/release.mjs` no longer builds, signs or uploads a
  `suite-sync-<version>-<arch>.tar.gz`; the relay publishes as `run.suite.sync` on the signed Flatpak
  remote. Releases `sync-v0.11.3` and earlier stay downloadable as history and are not an install
  path.

## [0.11.3] - 2026-11-20

The first relay artifact published from the monorepo.

### Added

- **A checksummed `suite-sync-<version>-<arch>.tar.gz`.** It carries the built CLI, a `suite-sync`
  launcher, the runtime requirement in its README and the licence. The launcher says plainly that
  the tarball needs Node.js 22 or later, because no runtime is bundled.
- **`node scripts/release.mjs sync`**, which builds the tarball from the gated commit, signs
  `SHA256SUMS` with the update key and publishes the tarball, checksum list, signature and public
  key on the `sync-v<version>` tag. A dry run is still the default.
- **An install section in [`docs/how-to/relay.md`](docs/how-to/relay.md)** with the download,
  checksum and signature checks, where to install the tree, and how Suite Start finds the binary
  through `SUITE_SYNC_BIN` or `PATH`.

## [0.4.0] - 2026-11-18

The first version that is a thing you install rather than a script you copy.

### Added

- **A signed release artifact.** `pnpm release:relay` deploys the server, packs it into one
  `.tar.gz`, hashes it, signs it and writes a `suite.artifact` manifest; `pnpm release:verify`
  re-reads the result and checks the hashes, the fingerprint and both signatures. Installing a relay
  used to mean copying a `.js` by hand.
- **`deploy/`**, with a systemd unit that runs as `DynamicUser` and can write only its state
  directory, and an env example with the loopback and LAN variants.
- **`docs/how-to/relay.md`**, which is install, address choice, health probe, upgrade, backup, and
  what the relay still refuses to do.
- **`pnpm verify:relay`**, which unpacks the artifact, starts it with no display, probes `/health`
  and joins two devices — the failures a unit test cannot see, because they live in the packaging.

### Changed

- **`--version` reports the version the package is.** It was a constant, and it had drifted to 0.1.0
  while the artifact shipped as 0.3.4 — the exact command the guide tells you to run after an upgrade.

### Security

- **`--trust-all` is refused on an address other machines can reach** unless `--trust-all-remote`
  says so. There is no device registry yet, so the flag has to admit any device; on loopback that
  means this machine, and on `0.0.0.0` it means every device that can route to the port. One flag was
  doing both jobs, and a relay left running on a home network was an open mailbox nobody chose.

**The protocol is written down now.** `docs/protocol-sessions.md` states the conversation as a
session type with a projection per side, which turns two arguments into properties: the host's
projection mentions the document payload only inside `seal`, and a frame from an epoch already left
is not a conforming message. It also says what it does _not_ cover — session types assume honest
participants, so they say nothing about a hostile relay.
