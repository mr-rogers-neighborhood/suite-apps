# 3. Sync two devices

The sync server is run by a person, not by the project. This tutorial runs one locally and connects
two Canvas clients to it. It proves the transport; it is not the shipped security model.

> The demo room is plaintext, has no TLS and binds to `127.0.0.1` by default. Do not expose it beyond
> a trusted machine until the blind-relay work lands.

## What you need

- This repository, with dependencies installed.
- A built sync server.
- Two Canvas clients: two browser tabs, or two desktop instances with separate data directories.

## The shape

1. Build and start `suite-sync` with a workspace directory.
2. Create a sync workspace. It gets a 64-hex workspace id, an owner id and an editor id.
3. Open two Canvas clients with the same workspace id and different member ids.
4. Edit a card in one; watch it arrive in the other.

The exact commands, including fixed ids for copy-paste, are in
[Run the Canvas sync demo](../../apps/sync/docs/how-to/canvas-sync-demo.md). Follow that page
rather than retyping the commands here; it also covers the desktop case with two copies of one file.

## What to look for

- `GET /health` reports two clients.
- The title bar no longer says "Local only".
- A card created in one client appears in the other.
- Restarting the server keeps the workspace, because it writes the snapshot back to disk.

## What this does not prove

- No encryption. The room holds a plaintext replica.
- No invite or accept flow. Membership is a CLI step.
- No presence or attachments in this phase.
- No background delivery. Both clients are open and connected.

The design target is a blind relay that stores ciphertext it cannot read; see
`apps/sync/docs/reference/decisions.md`.
