# 3. Sync two devices

The sync relay is run by a person, not by the project. This tutorial runs one locally and connects
two Canvas clients to it. It proves the transport; it is not the shipped security model.

> The relay stores sealed frames it cannot read, plus the signed roles, invitations, pinned keys and
> removals it needs to admit them. It has no TLS and binds to `127.0.0.1` by default; do not expose it
> beyond a trusted machine.

## What you need

- This repository, with dependencies installed.
- A built sync server.
- Two Canvas clients: two browser tabs, or two desktop instances with separate data directories.

## The shape

1. Start `suite-sync` — Start supervises one, or run the CLI against a store directory.
2. Open the document in Canvas desktop and press **Share** in the Sync dialog.
3. Give a second device a copy of the `.canvas` file and an invitation link from the first device.
4. Press **Join** on the second device; the first device admits it from the invitation.
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

- No TLS. The relay speaks `ws://` and binds to `127.0.0.1` by default, so a network attacker sees the
  header, timing and availability even though the payload is sealed.
- The relay sees metadata: workspace and device ids, epoch, kind, size and timing, plus the signed
  roles, invitations, pinned keys and removals. See [the threat model](../../apps/sync/docs/threat-model.md).
- No background delivery. Both clients are open and connected.

The store is described in [the blind relay record](../../apps/sync/docs/reference/blind-relay.md).
