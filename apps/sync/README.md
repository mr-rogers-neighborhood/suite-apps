# Suite Sync

The sync protocol and the user-run sync/collab server for the Suite family.

Suite operates no server. A person runs `suite-sync` on a device they control — a NAS, a Raspberry Pi,
an always-on computer, a laptop — and their other devices sync with it. The document stays a file the
app owns; this repository owns the wire protocol, the membership model and the headless server.

> **Status: Phase 4 demo.** The protocol, the MLS group and frame types, the membership state machine,
> the blind relay with its file store, and the relay client are here. Two Canvas clients can sync one
> workspace through a relay on a machine a person controls; `pnpm check` covers the protocol, the
> membership state machine, the relay and the transport.
>
> **Try it:** [Run the Canvas sync demo](docs/how-to/canvas-sync-demo.md).
>
> **The relay holds ciphertext.** For each workspace it keeps an append-only file of sealed frames
> plus signed roles, invitations, pinned device keys and removals. It cannot read a frame, merge two
> or answer a question about a document; `apps/sync` has no Loro dependency.
>
> **Not shippable yet.** There is no TLS: `ws://`, not `wss://`. Both `serve` and Start's relay bind
> to `127.0.0.1` by default and must not be exposed beyond a trusted network. The metadata the
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
refuses to start without it. Start runs the same server with the Ed25519 verifier and pins each
device's key on its first join. The store is a directory of `<workspaceId>.frames.jsonl` files; there
is no `workspace init`, `membership.json` or `snapshot.loro`.

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
