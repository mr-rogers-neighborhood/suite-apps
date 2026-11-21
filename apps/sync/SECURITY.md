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
- **Off loopback, the transport is pinned TLS.** The relay serves `ws://` on `127.0.0.1` by default.
  A bind on any address other machines reach serves `wss://` from `--tls-cert` and `--tls-key`; the
  certificate is self-signed and each app pins its SHA-256 fingerprint. A mismatch refuses before the
  WebSocket opens. A reachable plaintext bind needs `--allow-plaintext` and is warned about. TLS
  protects the header and timing from a passive network attacker; frames still protect content from
  the relay and from disk. An attacker can still drop traffic.
- **The CLI needs `--trust-all`.** It has no device-key verifier yet, so `serve` refuses to start
  without it. Start runs the same CLI, passes `--trust-all` on loopback, and requires the network
  acknowledgement before widening the scope; it records keys but does not verify with them yet.
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
