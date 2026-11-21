# The Suite sync protocol

This is the contract between a Suite app, the `suite-sync` server and another member's app. It is
deliberately small: the hard parts are identity, membership and key recovery, not the delta exchange.

## Goals

- Let two or more devices converge on one Loro document after arbitrary offline edits.
- Let a user run the server on a device they own, without a Suite-operated service.
- Enforce owner/editor/viewer roles at the server, not only in the UI.
- Keep the server unable to read document content.
- Keep presence ephemeral and separate from the document.

## Non-goals

- Defining an app's document schema. That belongs to the app.
- Being a general-purpose file sync or backup product.
- Server-to-server federation in v1.
- Public web editing. A member needs the app and an invite.

## Identity

An id is a 32-byte fingerprint encoded as 64 lower-case hex characters.

| Id            | What it names                 | How it is made                                                |
| ------------- | ----------------------------- | ------------------------------------------------------------- |
| `workspaceId` | One Loro document / workspace | The id the document already owns; the workspace root signs it |
| `deviceId`    | One installation              | SHA-256 of the device public key                              |
| `memberId`    | One member                    | SHA-256 of the member public key                              |
| `inviteId`    | One invite                    | Random 32 bytes                                               |

In v1, **each device is a member**. A person with a laptop and a desktop has two member records, each
with its own key and role. This avoids delegated device keys while still giving the user a clean
revocation story. Per-person members with device sub-keys can come later behind the same log.

A workspace made under the blind relay also has an **identity root**: an Ed25519 key, held only by the
device that founded the workspace and its recovery kit, that signs one record, the genesis. The
genesis carries the workspace id, the creation time, the creating device and the relay address. The
root signs the id the document already owns rather than replacing it, so a Canvas workspace keeps the
id it had before it was shared; `workspaceIdFromRootKey` is the derivation for a workspace created
root-first, and `genesisNamesItsRoot` says which kind a record is. The genesis is the creating
device's record: it is not a frame, and the relay never receives it. A workspace shared before the
root existed has no genesis and opens unchanged; nothing migrates it.

## Membership

Membership is the MLS group ([Decisions](reference/decisions.md)). There is no second member
list: a device is a leaf, and the epoch is MLS's epoch. Adding a device is a Commit, removing one is a
Remove proposal, and a device that joins receives a Welcome that carries the ratchet tree because the
host holds none to hand over.

The host orders and stores handshake frames. It is not a member, holds no group secret, and cannot
read what it stores.

## Role records

MLS says who is in the group, not who may write. A **role record** per device travels beside the group:

```ts
type RoleRecord = { workspaceId; deviceId; role: "owner" | "editor" | "viewer"; seq; signature };
```

It is signed by an owner's device key and ordered by `seq`, so the host can check `role !== "viewer"`
before it stores a frame without decrypting one. Authorship is a device-key signature on each frame,
which lets a reader attribute a change without trusting the host's ordering.

Rules:

- Only an owner's device may write a role record, and only for a device already in the group.
- A viewer's frames are refused by the host, not merely discouraged in a UI.
- Revoking a device is a Remove commit; the new epoch makes the revoked device unable to read anything
  that follows, and the host drops its connection.
- The last owner cannot be demoted or removed. Ownership transfer is out of scope until there is a
  two-owner story.

## Sync messages

All messages are JSON; frame and presence payloads are base64.

```ts
type ClientMessage =
  | { type: "join"; protocolVersion; workspaceId; deviceId; publicKey; name; inviteId? }
  | { type: "keypackage"; inviteId; deviceId; publicKey; name; frame }
  | { type: "frame"; frame }
  | { type: "since"; after }
  | { type: "invite"; record }
  | { type: "role"; record }
  | { type: "removal"; record }
  | { type: "ephemeral"; workspaceId; deviceId; payload; signature };

type HostMessage =
  | { type: "joined"; protocolVersion; workspaceId; newestEpoch; frames; oldestIndex; members }
  | { type: "frame"; index; frame }
  | { type: "applied"; deviceId; role; seq }
  | { type: "invited"; inviteId }
  | { type: "waiting"; deviceId; name; inviteId; role }
  | { type: "roster"; members }
  | { type: "ephemeral"; workspaceId; deviceId; payload; signature }
  | { type: "removed" }
  | { type: "refused"; reason }
  | { type: "error"; code; message };
```

`frame` is a sealed frame: an MLS message with a readable header and a ciphertext payload. The relay
never opens the payload. `since.after` is inclusive: `since(n)` returns frames whose stored index is
at least `n`.

### First sync

1. The client opens the socket, sends `join`, and the relay answers `joined` with the newest epoch,
   the frame count, the oldest index it still holds and the roster.
2. The client asks `since(0)`, or `since(cursor + 1)` when it has applied frames before, and the relay
   sends each held frame with its index.
3. The client applies the frames in index order: commits first, then the application frames they
   unlock. A frame newer than the client's epoch is a cue to catch up, not something to open.
4. Live frames are forwarded as they arrive, with the index the relay assigned.

### Reconnect

The same exchange with the cursor the client persisted beside its group. The cursor is the relay's
own numbering, not a count that starts at zero in each process. A cursor below `oldestIndex` is a gap:
the relay no longer holds the frames after it, so the device needs a snapshot from a peer.

### Presence

Presence is not in the durable message set. It travels as an `ephemeral` message that the host
**verifies, forwards and forgets**: never numbered, never appended to the log, never written down. A
cursor in the log would be a document that grows every time somebody moves.

It is deliberately not a frame. A frame carries the group's application ciphertext, which ratchets per
message, so one dropped cursor would leave a gap in the secret tree that the next _document_ update
would have to work around. Presence is sealed with a key derived from the group instead
(`exportKey(group, "suite/presence", workspaceId)`), so it can be late, out of order or absent and cost
nothing. A device in another epoch simply cannot open it, which is the right answer for something that
only describes the present.

The check that admits it is **membership, not permission to write**: a reader whose cursor nobody could
see would make collaboration mean collaboration between editors. A socket may only speak for the device
it joined as, whatever a signature says.

A position is persisted only when the reader releases the drag, which is a normal document write.

### Removal

The commitment that takes a device out of the group is ciphertext, so the host is told separately: a
`removal` record, signed by an owner, beside the role records. The host drops that device's socket,
corrects the roster, and refuses it afterwards. The device is told `removed` before its socket closes,
because a bare close reads as a bad connection and the app would offer a retry that can never work.

The owner reports the revoke as done only when the host has numbered and echoed the commit. A removal
record that landed without a commit closes the door but does not rotate the key, so a commit the host
refuses as stale is sent again; a relay that goes away means the revoke did not complete.

Spending a fresh invitation is what lets a removed device back in: an owner minting one is the
permission, so "remove" is not a door that only opens one way. A removed device may say which
invitation it holds when it joins (`inviteId` on `join`), which is how it explains itself at the door
rather than being told it is removed with no way to answer.

## The frame

The host stores one opaque record per message. It can read the header and nothing else.

```ts
type Frame = {
  kind: "keypackage" | "commit" | "welcome" | "application"; // application = a document update
  workspaceId: string;
  deviceId: string; // who sent it, and whose signature it carries
  epoch: number; // the MLS epoch the sender was in; 0 for a key package
  payload: string; // base64 of the encoded MLS message
  signature: string; // device key over the header and payload
  receivedAt: string; // stamped by the host
};
```

**A client reads a frame only at the epoch it is in, with one exception: a commit at its epoch plus
one.** The library does not do this: the spike showed a commit from an already-passed epoch is quietly
absorbed as an application message rather than refused ([Decisions](reference/decisions.md)). The
receiver holds the epoch comparison, and a frame newer than its epoch is not something to open: it is a
signal that a commit is missing, and the receiver asks for the frames after its last applied index
before it opens anything. The host refuses to store a frame whose epoch is older than the workspace's,
except a key package, which carries `0` because a device with no group has no epoch and is the join
request rather than a message in the ordering.

Sizes, measured rather than estimated: a commit is 0.5 kB, a welcome 0.8 kB, an application message
0.3 kB, and a device's group state 1.6 kB.

## Relay transport

The transport is a WebSocket at `/sync` with a `/health` HTTP route.

- `join` must be the first message. It carries the protocol version, workspace, device, public key and
  name. The relay pins the key the first time it sees a device and refuses the same device id with a
  different key.
- `frame` is accepted only for the joined workspace, from a device with a role (a key package is the
  one exception), at an epoch no older than the newest the relay holds, and only when the device-key
  signature verifies. The relay numbers it, appends it to the store, echoes it to the sender and
  forwards it to the other sockets in the room.
- `since` returns the frames whose stored index is at least `after`. Positions are durable across
  compaction, so a client that reconnects can tell a gap from an empty catch-up.
- `keypackage` is how a device with no role asks to join. A live, signed invitation authorises it; the
  relay spends the invitation, pins the key and sends the waiting device's name and promised role to
  the other members. The invitation is a single-use bearer token: whoever spends it first is in.
- `role`, `invite` and `removal` are signed public metadata. The relay applies them without reading a
  frame: a role gates who may write, an invite is the join capability, and a removal closes the socket
  and drops the device from the roster.
- `ephemeral` is presence. It is verified, forwarded and forgotten: never numbered, appended or
  written down.
- `error` codes: `protocol-version`, `not-joined`, `malformed`, `unknown`. A refused frame, role,
  invite or removal is answered with `refused` and its reason.
- The relay binds to `127.0.0.1` by default; `--host` is explicit. Loopback may serve `ws://`. Any
  address other machines can reach serves `wss://` with `--tls-cert` and `--tls-key`; the relay
  refuses a plaintext bind there unless `--allow-plaintext` makes that exposure explicit. TLS is
  transport-only: the certificate is self-signed, so clients pin its SHA-256 fingerprint rather than
  trust a chain, and a different certificate is refused before the WebSocket opens. Frames still
  protect content from the relay, while the pin protects the header and timing from a passive network
  attacker or an unpinned MITM; an attacker can still drop traffic.
- The CLI's `serve` also requires `--trust-all` because it has no device-key verifier; Start runs that
  same CLI on loopback. A relay on a reachable address is run directly with its TLS pair and
  `--trust-all-remote`.
- `serve` opens a read-only console on its own loopback port with a token generated at startup. The
  console reads the relay's metadata and draws a `suite://relay` code; it never opens a frame.

A relay code is `suite://relay?u=<url>&f=<fingerprint>&w=<workspaceId>&i=<inviteId>`. `u` and `f`
are enough to meet and pin a relay; `w` and `i` are added together, and only when the console holds a
live invitation. A `wss://` code without `f` is refused. The relay and its console know nothing about
friends: a friend code and a contacts file belong to each app's main process, and the relay never
stores either.

## Friend codes and signed invitations

A friend code is a 16-symbol Crockford base32 name for an installation: 70 bits of
`SHA-256("suite/friend-code/v1" || public key)`, a 10-bit checksum, and no secret. It is
`suite://friend?c=<code>` and, when the link is a QR that may carry the key, `k=<publicKey>`; a
code alone is a promise to be introduced, and the first signed invitation completes it. Codes are
shown as four groups of four.

A new invitation is the same `suite://join` link with an envelope in `e`, base64url of canonical
JSON signed by the inviter's install key:

```text
from:      { deviceId, publicKey }
relay:     { url, fingerprint }
workspace: <workspaceId>
invite:    <inviteId>
to?:       <friend code>        // optional, the person it was written for
expiresAt: <ISO-8601>
nonce:     <random>
signature: <Ed25519 over the canonical envelope>
```

The legacy `h`, `w` and `i` fields stay beside the envelope, so a build without friend codes still
joins. A build that understands `e` verifies the key/device binding, the signature, the expiry and
the relay pin, then resolves the inviter's code against its own contacts list. A known contact
connects without a second certificate question; a known code with a different key is refused; an
unknown code is refused with the code to add. Adding a contact is the explicit act. The relay sees
only the invitation record it already understood.

The store is one append-only file per workspace for frames, and one each for roles, invites, pinned
keys and removals. A frame file holds the sealed frame with the position the relay assigned, plus a
header recording the next position so a compacted log does not move a client's cursor. There is no
document, no snapshot and no version vector on disk. The accepted metadata and the retention window
are in [the blind relay record](reference/blind-relay.md).

## Security invariants

1. The server never holds the workspace key in plaintext.
2. The server never decrypts a document update or an attachment.
3. A join is authorized by a signed member record and a capability; a workspace id is not a secret.
4. A viewer cannot write, even if the client is modified; the server refuses the update.
5. A revoked member's next join is refused and their live connection is dropped.
6. Presence is never written to the document.
7. A server operator can deny service or delete ciphertext; the threat model says so.

The relay satisfies 1–7 for the frames it stores: it holds no group key, opens no payload, and keeps
only the signed metadata it needs to admit or refuse a frame. A `wss://` relay changes the network
exposure rather than the content boundary: the self-signed certificate is pinned by SHA-256, so a
passive attacker no longer sees the header or timing and a substituted certificate is refused, while
frames keep the payload sealed from the relay itself. An attacker can still drop traffic.

## Open questions

- Retention and compaction: how many frames, snapshots and daily backups. The host cannot merge what
  it stores, so a client offline past the window needs a snapshot from a peer.
- Attachments: content-addressed blobs, and which key addresses them.
- Host promotion: who may take over when the host machine is gone, and how a client learns the new
  address.
- Recovery: MLS has no escrow, so the kit is a design decision about what to export, not a library
  call.
