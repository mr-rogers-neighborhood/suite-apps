# The blind relay: keys, frames and the epoch

A relay that stores frames it cannot read has been the target since [Decisions](decisions.md).
This record is the design: which key does what, what the relay keeps, what a revoke rotates, what a
wake may say, and what happens to a demo workspace that predates all of it.

It is the design record, and it describes what the merged tree does. Where a part is still future, it
says so. The message set the tree runs is [the protocol](../protocol.md); the conversation
as a session type is [the protocol as a session type](../protocol-sessions.md); the accepted risks are
[the threat model](../threat-model.md).

## The shape

One MLS group per workspace. One leaf per device. The group is the key: every member device can
derive the current epoch's secrets, and no other party can. The relay is a mailbox that numbers
frames, checks a device signature and a role record, stores the bytes and hands them on. It is not a
member, holds no group state, and never opens a payload.

The client keeps the only decryptable copy. That is what makes the relay replaceable and the document
a file the app owns.

## Keys

Three kinds, in an authority hierarchy rather than a derivation chain. A device key is not derived
from the workspace key; membership is what joins them.

| Key           | What it is                                                                                           | Where it lives                                                                                                        | What it does                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Root key      | Ed25519, one per workspace, made when the workspace is first shared                                  | the creating device, beside `sync/identity.json`, and its recovery kit; never another device, never the relay         | signs one record, the genesis, for the id the document already owns. Encrypts nothing.         |
| Workspace key | the MLS epoch's secrets, and the labels exported from them (`suite/workspace-key`, `suite/presence`) | every member device, in the group state at `dataDir/sync/groups/<workspaceId>.mls` (1.6 kB measured); never the relay | encrypts frame payloads and the content that travels outside a frame. A new value every epoch. |
| Device key    | Ed25519, one per installation                                                                        | that device, in `sync/identity.json`, mode 0600; the public half is pinned by the relay                               | signs frames, role records, invites, removals and presence. Its SHA-256 is the device id.      |

### Root

- The workspace id is the id the app's document already owns when the workspace is first shared. The
  root signs that id; it does not derive it, and this record does not migrate a document id. The id
  travels in the app's own document file; the relay sees the workspace id and never a document id.
  `workspaceIdFromRootKey` is the derivation for a workspace created root-first,
  and `genesisNamesItsRoot` distinguishes a root-first id from a document-first one. The shipped
  Canvas path is document-first, so the check is false and the genesis is still valid.
- The root signs one record: the genesis. It carries the workspace id, the creation time, the
  creating device's id and public key, and the relay address the workspace was created against. It is
  the first record in the workspace's local history, before any role record. It is not a frame, and
  the relay never receives it: `HostStore` stores frames, roles, invites, pinned keys and removals,
  and has no genesis record type. The creating device's root file
  (`dataDir/sync/roots/<workspaceId>.json`) owns it, and the recovery kit carries it.
- The root private key is never copied to another device, never wrapped into the group, never sent to
  the relay, and never written into the document. It travels in the creating device's recovery kit,
  under the same protection as the group state, and nowhere else. A second owner can invite and revoke;
  it cannot re-found the workspace, because it does not hold the root. Ownership transfer is out of
  scope, so nothing else needed it.
- A workspace shared before this record has no genesis. It is not invalid; it is a workspace without
  an identity root, and this record does not migrate it. A workspace shared since then gets one the
  first time it is shared.

### Workspace

- The group state holds the workspace key. `seal()` turns one document update into one MLS application
  message; `open()` turns it back. `exportKey(group, "suite/workspace-key", workspaceId)` derives the
  key for content that is not itself an MLS message: a snapshot handed to a device that fell outside
  retention, and attachments when they exist. `suite/presence` is the same idea for cursors.
- There is no long-lived content key. A key that survived a revoke would let the removed device read
  later frames if it ever received one. The epoch is the unit of forward secrecy, and a new value
  every epoch is the point.
- The group state is written with a temp-file rename, mode 0600. Losing it without a peer or a
  recovery kit means losing the ability to read the workspace; MLS has no escrow. The kit
  (`sync/kit.ts`) carries the device identity and the group state, plain or sealed with a passphrase.
  That is the recovery answer, not a server-side backup.
- A device at an older epoch can open nothing sealed after the commit that moved it. It does not get
  plaintext and an error; it gets an authentication failure.

### Device

- One install key, Ed25519, made on first run. It signs the frame header plus payload
  (`framePayload`), and the records beside the frames. The relay pins the public key on first join and
  refuses a frame signed by any other key for that id. A reinstall that keeps the id and changes the
  key is refused rather than guessed at.
- It is deliberately not the key inside the MLS credential. The MLS leaf key belongs to the group and
  is made with the key package; the install key belongs to the installation and still works after the
  device has been removed from every group. Confusing the two is how a removed device would be
  mistaken for a new one.
- The install key is not a decryption key. Revoking a device does not revoke it; it removes the leaf,
  so the epoch that device could read stops.
- It lives in the main process, beside the group state. A renderer never holds either.

### What opens what

| Thing                            | Key                                                    | Where it is opened                           |
| -------------------------------- | ------------------------------------------------------ | -------------------------------------------- |
| Application frame (an update)    | the epoch's MLS application secret                     | a member device, `open()`                    |
| Commit                           | the epoch's MLS handshake secret, or public and signed | a member device, `applyCommit()`             |
| Welcome                          | the joining device's key package                       | the joining device, `joinWorkspaceGroup()`   |
| Key package                      | none; it is public by design                           | anyone; it is the join request               |
| Snapshot or attachment (future)  | `suite/workspace-key` of the epoch that produced it    | a member device                              |
| Presence                         | `suite/presence` of the epoch                          | a member device; the relay only forwards     |
| Role, invite and removal records | none; signed public metadata                           | the relay checks the signature; clients read |

A public commit is signed, not secret. Its path secrets are encrypted to the remaining members, but
its structure is not a document. A key package is public because an owner has to read it to add the
device.

## The frame

The relay stores one record per message. It is the unit of ordering, retention and replay. It is not
a document. The stored record is this frame together with the position the relay assigned it; the
position is not part of the signed frame, so it never travels inside the payload or the signature.

```ts
type Frame = {
  kind: "keypackage" | "commit" | "welcome" | "application";
  workspaceId: string;
  deviceId: string;
  epoch: number;
  payload: string; // base64 of the encoded MLS message
  signature: string; // device key over the header and payload
  receivedAt: string; // stamped by the relay
};
```

| Field         | Value                                                     | Why the relay may read it                                                     |
| ------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `kind`        | `keypackage`, `commit`, `welcome` or `application`        | it must admit a key package from a device with no role, and it orders the log |
| `workspaceId` | 64 lower-case hex                                         | the unit it orders and retains                                                |
| `deviceId`    | 64 lower-case hex                                         | the sender and the signer; for a key package, the device asking to join       |
| `epoch`       | the MLS epoch the sender was in; `0` for a key package    | it refuses a frame older than the newest it holds                             |
| `payload`     | base64 of the encoded MLS message                         | it stores and forwards the bytes without opening them                         |
| `signature`   | base64 Ed25519 over the five header fields joined by `\n` | it checks the sender without decrypting anything                              |
| `receivedAt`  | ISO-8601, stamped by the relay                            | retention; never ordering                                                     |

The protocol page lists the three frame kinds that carry group traffic. `keypackage` is the fourth,
and it is the only kind a device with no role may send. `receivedAt` is excluded from the signature:
the sender does not get to say when its frame arrived.

### Sizes

- Measured, from [the protocol](../protocol.md#the-frame): a commit is 0.5 kB, a welcome 0.8 kB, an
  application message 0.3 kB, and a device's group state 1.6 kB.
- The header is bounded by its fields: two 64-character ids, a kind under ten characters, an epoch
  under 16 digits, an 88-character signature. It is under 400 bytes before the payload.
- The design bound is 1 MiB of base64 text (about 0.75 MiB of bytes), so one member cannot fill the
  store with one write. **This build does not enforce it:** `frameSchema` accepts any non-empty
  payload string, and the relay has no size check before it stores one. It is an operational bound,
  not a measured one; the largest measured message is 0.8 kB. An update larger than the bound must be
  split by the app; chunking is not designed. The number is not a protocol guarantee and a later
  measurement may move it.
- The count is bounded by the retention window (30 days by default), not by a per-day message limit. A
  relay may drop the oldest frames; it cannot merge them.

### Ordering and the cursor

- The relay assigns each stored frame a position, and that position is the cursor a client sends in
  `since(after)`. The position must be monotonic and durable across compaction: a client that
  reconnects with an old cursor must be able to tell that the relay no longer holds what comes after
  it, and ask a peer for a snapshot instead of concluding it is current.
- Today the position is stored with the frame in `FrameLog` and `FileHostStore`, so compaction drops
  entries without renumbering the ones that remain. `joined` reports `oldestIndex`, the oldest position
  the log can still serve; a cursor below it is a gap, not an empty catch-up. A file written before S3
  has bare frame lines, which are read as consecutive positions from zero.
- The client persists the last index it applied beside the group, so a reconnect asks
  `since(cursor + 1)` from the relay's numbering rather than a count that starts at zero in each
  process. With positions stored by S3, a cursor older than a compaction is now visible as a gap.
- Signatures make attribution independent of the relay's order, but not causality: commits chain, so a
  client applies them in index order and does not skip to the newest.

### What the relay may learn

It may learn:

- the workspace id, and that the workspace exists;
- the device id of each sender, and therefore which device is active, when, and how often;
- the epoch, and therefore that the group changed;
- the kind: a key package, a membership frame, or an application frame;
- the payload length, and therefore a bound on the update's length;
- arrival time, order and count;
- how far each device has caught up, from its `since` cursor;
- the records beside the frames: device names, public keys, roles, invitations, removals and the
  roster.

It must not learn:

- one byte of a document: no title, card, file name, attachment, word or layout;
- a document id. The frame has none; a workspace is the unit. A relay that knows which document moved
  knows the document graph, and this design never gives it one;
- which document changed. It sees frames arrive for a workspace, never a document advance;
- a version vector. The vector travels inside the sealed payload;
- whether an application frame was applied, was a duplicate, or was a no-op. "Advanced" is a plaintext
  fact, and the relay has no plaintext;
- a human identity beyond the device id and the name the device chose.

`kind` is the one content-adjacent bit the relay reads, and it is accepted. Hiding it would not hide a
commit, because a commit is the frame that changes the epoch, which the relay reads anyway. It would
only hide whether two frames in the same epoch were membership or content. The join exception needs
`keypackage` to be visible.

Size is not hidden. MLS padding is at its default, so a frame's length is a function of the update's
length; the threat model already accepts sizes. A future padding policy would change that, and would
change the bound above.

The shipped CLI's `--trust-all` accepts a frame and a role record from any device because there is no
device registry yet. That is a development flag, not the target: the target is the pinned key and the
role record, checked on every frame.

## Revocation and the epoch

### What an epoch is

An MLS group has an epoch, one per commit. `DeviceGroup.epoch` is that number as a JS number; the
library counts in a bigint. Frames carry the epoch the sender was in. A device's group state and its
epoch move together: an epoch without the state is a number, not a key.

### What the tree does today

The two halves exist and are wired in Canvas's desktop service:

1. `removeDevice(group, leaf)` produces a Remove commit and advances the committer's group.
   `applyCommit` moves every other remaining member. `group.test.ts` covers a removed device failing
   to open what was sealed after the commit, and a third device following a removal it did not write.
2. The `removal` record is the relay's half: signed by an owner, it makes the relay drop the socket,
   refuse the device and correct the roster (`server.ts`, `handleRemoval`). It is not a frame, and it
   does not change the relay's `newestEpoch`.
3. `service.ts` sends the commit first and the removal record second, then waits for the commit's
   numbered echo before it resolves. A commit the relay refuses as `stale-epoch` is sent again; a
   relay that goes away, or refuses it for another reason, means the revoke did not complete and the
   app is told so. The echo is the relay saying it numbered the bytes.

So a revoke does bump the epoch today, because the owner's client makes the commit, and the service
waits for the relay's numbered echo before it calls the revoke done.

### What a revoke must do

1. The owner's device finds the leaf (`leafIndexOf` by device id), calls `removeDevice`, saves the new
   group state, and sends the commit as a frame at the new epoch.
2. It sends the removal record, signed by its device key. The record is what lets the relay act
   without reading: close the socket, refuse the device, correct the roster. The commit is what makes
   the removed device unable to read what follows.
3. The owner waits for the commit's numbered echo before the app says "removed". A removal record that
   landed without a commit closes the door but does not rotate the key; that is a half-done revoke,
   and the app must not describe it as done. If the commit is refused, retry it. If the relay is gone,
   the revoke did not complete, and the app says so.
4. Every remaining member applies the commit and moves to the new epoch. A member that does not is
   stuck at the previous epoch and reads nothing new; it must catch up before it writes.
5. The relay stores the commit and moves `newestEpoch`. It does not apply it, cannot apply it, and does
   not need to: its job is to keep the bytes and refuse an older epoch.

What rotates: the epoch's MLS secrets, the derived `suite/workspace-key`, and the `suite/presence`
key. What does not: the device install keys, the root key, the workspace id, the relay address, the
role records, and every frame already stored. Old ciphertext remains readable to anyone who kept the
old epoch key. Revocation is forward-only, and the app should say so in one sentence rather than
imply the copy is gone.

Who re-wraps: nobody, per device. The commit's path encrypts the new secrets to the remaining leaves;
every remaining device derives the same epoch from the commit. There is no list of per-device wrapped
keys for the relay to store, and adding one would give the relay a membership map it does not need.

### A stale client

The rule this record settles:

- A frame is conforming at the receiver only when its epoch is the receiver's epoch.
- The one exception is a commit at the receiver's epoch plus one: applying it is how the receiver
  moves. A commit at any other epoch is either already past (drop) or not reachable yet (catch up from
  the cursor, then apply in order).
- A frame older than the receiver's epoch is dropped silently. This is the client's job; MLS decrypts
  a stale commit with retained receiver data and hands it back as an application message rather than
  refusing it. The test is `ignores a frame from an epoch it has left`.
- A frame newer than the receiver's epoch is not conforming, even an application frame. It is a signal
  that a commit is missing. The client must not try to open it; it asks for the frames after
  `lastAppliedIndex` (`since(lastAppliedIndex + 1)`), applies the commits in index order, and only
  then opens the application frames that follow.
- If the cursor is older than the relay's oldest retained frame, the client cannot catch up from the
  relay. It needs a snapshot from a peer, sealed with the `suite/workspace-key` of the epoch that
  produced it, or it stays out. Saying "it will catch up" when the relay has dropped the commit is the
  one wrong answer.
- If the client was removed, the commit that removes it fails to apply and the relay says `removed` on
  the next join. The client stops; it does not retry a frame, and the app says the device was removed.
  It keeps its old copy and old keys.

Two consequences:

- [The protocol as a session type](../protocol-sessions.md) states `epoch ≥ my epoch` for a conforming
  frame. This record sharpens that: a newer frame is not conforming either; it is a reason to catch
  up. The service applies `frameRejection` and, for a frame newer than its epoch that is not the next
  commit, asks for `since(cursor + 1)` instead of opening it.
- `frameRejection` in `frame.ts` now carries the commit exception: exact equality for every kind, plus
  a commit at the receiver's epoch plus one. It is the service's rule, not a second opinion beside it.

### The key package exception

A device with no group has no epoch. Its key package carries `0`, and the relay must not measure it
against `newestEpoch`. `admitFrame` now exempts `keypackage` from the epoch floor while keeping the
role and signature checks; every other kind is still measured against the newest stored epoch. The
client handles a key package before its own epoch rule for the same reason, because a device joining a
workspace that has already moved is asking to join, not posting an old frame.

## Wakes

A wake is a routing hint, not a frame: not stored, not numbered, carrying nothing a person could read.

```jsonc
{
  "kind": "wake",
  "workspaceId": "<opaque id>",
  "deviceId": "<device>",
  "sentAt": "<timestamp>"
}
```

The shape and the argument for it are in
[the Go proposal](../../../go/docs/reference/blind-doorbell-proposal.md). This record accepts it and
adds the rules the relay needs. The proposal writes `workspace` and `device`; the relay's messages use
`workspaceId` and `deviceId`, and this record follows the protocol's names.

A connected device already receives frames, so a wake exists for the device with no socket. It is
delivered by the push path, not as a message on the sync socket, and it is not part of the stored
message set.

### Why the relay cannot say which document changed

Three reasons, in order:

1. The payload is opaque. The relay cannot compare version vectors, read a document id, or tell
   whether an update changed anything. A frame can be a duplicate, a no-op, or a schema the app will
   reject.
2. The frame names a workspace, not a document. Today one workspace is one Loro document, so a wake is
   no coarser than a frame already is. It still names no document, and a workspace that later holds
   more than one cannot use the wake to name one.
3. "Advanced" is a fact about plaintext. The relay knows a frame arrived for a device; it does not
   know that the document moved. That is why a wake says "connect and sync", and why the recipient's
   only legal response is `since`.

`kind` says membership or application, never which document. `epoch` says the group moved, which the
relay already reads to order the log.

### Coalescing

- One pending wake per (workspace, device). A second frame while one is pending does not produce a
  second wake. The pending one may be dropped instead of sent; a wake is an optimization, and a sync
  that finds nothing is a cheap no-op.
- The relay chooses the window. The protocol does not fix a number, because a number would be a
  promise about a delivery channel this build does not have. A relay that sends at most one wake per
  device per window is within the design; one that sends one per frame is not coalescing. What the
  window is, is relay policy, and S4 picks one.
- Coalescing across workspaces would mean a wake with no workspace, which this record does not
  define. A relay that wants it can send one wake per workspace and let the client collapse them; the
  client is the one that knows which documents it cares about.
- A wake never carries a document id, a version vector, an author, a count, or a change size. Those
  are the fields [the proposal's table](../../../go/docs/reference/blind-doorbell-proposal.md) forbids,
  and the reason is structural: none of them is a message the relay's projection ever carries.

### What the recipient does

1. If the app is not running, the delivery channel starts it. This build has none; the only trigger in
   the tree is the app coming to the foreground (`syncTrigger.ts` in Go). Canvas reconnects when sync
   is enabled and has no foreground trigger of its own.
2. Connect, `join`, read `newestEpoch`, `frames` and the oldest index still held.
3. `since(lastAppliedIndex + 1)`; apply frames in index order, commits before the application frames
   they unlock.
4. Use the decrypted version vectors to decide whether anything is new for the document in view. Only
   then notify the person. The wake itself is never a notification.
5. If the cursor is older than what the relay holds, ask a peer for a snapshot. If the device was
   removed, stop.

A wake never authorizes a write, never proves there is anything to fetch, and never says who changed
it.

### What the relay must not do

- It must not send a wake that names a document, an author, a size or a count.
- It must not treat "device is awake" as "device has read"; delivery is not acknowledgement.
- It must not make correctness depend on a wake. A device that never receives one still syncs when it
  reconnects or comes to the foreground.

## Demo workspaces

Decision: **the relay refuses a plaintext store; the app re-creates the workspace from its own copy.**
It does not convert in place and does not delete.

- The old demo shape is a directory with `membership.json` and `snapshot.loro`. The current `serve`
  reads a `--store` of `<workspaceId>.frames.jsonl` files and has no `--workspace` loader, so an old
  directory is not read today. If it were pointed at one, it would find no frames and start an empty
  room, which is the silent version of the same mistake.
- A blind relay must not grow a parser for plaintext it is not supposed to read. Converting a
  plaintext store means reading it, and a store it cannot authenticate is not a document of record.
  So the relay refuses a store directory that contains `snapshot.loro` or `membership.json`, names the
  path, and says what to do. It does not rewrite or delete; deleting a person's file is the person's
  decision.
- The conversion is in the app. The owner opens the local document (Canvas's file or its IndexedDB
  copy), creates a fresh workspace under this record — new root key, new MLS group — and invites the
  devices again. The document survives and keeps its own id; the old plaintext sync workspace does
  not. That is a re-creation, not a migration.
- The old plaintext store's workspace id and invite links stop working. Every device is re-invited.
  That cost is acceptable for a demo, and it is why this record does not carry a compatibility path
  for a store that predates the group.
- If the server's plaintext snapshot is the only copy, it is not a document of record. The refusal
  message says to open the app and export; if there is no app copy, the demo data is lost, and the
  message says that too.

The tree has already moved past the issue's description in one respect: `apps/sync` has no Loro
dependency, the host stores frames, and Canvas's desktop service seals each update before sending it.
The plaintext replica survives only in the old demo directory format; the CLI and the pages now
describe the frame store. This record is therefore less about turning encryption on than about making
the key hierarchy, the revoke, the wake and the demo exit true at once.

## Follow-on slices

S1 is this record. The four that follow are named by what changes; the tracker numbers them S2–S5.

**S2 — keys and the group lifecycle (landed).** The root key and its genesis are made when a workspace
is first shared, and a workspace that predates them opens unchanged. A revoke waits for the commit's
numbered echo before the app says "removed". `admitFrame` exempts a key package from the epoch floor
and nothing else. A stale client keeps its last applied index beside the group and catches up from
that index rather than from a count that only means anything within one process. `frameRejection`
carries the commit exception, and the service uses it. Covered by a second device joining a workspace
that already has frames, a revoked device failing to open a post-revoke frame, and a member one commit
behind catching up and writing again. S2 landed on the tree's side of two disagreements: the workspace
id is the document's own id, which the root signs, and the genesis belongs to the creating device's
root file rather than to the relay's store.

**S3 — the frame log (landed, except the size cap).** Store the position with the frame so it survives
compaction. Report the oldest index still held, so an old cursor reads as a gap rather than an empty
catch-up. Keep the retention window on ciphertext, with no plaintext snapshot and no merge; the 1 MiB
payload bound above is still a design bound, not a check in this build. Done when a frame round-trips
byte for byte, the stored file contains no known plaintext, and a cursor older than retention is
detected. S3 landed on the tree's side of the third disagreement: `since(after)` is inclusive, so the
client asks for `cursor + 1`.

**S4 — the wake.** Define the `wake` message, coalesce per device, and pick one delivery channel
(UnifiedPush or an endpoint on the user's relay), with the foreground fallback kept. Done when N frames
in a window produce one wake, and a wake causes `since` and a sync and names no document.

**S5 — the demo exit.** Refuse a plaintext store with a named path. Remove `workspace init`,
`membership.json` and `snapshot.loro` from the CLI and the pages. Re-create the Canvas demo under S2
and S3. Done when a plaintext store is refused and two clients sync a document the relay cannot read.

## What this does not settle

- **TLS.** The relay protocol is `ws://`, and the guide says there is no TLS. Frames protect content
  from the relay and from disk; they do not protect the header, timing or availability from the
  network. A network attacker sees workspace, device, epoch, kind, size and time, and can drop or
  replay. `wss://` and certificate trust are a deployment decision, not this record.
- **Group growth.** MLS handles small groups. There is no measured bound, no pagination for a large
  ratchet tree, no per-person multi-device key, and no re-invite at scale. Adding a device is a
  commit, so the join cost grows with the tree.
- **Device loss without a revocation.** A lost device keeps the current epoch and reads everything
  until an owner revokes it. The relay cannot tell a lost device from a quiet one. If the lost device
  is the creator, the root key is gone and the genesis cannot be re-signed; the workspace still reads
  and writes.
- **Size.** The 1 MiB design bound is operational, no measurement justifies it, and this build does
  not enforce it. MLS padding is at its default, so lengths leak, and this record does not require
  padding. An update larger than the bound has no chunking design.
- **A member's epoch claim.** The relay trusts the header's epoch and can be pushed forward to a huge
  number, after which it refuses honest frames as stale. That is a denial of service by a member, not
  a confidentiality break. A rule that an epoch may advance by at most one per stored commit is
  possible, but not decided.
- **A malicious relay.** It can withhold, reorder within its numbering, replay, delete, or lie about
  `newestEpoch`. Signatures and epochs catch some of that, not all. Availability remains the
  operator's.
- **Old ciphertext.** A revoked device keeps what it already had and the old epoch keys. Revocation is
  forward-only.
- **Metadata.** Workspace, device, epoch, kind, size and timing are visible; the threat model already
  accepts this. This record narrows what is added (no document id) and does not hide what is already
  there.
- **Root recovery.** There is no escrow. The root is in the creating device's kit, so losing the device
  and the kit loses the genesis, not the document.
- **Multi-document workspaces.** Today one workspace is one Loro document. If a workspace ever holds
  several, the frame must not gain a document id and the wake stays workspace-wide; the set of
  documents is not designed.
- **Viewer confidentiality.** A viewer may read; the relay enforces that it may not write. That is
  the role.
- **Names.** A device name is self-asserted; the fingerprint is the identity. There is no directory
  and no verification.
- **Attachments, host promotion and the retention number.** The protocol's open questions still own
  them. This record depends on them and does not answer them.

## Evidence

- `mise exec -- node scripts/docs-check.mjs` — the root documentation check, which walks `docs/` and the
  root pages, not this page. Every relative link on this page was resolved against the tree by hand.
- The behaviour described above is covered by `apps/sync/packages/protocol/src/group.test.ts`,
  `apps/sync/packages/protocol/src/genesis.test.ts`, `apps/sync/packages/host/src/blindRoom.test.ts`,
  `apps/sync/packages/host/src/server.test.ts` and
  `apps/canvas/desktop/src/main/sync/service.test.ts`.
- `mise exec -- pnpm --filter @suite/sync-server test` — 146 tests, run against this tree.
