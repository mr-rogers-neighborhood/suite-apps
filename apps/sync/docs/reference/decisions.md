# Decisions

The rules that shape Sync.

- The document is a file the app owns. This package defines no document schema.
- A workspace, device or member id is 64 lower-case hex characters.
- Membership is a signed, append-only log: `create`, `invite`, `accept`, `set-role`, `revoke`. Only an
  active owner invites or revokes. A revoke bumps the epoch.
- Peers exchange version vectors, then send the updates the other is missing.
- The server persists and authenticates. It does not own the truth and does not merge.
- The target is a blind relay: it stores ciphertext it cannot read. The demo transport binds to loopback
  by default and stores whatever a client sends; see
  [Status](../../../../docs/reference/status.md).
- Keys, frames, epochs and wakes are settled in [the blind relay record](blind-relay.md).
- One active server per workspace. There is no server-to-server federation.
- A snapshot survives a restart; the room writes one file with a temp-file rename.
- Presence is verified, forwarded and forgotten. It is never written to the document.
- A client ignores a frame from an epoch it has left. The next commit is how it moves, not a frame to
  ignore; see [the blind relay record](blind-relay.md).
