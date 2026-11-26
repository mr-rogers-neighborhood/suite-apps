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
- A key package is the join request and carries no epoch: the host does not measure it against the
  newest stored epoch, and no other kind is exempt. A frame newer than the receiver's epoch is a
  reason to catch up by index before opening anything.
- A revoke is done when the relay has numbered the commit that rotates the epoch, not when the removal
  record has been sent. A workspace created when it is first shared has an identity root and a signed
  genesis; a workspace that predates the root opens without one.
- A friend code is a 16-symbol Crockford base32 commitment to an install key, with a checksum. It is
  an identifier, not a secret, and it cannot be reversed into the key; an app resolves it through its
  own contacts file, never a directory.
- A friend invitation is the ordinary invitation link plus a signed, out-of-band envelope naming the
  inviter's device and key, the relay and pin, the workspace, the invite, an optional recipient code,
  an expiry and a nonce. The relay never sees the envelope and learns no contact.
- Adding a contact is the explicit trust act. A signed invitation from a known code connects without
  a second certificate question; a known code with a different key is refused; an unknown code is
  refused with the code to add, never trusted on first use.
- Contacts are app data in each app's main process (`sync/contacts.json`, mode 0600), outside the
  document, the workspace file and the relay store. A code-only contact is completed by the first
  signed invitation whose key hashes to that code.
- `run.suite.sync` is retired as a shipped app (#315). `services/relay` stays as the protocol, the client
  library and the relay implementation, and its gate row keeps running. The signed remote keeps the
  last published ref; no new build is published, and the tray app is not the target surface. The relay
  becomes a host capability, and whether the host imports it as a module or supervises it as a child
  is owed by that seam, not decided here.
- The relay never reads a document. Whatever shape the host gives it, the relay is handed no document
  handle, no document path and no decrypted frame; it holds only its sealed-frame store and the signed
  membership records it already needs. A module shape enforces that by code path, a supervised child
  can also enforce it with an OS boundary. The desktop host chose a `worker_threads` thread (recorded
  in the host's decision record): its Flatpak carries no Node runtime and its zypak-wrapped Electron
  binary cannot serve as one, so the store-only rule is a code-path and test boundary there.
