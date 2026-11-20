# Suite Sync

The sync protocol and the user-run sync/collab server for the Suite family.

Suite operates no server. A person runs `suite-sync` on a device they control — a NAS, a Raspberry Pi,
an always-on computer, a laptop — and their other devices sync with it. The document stays a file the
app owns; this repository owns the wire protocol, the membership model and the headless server.

> **Status: Phase 2 + the first Canvas demo.** The protocol, the MLS group and frame types, the
> membership state machine, a room, a WebSocket server, a file-backed snapshot store, the workspace
> bootstrap CLI and the relay client are here. Two Canvas clients can sync one workspace through a
> local server; `pnpm check` covers the protocol, the membership state machine, the room and the
> transport.
>
> **Try it:** [Run the Canvas sync demo](docs/how-to/canvas-sync-demo.md).
>
> **Not shippable yet.** The room is plaintext and there is no TLS. `serve` binds to `127.0.0.1` by
> default and must not be exposed beyond a trusted network until the identity/encryption phase
> ([Decisions](docs/reference/decisions.md)) lands.

---

For the product story and the influences behind it, read
[What Suite is](../../docs/explanation/why-suite-exists.md).

## What exists

| Path                | What it is                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/protocol` | `@suite/sync`: ids, roles, signed membership and role records, invites, sealed frames, relay messages. The root is pure and defines no document format. |
| `src`               | `suite-sync`: room, WebSocket transport, file-backed snapshots, workspace bootstrap, CLI.                                                               |
| `docs/`             | Protocol, threat model, and the decisions behind them.                                                                                                  |

## Commands

```sh
pnpm install
pnpm check        # biome, build, typecheck, vitest
pnpm test         # vitest only

pnpm --filter @suite/sync-server build
node dist/cli.js --version
node dist/cli.js serve --host 127.0.0.1 --port 8787
curl http://127.0.0.1:8787/health

# A workspace directory holds membership.json and a snapshot.loro.
node dist/cli.js workspace init /tmp/demo
node dist/cli.js workspace show /tmp/demo
node dist/cli.js workspace add-member /tmp/demo \
  --member <64-hex> --role viewer --name Viewer
node dist/cli.js serve --workspace /tmp/demo
```

## Working in the monorepo

The apps, the hub and the sync server share one repository and one gate. Start with the
[root README](../../README.md), then [Commands](../../docs/reference/commands.md) for the gate and
[Repository layout](../../docs/reference/repo-layout.md) for where each package lives.

## The model in one page

- **The document is a file.** Loro owns the document; this repository never defines an app schema.
- **Ids are fingerprints.** A workspace, device or member id is 64 lower-case hex characters. Deriving
  one from an Ed25519 public key is the crypto layer's job.
- **Membership is a signed, append-only log.** `create`, `invite`, `accept`, `set-role`, `revoke`. Only
  an active owner invites or revokes. A revoke bumps the epoch; the epoch is the group-key epoch.
- **Sync is version vectors.** Two peers exchange `hello` vectors, each sends the updates the other is
  missing, then a transport forwards local updates. The WebSocket client is
  [`RelayClient`](packages/protocol/src/relayClient.ts); the Phase 2 server slice and its message set
  are in [the protocol](docs/protocol.md#server-transport-phase-2-slice).
- **The server sees ciphertext.** That is the target, not the current room: the Phase 2 room holds a
  plaintext Loro replica so the transport and persistence can be tested. [Decisions](docs/reference/decisions.md)
  turns the shipped room into a blind store of encrypted updates; the client keeps the only replica
  that can merge.
- **One active server per workspace** in v1, with a promotion path. No server-to-server federation.
- **Snapshots survive a restart.** `FileRoomStore` writes one opaque snapshot per workspace with a
  temp-file rename. Membership state is loaded out of band in Phase 2; the invite/accept path is the
  next step.

Read [the protocol](docs/protocol.md) and [the threat model](docs/threat-model.md).

Current rules are in [Decisions](docs/reference/decisions.md).

## Licence

MIT, © Suite contributors.
