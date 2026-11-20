# Changelog

What changed, in a person's words rather than commits.

## Versioning

[`package.json`](package.json) carries the current version, which is what `--version` reports and
what the artifact ships. This prose record may lag it, so read the package for the current version
rather than the newest heading below.

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
