# Threat model

## Assets

- Document content: cards, text, attachments, board layout.
- The workspace epoch key and every member's device key.
- The membership log: who is in, who is out, what role they hold.
- Availability: the server and the document must remain openable offline.

## Actors

| Actor                 | Trust                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------- |
| Owner                 | Trusted to invite, revoke and run the server. A compromised owner device is game over. |
| Editor                | May write. Cannot invite, change roles or revoke.                                      |
| Viewer                | May read and receive live updates. Cannot write.                                       |
| Revoked member        | Holds old keys. Cannot join; may still read old ciphertext.                            |
| Server operator       | May be the owner or a hosting provider. Must not read content.                         |
| Network attacker      | May observe, drop, replay or reorder traffic.                                          |
| Cloud-folder provider | Future transport only. Must not read content.                                          |

## Threats and mitigations

| Threat                                                | Mitigation                                                                                                                                                                                                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server reads documents                                | E2E encryption with a workspace epoch key; server stores ciphertext only.                                                                                                                                                                                |
| Server is operated by a third party                   | Same as above; the server is replaceable and sees no plaintext.                                                                                                                                                                                          |
| Malicious member writes garbage                       | Signed updates and schema validation in the app; server enforces role and membership before forwarding.                                                                                                                                                  |
| Impersonation at join                                 | An owner mints a single-use signed invitation; the relay spends it on the first key package and pins that device's key.                                                                                                                                  |
| Stolen device                                         | Owner revokes the member; epoch rotates; live connection is dropped. OS disk encryption protects the local file.                                                                                                                                         |
| Replay of an old membership entry                     | Strict `seq`, workspace binding, signature check, and an append-only log.                                                                                                                                                                                |
| Replay of an old document update                      | Loro version vectors and CRDT idempotence; an update already applied is a no-op.                                                                                                                                                                         |
| Revoked member keeps reading                          | A new epoch key is wrapped only to remaining members. Old ciphertext remains readable to old key holders; document this.                                                                                                                                 |
| Server deletes or withholds ciphertext                | Availability is the operator's responsibility; members keep local copies and can export.                                                                                                                                                                 |
| Server learns metadata                                | Accept that workspace ids, member keys, sizes and timing are visible to the relay. Minimize what is sent; document it.                                                                                                                                   |
| Network attacker reads or alters transport            | A reachable relay serves `wss://` with a self-signed certificate pinned by SHA-256; a mismatch refuses before the WebSocket opens. Loopback may stay `ws://`; a reachable plaintext bind needs `--allow-plaintext` and is warned about.                  |
| Console or relay code leaks metadata or an invitation | The console is loopback-only and needs the token generated at startup. It reads metadata the relay already holds and draws a code carrying the address, pin and, when live, a bearer invitation; the code is therefore a secret. It never opens a frame. |
| Ghost cursor after a disconnect                       | Presence is ephemeral with a TTL, separate from the document.                                                                                                                                                                                            |

## What the relay holds

For each workspace the relay keeps `<workspaceId>.frames.jsonl` — sealed MLS frames with the position
it assigned — and `.roles.jsonl`, `.invites.jsonl`, `.keys.jsonl` and `.removed.jsonl`. It reads the
frame header (kind, workspace, device, epoch, payload length) and the signed records beside it. It
never opens a payload, and there is no document, snapshot or version vector in the store. Threats
"server reads documents" and "server is operated by a third party" are mitigated for the frames it
holds.

### Friend codes and the roster

The roster the relay builds — device ids, names and roles, from the roles and pinned keys it already
holds — says who may connect and write. It is not the app's trust list, and it is not where a person
decides who they know.

Friend codes, signed invitations and per-app contacts are built. A friend code names an installation;
a signed invitation carries the inviter's device, key, relay and pin; and each app verifies that
envelope, resolves the inviter's code against its own `sync/contacts.json` in its main process, and
refuses an unknown code before it asks the relay to join. The relay sees only the invitation record it
already understood, and it has no friend-code or contacts exchange. The code and envelope rules are in
[the protocol](protocol.md#friend-codes-and-signed-invitations); this page records only the boundary:
the relay's roster is an admission list, while the contacts file is the person's trust decision, and
neither stands in for the other.

## Accepted limits

- **Metadata.** Workspace and device ids, device names, public keys, epochs, kinds, payload lengths,
  arrival order and timing, cursors, roles, invitations and removals are visible to the relay. TLS
  hides them from a passive network attacker, not from the machine that stores the frames. The list is
  in [the blind relay record](reference/blind-relay.md#what-the-relay-may-learn).
- **A bearer invitation.** An invitation is a signed, single-use token. Whoever spends it first gets
  the role it named; the relay pins that device's key, but there is no fingerprint confirmation yet.
  A relay code that includes an invitation carries that token, so it is a secret too.
- **Plaintext and legacy links are local.** The apps accept `ws://` only for a loopback relay and
  refuse a legacy `suite://join` link that points anywhere else, so deleting the envelope cannot skip
  the signature, contact and pin checks on a remote host.
- **The console is loopback and token-gated.** The token is generated at startup and printed with the
  console URL; a request without it gets a 401. The relay has no friend-code or contacts exchange:
  those are app data and never reach the console or the store.
- **Availability is the operator's.** The relay can delete or withhold frames. Every device keeps a
  local copy, but a device away longer than the retention window (30 days by default) needs a
  snapshot from a peer, because the relay cannot produce one.
- **The CLI needs `--trust-all`.** It has no device-key verifier yet, so `serve` refuses to start
  without it. Start runs the same CLI on loopback. A relay on a reachable address is run directly with
  its TLS pair and `--trust-all-remote`. It records each device's key on join but does not verify with
  it yet.

## Non-goals

- Protecting against a compromised owner device or a malicious owner.
- Hiding the existence of a workspace from its server.
- Protecting a local file at rest beyond OS disk encryption (an opt-in passphrase is future work).
- Anonymity. Member keys and endpoints are visible to the server.

## Open questions

- Whether a viewer should see the titles of cards outside the shared scope.
- How much metadata the invite and hello messages must carry.
- Whether a server operator can be a non-owner (a hosted node) in v1.
