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

The separate tray app is retired. It owned the relay it ran on this machine — start, stop, address,
store — and it was never a second role in the product. The host's tray is the target surface: it
absorbs those states and controls, and sync is a capability of the host rather than an app a person
installs. The shape the host uses is still owed
([Decisions](../../docs/reference/decisions.md#retiring-the-sync-tray-app-315)); `apps/sync` stays as
the protocol, the client library and the relay implementation.

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
> **TLS is required off loopback.** Loopback may stay `ws://`; a relay on any address other machines
> can reach serves `wss://` with `--tls-cert` and `--tls-key`. The certificate is normally self-signed,
> and each app pins the SHA-256 fingerprint the relay prints at startup. A reachable plaintext bind is
> refused unless `--allow-plaintext` makes that choice explicit, and that choice prints a warning. The
> relay still sees the metadata the threat model accepts — workspace and device ids, epochs, kinds,
> sizes and timing — though TLS hides it from a passive network attacker.
>
> **The console and the relay code.** `serve` also opens a read-only console on `127.0.0.1` and
> prints its URL with a token generated at startup. The console shows the relay's metadata and draws
> a `suite://relay` code carrying the address, the certificate pin and, when one is live, an
> invitation. The retired tray app opened that console from its window; the host will own that surface.
> Friend codes and contacts live in the apps' main processes, not in the relay: the console never sees
> either.

---

For the product story and the influences behind it, read
[What Suite is](../../docs/explanation/why-suite-exists.md).

## What exists

| Path                | What it is                                                                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/protocol` | `@suite/sync`: ids, roles, signed membership and role records, invites, sealed frames, relay messages, relay codes and QR. The root is pure and defines no document format. |
| `packages/host`     | `@suite/host`: the relay — frame admission, the numbered frame log, the file store, the WebSocket server and the loopback console.                                          |
| `src`               | `suite-sync`: the CLI over `@suite/host` (`serve`, `status`, `--version`).                                                                                                  |
| `app`               | `@suite/sync-app`: the Electron app the last `run.suite.sync` build packaged. It is not published any more; its tray and window are retired.                                |
| `docs/`             | Protocol, threat model, and the decisions behind them.                                                                                                                      |

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
refuses to start without it. The CLI runs `serve` in the foreground; the retired app embedded the same
relay and kept no second copy of its frames. The store is a directory of `<workspaceId>.frames.jsonl`
files; there is no `workspace init`, `membership.json` or `snapshot.loro`.

The last published app made and kept the TLS pair under the relay store's `tls/` directory, mode 0600,
so the fingerprint survived a restart. Its window showed that fingerprint and opened the console; a
relay you run by hand uses `--tls-cert` and `--tls-key` as the guide describes.

## Run the relay

The relay is no longer a shipped app (#315). There is no new `run.suite.sync` build and the tray app is
retired; the signed remote keeps the last published ref for anyone who already has it, and the host is
the surface that will run and show the relay. Until the host's shape lands
([Decisions](../../docs/reference/decisions.md#retiring-the-sync-tray-app-315)), a person running a
relay uses the headless CLI from a checkout or from the last published Flatpak ref.

From a checkout:

```sh
pnpm --filter @suite/sync-server run build
node apps/sync/dist/cli.js serve --host 127.0.0.1 --port 8787 --trust-all
```

The last published app can still run the same CLI on a machine with no desktop:

```sh
flatpak run --command=suite-sync run.suite.sync serve \
  --host 127.0.0.1 --port 8787 --trust-all
```

`serve`, `status` and `--version` are the CLI in `src`, unchanged. The Flatpak carries no Node runtime
of its own, so the `suite-sync` command runs the app's binary with `ELECTRON_RUN_AS_NODE=1`. A
contributor can reproduce that build with `node scripts/flatpak.mjs --app sync`; it installs from the
local `suite-local` repository, and the manifest is `packaging/flatpak/run.suite.sync.yml`.
[Leave a relay running](docs/how-to/relay.md) is the operation guide.

The last app kept its store under its own data directory,
`~/.var/app/run.suite.sync/data/suite-sync`, and the certificate pair in `tls/` beside it, mode 0600.
Nothing else in the home directory is touched except one autostart entry, which its tray wrote only
when asked. In the headless form the store is whatever `--store` names.

Point each device at the relay's address — for example `wss://192.168.1.20:8787/sync` — and paste the
`certificate SHA-256 fingerprint:` line into **Relay certificate fingerprint**.

Nothing else changes: the apps keep their documents, and no Suite process manages a relay running on
another machine. The address must be one the device can route to; `127.0.0.1`
is always the device itself. The host seam that absorbs the relay decides whether it imports the relay
as a module or supervises it as a child process; both keep the "never reads a document" rule.

## Working in the monorepo

The host, the apps and the sync server share one repository and one gate. Start with the
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
- **Sync is a capability.** A host can offer status, the four doors and a sealed-frame channel to an
  app or pack without holding a group key; [the sync capability](docs/reference/sync-capability.md)
  states the boundary, the states a UI can act on and the failure shape.

Read [the protocol](docs/protocol.md) and [the threat model](docs/threat-model.md).

Current rules are in [Decisions](docs/reference/decisions.md).

## Licence

MIT, © Suite contributors.
