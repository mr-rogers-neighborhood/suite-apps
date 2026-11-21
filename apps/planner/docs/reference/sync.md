# Sync

Planner can carry one workspace between machines through a relay a person runs. The file is still
the document: sync adds copies, not an account or a server Suite operates.

This page is the seam. The protocol is owned by
[`@suite/sync`](../../../sync/README.md) and the reasoning behind the blind relay is in
[the Sync decisions](../../../sync/docs/reference/decisions.md). The rules that bind Planner are in
[decisions.md](decisions.md).

## What a person does

1. One machine opens **Sync** in the menu bar and shares the workspace at
   `ws://127.0.0.1:8787/sync`, the loopback address Start's relay listens on. A relay other devices
   reach is `wss://`; paste its `certificate SHA-256 fingerprint:` line into **Relay certificate
   fingerprint** when the address or invitation is `wss://`.
2. The other machine opens a **copy of the same `.planner` file**. The sync identity of a workspace
   is derived from the id inside the file, so a copy is what makes both devices name the same relay
   room. Nothing migrates and no schema field is added.
3. The sharing machine makes an invitation: one use, one person, good for a day. The link carries a
   signed envelope naming the inviter's installation, the relay and its pin, so the other side can
   tell who wrote it.
4. The joining machine pastes it under **Join with an invitation**. A code in **People you know** is
   the explicit trust act: an invitation from a contact connects without a second certificate
   question, while an invitation from a code that is not listed is refused with the code to add. A
   person with no invitation can still add a friend code or the `suite://friend` link from **Your
   friend code** — the dialog draws that same link as a QR — and be ready for the next one.
5. **Leave** stops the connection. The file, the group and the membership stay; sharing again
   reconnects.

A person without a copy of the file cannot join, because the workspace id lives in the document.
That is the same rule the Canvas demo states, and it is what keeps a workspace from being merged
with an unrelated one.

## Where the pieces live

```
┌────────────────────────── Electron main (authority) ─────────────────────────┐
│  WorkspaceDocument (Loro) ──► file store (.planner, atomic write)             │
│        │            ▲                                                         │
│        ▼            │                                                         │
│  WorkspaceStore.commit(update)          inbox frame ◄── relay                 │
│        │                                      │                               │
│        └────────► SyncService.publish ────────┴──► workspace:replaced         │
│                       │                                    │                  │
│                       ▼                                    ▼                  │
│              identity, group, cursor, pending  ◄── sealed MLS frames          │
└───────────────────────────────────────────────────────────────────────────────┘
                                     │ contextBridge, allowlisted channels
┌───────────────────────────────────▼───────────────────────────────────────────┐
│  Renderer                                                                     │
│  SyncControl: a pill and a dialog. No key, no socket, no frame.               │
└───────────────────────────────────────────────────────────────────────────────┘
```

| Path                           | Responsibility                                                          |
| ------------------------------ | ----------------------------------------------------------------------- |
| `src/main/sync/service.ts`     | Planner's identity, contacts decision, invitations and lifecycle wiring |
| `src/main/sync/identity.ts`    | This install's Ed25519 key; its fingerprint is the device id            |
| `@suite/sync-desktop`          | The group, relay pin, cursor, pending join, frame queue and reconnect   |
| `src/main/sync/workspaceId.ts` | The 64-hex sync name derived from the document's own id                 |
| `src/main/sync/ipc.ts`         | The controller: one service per open workspace, snapshots to the window |
| `src/main/ipc.ts`              | The validated `sync:*` channels and the commit that publishes a delta   |
| `src/renderer/src/sync`        | The pill, the dialog and their wording                                  |

The on-disk mechanics and the connection lifecycle come from `@suite/sync-desktop`. Planner injects
its own data directory, its identity and its events; the package writes the same files under `sync/`
that it always wrote, so an existing workspace opens where it did. What stays here is the trust
decision — verifying a signed envelope and resolving its code against Planner's own
`sync/contacts.json` — plus the capability and IPC surface.

Identity, group state, cursors, a pending join and the relay pin sit in `sync/` beside the workspace
file. The pin is `sync/relays/<workspaceId>.json`, written mode 0600: it is this installation's trust
decision, never a field of `.planner` and never sent to the renderer. The folder is not part of the
`.planner` file and is not copied with it. Losing it leaves the document intact but means asking for a
fresh invitation or entering the relay's fingerprint again; there is no recovery kit yet.

## A local edit

The renderer mutates its replica. Its one `observe` call site forwards the CRDT delta over
`workspace:commit`. Main applies it to the authority, schedules the ordinary 400 ms atomic write,
and now also hands the same delta to the sync service. The service seals one Loro update into one
MLS application message and sends it as a frame. The relay numbers it and stores ciphertext.

## A frame from somebody else

The service opens the frame with the group, applies the plaintext with
`WorkspaceStore.commit(update)`, and sends `workspace:replaced` with the new snapshot to the window.
The renderer replaces its replica exactly as it does after an import and re-subscribes. The file is
written on the same debounce as a local edit, so the durability boundary did not move.

Frames are handled one at a time, in relay order. A frame newer than this device's epoch is a cue to
catch up by cursor, not something to open. The cursor is the relay's numbering, persisted beside
the group, so a restart resumes from a real position rather than from a count that begins at zero.

## Reconnect and the snapshot

A relay that goes away is not a workspace that stopped existing. The service retries the same
address with a doubling wait. On every `joined` it asks for the frames after its cursor.

A device that joins cannot read what was sealed before it arrived, so admitting one triggers a
snapshot of the current workspace. A reconnect does the same: edits made while the socket was down
were never published as frames, and a snapshot is the one shape that carries all of them. Loro
merges the result, so two devices handing each other a snapshot converge instead of overwriting.

## Limits

- **Loopback is plaintext; a reachable relay is pinned TLS.** The default relay is `ws://127.0.0.1`.
  A relay on any address other machines reach must serve `wss://` with a self-signed certificate;
  Planner requires its SHA-256 fingerprint in the Sync dialog and keeps it in
  `sync/relays/<workspaceId>.json` (0600). A wrong or missing pin refuses the connection, with no
  plaintext fallback. TLS is transport-only: the relay still sees the header, timing and
  availability, and the payload stays sealed.
- **The relay reads metadata, never a document.** It keeps workspace and device ids, epochs, frame
  kinds, sizes, timing and the signed roles, invitations, pinned keys and removals. It has no Loro
  dependency and no snapshot to hand back.
- **No recovery kit.** The only thing that can read the workspace is a device's group state. Losing
  `sync/` means being invited again.
- **A friend code is a name, not a key.** It is a 70-bit commitment, so a code alone cannot complete
  a contact; a `suite://friend` QR may carry the public key, and otherwise the first signed invitation
  completes it. There is no directory, no lookup and no account.
- **An unknown code is refused, not trusted.** Adding the contact is the explicit act; a known code
  with a different key is refused as an impersonation or a reinstalled device.
- **No removal from Planner yet.** An owner removes a device through Canvas or the relay's own
  tools; Planner's dialog lets this copy leave, not another one.
- **No presence and no push.** A device with Planner closed learns nothing until it opens and
  reconnects. Reminder timestamps written by main travel in the next snapshot, not as a live frame.
- **Retention.** The relay keeps frames for 30 days by default. A device away longer needs the
  snapshot a reconnect triggers from a peer; the relay never had one.
