# 3. Sync two devices

The sync relay is run by a person, not by the project. This tutorial runs one locally and connects
two Canvas clients to it. It proves the transport; it is not the shipped security model.

> The relay stores sealed frames it cannot read, plus the signed roles, invitations, pinned keys and
> removals it needs to admit them. It serves `ws://` on `127.0.0.1` by default; a relay other devices
> reach uses `wss://` with a self-signed certificate the app pins by SHA-256.

## What you need

- This repository, with dependencies installed.
- A built sync server.
- Two Canvas desktop instances: separate data directories, or two machines.

## The shape

1. Run the relay: install Suite Sync with its `flatpak install` line and open it, or run the CLI against a store
   directory.
2. Open the document in Canvas desktop and press **Share** in the Sync dialog.
3. Give a second device a copy of the `.canvas` file and an invitation link from the first device.
   The link carries a signed envelope naming the inviter, and the joining app resolves that name
   against its own contacts.
4. Press **Join** on the second device. A known contact connects without a second certificate
   question; an unknown code is refused with the code to add, so add it and press Join again. The
   friend code and contact list are described in
   [Canvas's Sync status](../../apps/canvas/handbook/chrome/sync-status.md).
5. Edit a card in one; watch it arrive in the other.

The exact steps, including the relay address and the invitation, are in
[Run the Canvas sync demo](../../apps/sync/docs/how-to/canvas-sync-demo.md). Follow that page
rather than retyping the commands here.

## What to look for

- `GET /health` reports two clients.
- The title bar no longer says "Local only".
- A card created in one client appears in the other.
- Restarting the relay keeps the frames and their positions; clients reconnect and catch up.

## What this does not prove

- Transport is pinned, not authority-issued. This tutorial stays on loopback `ws://`; a reachable
  relay uses `wss://` with a self-signed certificate and the app pins its SHA-256 fingerprint. A
  network attacker cannot read the header or timing of a pinned connection, but can still drop it,
  and the relay still sees that metadata.
- The relay sees metadata: workspace and device ids, epoch, kind, size and timing, plus the signed
  roles, invitations, pinned keys and removals. See [the threat model](../../apps/sync/docs/threat-model.md).
- No background delivery. Both clients are open and connected.

The store is described in [the blind relay record](../../apps/sync/docs/reference/blind-relay.md).
