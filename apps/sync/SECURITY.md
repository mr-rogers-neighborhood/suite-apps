# Security

Suite Sync is the protocol and the user-run sync server. The document stays a file the app owns; the
server is a role a person runs on a device they control.

## What is protected today, and what is not

- **The relay holds ciphertext.** For each workspace it keeps an append-only file of sealed frames
  plus signed roles, invitations, pinned device keys and removals. It reads the frame header and the
  records it needs to admit a frame; it never opens a payload. There is no document, snapshot or
  version vector in the store.
- **Membership is enforced.** Group traffic needs a role record, a pinned device key and a valid
  signature; a key package is the one join exception, and a live invitation authorises it. A viewer
  cannot write; a revoked device is refused on its next join and dropped from the live room.
- **A join is a single-use invitation.** The relay spends the signed invitation on the first key
  package it admits and pins that device's key. The invitation link is a bearer token, so whoever
  spends it first gets the role it named.
- **No transport security yet.** The relay speaks `ws://` with no TLS and binds to `127.0.0.1` by
  default. Frames protect content from the relay and from disk; they do not protect the header, timing
  or availability from the network. Do not expose it beyond a trusted network.
- **The CLI needs `--trust-all`.** It has no device-key verifier yet, so `serve` refuses to start
  without it. Start runs the same server with the Ed25519 verifier.
- **Ids are fingerprints.** Workspace, device and member ids are 64 lower-case hex characters. The
  protocol layer treats them as opaque; the workspace id is the document's own id, which the root
  signs at first share.

The accepted metadata, retention window and remaining risks are in
[the threat model](docs/threat-model.md) for the full list and the accepted risks.

## Reporting a vulnerability

Use GitHub's private security advisory for
[mr-rogers-neighborhood/suite-apps](https://github.com/mr-rogers-neighborhood/suite-apps/security/advisories/new).
Do not open a public issue for a vulnerability. Include the version, the platform, and the smallest
reproduction you can.
