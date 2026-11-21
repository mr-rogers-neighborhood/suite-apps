# Suite Sync

The sync protocol and the user-run sync/collab server for the Suite family.

Suite operates no server. A person runs `suite-sync` on a device they control — a NAS, a Raspberry Pi,
an always-on computer, a laptop — and their other devices sync with it. The document stays a file the
app owns; this repository owns the wire protocol, the membership model and the headless server.

## Two roles in one product

- **The relay** (`suite-sync serve`) is optional and may face the network. It stores sealed frames
  and the signed metadata it needs to admit them, and cannot read or merge a document. It owns its
  store and never joins a group.
- **The local transport** is the part each app runs: a cursor and a queue, no keys and no listener.
  It carries frames between the document and whatever relay the person points it at.

Start is neither. It supervises a relay it can find on this machine — start, stop, address, store —
and stays a launcher when the relay is absent or runs somewhere else.

> **Status: working, two apps deep.** The protocol, the MLS group and frame types, the membership state machine,
> the blind relay with its file store, and the relay client are here. Two Canvas clients can sync one
> workspace, and two Planner clients can sync one `.planner` file, through a relay on a machine a
> person controls; `pnpm check` covers the protocol, the membership state machine, the relay and the
> transport. `@suite/planner` adds the second app in `apps/planner/src/main/sync`; its
> [sync page](../planner/docs/reference/sync.md) is the app-side seam.
>
> **Try it:** [Run the Canvas sync demo](docs/how-to/canvas-sync-demo.md).
>
> **The relay holds ciphertext.** For each workspace it keeps an append-only file of sealed frames
> plus signed roles, invitations, pinned device keys and removals. It cannot read a frame, merge two
> or answer a question about a document; `apps/sync` has no Loro dependency.
>
> **Not shippable yet.** There is no TLS: `ws://`, not `wss://`. A relay Start starts binds to
> `127.0.0.1` by default and must not be exposed beyond a trusted network. The metadata the
> threat model accepts — workspace and device ids, epochs, kinds, sizes and timing — is still visible
> to the relay.

---

For the product story and the influences behind it, read
[What Suite is](../../docs/explanation/why-suite-exists.md).

## What exists

| Path                | What it is                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/protocol` | `@suite/sync`: ids, roles, signed membership and role records, invites, sealed frames, relay messages. The root is pure and defines no document format. |
| `packages/host`     | `@suite/host`: the relay — frame admission, the numbered frame log, the file store and the WebSocket server.                                            |
| `src`               | `suite-sync`: the CLI over `@suite/host` (`serve`, `status`, `--version`).                                                                              |
| `docs/`             | Protocol, threat model, and the decisions behind them.                                                                                                  |

## Commands

```sh
pnpm install
pnpm check        # biome, build, typecheck, vitest
pnpm test         # vitest only

pnpm --filter @suite/sync-server build
node dist/cli.js --version
node dist/cli.js serve --host 127.0.0.1 --port 8787 --trust-all
curl http://127.0.0.1:8787/health
```

`--trust-all` is the CLI's development mode: it has no device-key verifier to check against, so it
refuses to start without it. Start locates a `suite-sync` binary (`SUITE_SYNC_BIN`, a bundled copy,
then `PATH`), runs `serve` as its own child process, and stops it when Start quits. Start does not
embed the relay and keeps no frames of its own. The store is a directory of
`<workspaceId>.frames.jsonl` files; there is no `workspace init`, `membership.json` or
`snapshot.loro`.

## Run the relay on another machine

A relay does not have to live on the computer running Start. Install `suite-sync` on the always-on
machine and leave it running under systemd — [Leave a relay running](docs/how-to/relay.md) has the
binary, the address choice and the unit file. On each device, point the app at it:

```sh
SUITE_SYNC_URL=ws://192.168.1.20:8787/sync
```

Nothing else changes: the apps keep their documents, and Start remains a launcher that manages no
relay when the relay is elsewhere. The address must be one the device can route to; `127.0.0.1` is
always the device itself.

## Working in the monorepo

The apps, the hub and the sync server share one repository and one gate. Start with the
[root README](../../README.md), then [Commands](../../docs/reference/commands.md) for the gate and
[Repository layout](../../docs/reference/repo-layout.md) for where each package lives.

## The model in one page

- **The document is a file.** Loro owns the document; this repository never defines an app schema.
- **Ids are fingerprints.** A workspace, device or member id is 64 lower-case hex characters. Deriving
  one from an Ed25519 public key is the crypto layer's job.
- **Membership is an MLS group plus signed role records.** Only an active owner invites or revokes. A
  revoke bumps the epoch; the epoch is the group-key epoch.
- **Sync is sealed frames.** A client seals one document update into one MLS application message and
  sends it as a `frame`; the relay numbers and stores it. A client that reconnects asks for
  `since(cursor + 1)` and applies the frames in index order. The WebSocket client is
  [`RelayClient`](packages/protocol/src/relayClient.ts); the relay's message set is in
  [the protocol](docs/protocol.md#relay-transport).
- **The relay sees ciphertext.** For each workspace it keeps `<workspaceId>.frames.jsonl` (sealed
  frames with their positions), `.roles.jsonl`, `.invites.jsonl`, `.keys.jsonl` and
  `.removed.jsonl`. The frame header is readable; the payload is the MLS message it forwards without
  opening. The client keeps the only copy that can decrypt and merge.
- **One active relay per workspace** in v1, with a promotion path. No server-to-server federation.
- **Frames survive a restart.** The relay writes the position with each frame, so compaction drops
  old entries without renumbering the survivors. Retention is 30 days by default; a device away
  longer needs a snapshot from a peer, because the relay has no document to hand back.

Read [the protocol](docs/protocol.md) and [the threat model](docs/threat-model.md).

Current rules are in [Decisions](docs/reference/decisions.md).

## Licence

MIT, © Suite contributors.
