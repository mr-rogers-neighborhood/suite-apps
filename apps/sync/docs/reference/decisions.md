# Decisions

The rules that shape Sync.

- The document is a file the app owns. This package defines no document schema.
- A workspace, device or member id is 64 lower-case hex characters.
- Membership is a signed, append-only log: `create`, `invite`, `accept`, `set-role`, `revoke`. Only an
  active owner invites or revokes. A revoke bumps the epoch.
- Peers exchange version vectors, then send the updates the other is missing.
- The server persists and authenticates. It does not own the truth and does not merge.
- The target is a blind relay: it stores ciphertext it cannot read. The current Phase 2 room is
  plaintext and loopback-only; see [Status](../../../../docs/reference/status.md).
- One active server per workspace. There is no server-to-server federation.
- A snapshot survives a restart; the room writes one file with a temp-file rename.
- Presence is verified, forwarded and forgotten. It is never written to the document.
- A client ignores a frame whose epoch is not the one it is in.
