# The sync capability

A host can offer sync to an app or a pack as one capability: status, the four doors, and a
channel that moves sealed frames. The app or pack keeps its document and its keys; the host
keeps the socket, the relay address and the readable membership metadata. This page is the
boundary a host implements, and the one Planner and Canvas already sit behind.

The protocol itself is [the sync protocol](../protocol.md). This page does not repeat its message
set; it states what may cross the capability and what may not.

## What stays, and what moves

| Stays with the app or pack            | Moves through the host                                     |
| ------------------------------------- | ---------------------------------------------------------- |
| Document bytes, schema and snapshots  | The relay WebSocket and its address                        |
| The group key, epochs and ratchets    | Sealed frames, in order, with the host's numbering         |
| Sealing and opening a payload         | Device ids, names, roles, invitations and removals (signed metadata) |
| The decision to invite or revoke      | Connection state, frame counts and refusals                |

The host is not a member of the group. It orders and stores handshake and application frames, and
it cannot open one, merge two, or answer a question about a document. The metadata it reads is the
same metadata [the threat model](../threat-model.md#accepted-limits) already accepts: ids, epochs,
frame kinds, sizes, timing, roles and invitations.

## The operations

The contract is `SuiteSyncCapability` in `@suite/contracts`.

| Call                                | What it does                                                        | What crosses                     |
| ----------------------------------- | ------------------------------------------------------------------- | -------------------------------- |
| `status()`                          | Report what sync is doing now, without opening a socket             | State and, when relevant, a reason |
| `enable(workspaceId, relayUrl)`     | Start syncing that workspace through that relay, or reconnect       | A workspace id and a `ws://` URL |
| `disable()`                         | Stop this copy. The document, group and membership stay             | Nothing                          |
| `invite(role)`                      | Write one single-use invitation and return its link                 | The promised role and the link   |
| `join(link)`                        | Ask to join from a link somebody shared                             | The link                         |
| `members()`                         | The roster the readable metadata last named                         | Device ids, names and roles      |
| `send(frame)`                       | Hand one sealed frame to the host                                   | Opaque bytes                     |
| `onFrame(listener)`                 | Take one sealed frame the host delivered                            | Opaque bytes                     |
| `onMembership(listener)`            | Act on a roster change                                             | The new roster, nothing else     |

`enable` takes the workspace id explicitly. A host serving a pack cannot read the pack's document,
so it cannot derive the id from an open file; the app supplies the sync identity the document
already owns. The id is a fingerprint, never a key.

## What the states mean

A UI can act on every value without knowing the protocol's words.

| State        | Meaning                                                          | What a person may do                 |
| ------------ | ---------------------------------------------------------------- | ------------------------------------ |
| `off`        | This copy is not syncing                                         | Enable it                            |
| `connecting` | A connection is being made                                       | Wait                                 |
| `syncing`    | Frames are moving; `count` is the host's frame count at join     | Invite, copy a link, leave           |
| `asleep`     | The host is not answering, and a retry is reasonable             | Wait, retry, or check the host       |
| `refused`    | The host or an invitation said no                                | Read the reason, correct it          |
| `waiting`    | An invitation was spent and the welcome has not arrived          | Wait, or ask the owner               |
| `removed`    | An owner took this device out of the workspace                   | Nothing automatic; a fresh invitation is needed |

`removed` is not `asleep`: offering a retry for a decision somebody made would promise something
that can never work. `syncing.count` is about the host's log, not a document version, so it is
never shown as "cards" or "changes".

## The sealed-frame channel

A frame is opaque bytes. The app or pack seals a document update with its group key before
`send`, and opens a frame in `onFrame` after the host has delivered it. The host never holds the
key and never sees the plaintext. The relay may read the protocol header it needs to admit and
forward the frame; the payload stays ciphertext, exactly as [the protocol](../protocol.md#the-frame)
states.

`onMembership` travels beside the frames rather than through them. A notice carries the whole
roster — device ids, names and roles — because it is small, it is already public, and a consumer
that missed one notice is still correct after the next. Adding a device, changing a role or
revoking one is a membership notice; none of them carries document content.

Frames are delivered in the order the host stored them. An implementation that owns the sealer
also owns the cursor rule from the protocol: a frame newer than the current epoch is a cue to
catch up, not something to open.

## Failures

A failed call throws a `SuiteSyncCapabilityError`, whose serialised shape is:

```ts
type SuiteSyncError = {
  code:
    | "no-workspace"
    | "bad-relay"
    | "wrong-workspace"
    | "not-connected"
    | "bad-link"
    | "not-owner"
    | "already-member"
    | "refused"
    | "removed"
    | "unreachable"
    | "unknown";
  operation: "status" | "enable" | "disable" | "invite" | "join" | "send" | "members";
  message: string;
};
```

`operation` names what was being attempted, so a caller can recover without parsing prose. The
message names the next action — "Enable it before writing an invitation", "Open a copy of the same
workspace first" — and never names a document, a key or the contents of a workspace. A failure is
about the connection, the invitation or the role; saying more would leak what the boundary exists
to protect.

## Where it is implemented today

Both desktop apps expose their existing sync through this contract, in the main process, without
moving a key or a socket and without changing what the window sees:

| App     | Adapter                                          |
| ------- | ------------------------------------------------ |
| Planner | `apps/planner/src/main/sync/capability.ts`       |
| Canvas  | `apps/canvas/desktop/src/main/sync/capability.ts` |

The adapter is the seam, not a rewrite. The menu bar, the dialog, the file and the renderer behave
exactly as before; the adapter names the same four doors and the same status the service already
had. Today each main process is both ends of the boundary — it owns the document and seals the
frames — so `send` carries the app's payload and the service seals it before the relay sees it.
A host that implements `SuiteSyncCapability` later receives the sealed frames instead, and neither
app's UI has to change.

The host-side test lives with the contract: a fake app seals a document with a key, a fake host
implements the capability, and the test asserts that neither the document text nor the raw key
appears in any frame or membership notice the host side received.

## Go, for now

The container's module contract reserves a `sync` capability; it is **not implemented on Go yet**.
No pack running in Go can use it, and none of this page describes mobile support. The reserved row
in [the module contract](../../../go/docs/reference/contract.md#what-the-host-provides-and-what-it-refuses-to)
states the same boundary for a future implementation: sealed frames out, sealed frames in, and
document bytes and keys staying with the pack.

## Open questions

These are the protocol's, not the capability's, and this page does not decide them:

- Retention and compaction, and how a device away longer than the window gets a snapshot.
- Attachments: content-addressed blobs and which key addresses them.
- Host promotion, and how a client learns the new address.
- Recovery, because MLS has no escrow.

See [the protocol's open questions](../protocol.md#open-questions) and
[the blind relay record](blind-relay.md) for the parts that are decided.
