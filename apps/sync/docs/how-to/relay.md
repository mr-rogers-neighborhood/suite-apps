# Leave a relay running

`suite-sync` is the mailbox two devices sync through. It holds encrypted frames and cannot read them,
merge them, or tell you which document moved. This page is how to run one on a machine you own and
forget about it — a NAS, a Raspberry Pi, a spare desktop.

The relay is not a service Suite operates. There is nothing to sign up for, and nothing leaves your
network that you did not put there.

## What you need

- A machine on the same network as the devices you want to sync (or reachable over a VPN).
- Node 22 or later.
- The `suite-sync` release artifact, or a build from this repository.

## 1. Install the binary

From a release, the artifact is a single signed `suite-sync` executable and a `.minisig` beside it.
Verify it before running it:

```sh
minisign -Vm suite-sync -x suite-sync.minisig -P "$(cat suite-sync.pub)"
install -m 0755 suite-sync /usr/local/bin/suite-sync
```

From a checkout, build it and use the same path:

```sh
pnpm --filter @suite/sync-server build
install -m 0755 dist/cli.js /usr/local/bin/suite-sync
```

`suite-sync --version` prints the server and relay-protocol versions. Two devices need the same
protocol version; the relay refuses a client that speaks a different one.

## 2. Choose an address, honestly

The default is `127.0.0.1`, which only this machine can reach. That is the right default and the wrong
setting for a relay whose purpose is to be reached.

**`--trust-all` is required today.** The relay checks device signatures, and there is no device
registry yet, so a relay with nothing to check against refuses to start rather than admit everything
by accident. On loopback, `--trust-all` means "the only caller is a process on this machine".

On any other address it means **"any device that can route here may write to the mailbox"**. Because
that is a different decision, the CLI refuses it until you say so:

```sh
# refused: --trust-all on an address other machines can reach
suite-sync serve --host 0.0.0.0 --trust-all

# accepted, and the status line says what it now is
suite-sync serve --host 0.0.0.0 --trust-all --trust-all-remote
```

Put that relay on a network you trust, or behind a VPN, and keep the port closed at the router. The
store is encrypted frame bytes with no integrity story against a hostile stranger who can write to it;
`--trust-all-remote` is the flag that says you know that.

`suite-sync status` prints the configuration a `serve` would use without starting one, which is the
cheapest way to check a unit file before restarting it.

## 3. Run it under systemd

Two files, no account to create:

```sh
install -m 0644 deploy/suite-sync.service /etc/systemd/system/suite-sync.service
install -d /etc/suite-sync
install -m 0600 deploy/relay.env.example /etc/suite-sync/relay.env
```

Edit `/etc/suite-sync/relay.env` and set `SUITE_SYNC_ARGS` (the example file shows both the loopback
and the LAN variant). Then:

```sh
systemctl daemon-reload
systemctl enable --now suite-sync
systemctl status suite-sync
journalctl -u suite-sync -f
```

The unit uses `DynamicUser=yes` and `StateDirectory=suite-sync`, so frames live in
`/var/lib/suite-sync` and the service has no writable path outside it. If you would rather have a
stable account, replace `DynamicUser=yes` with `User=suite-sync` and create that user yourself.

## 4. Check it is actually up

The relay answers a health probe that says nothing about any document:

```sh
curl -sS http://127.0.0.1:8787/health
# {"ok":true,"workspaces":0,"clients":0}
```

`workspaces` counts stores it has created; `clients` counts live connections. Neither names a
document, an author or a change.

## 5. Point devices at it

An app reaches the relay through `SUITE_SYNC_URL`, for example:

```sh
SUITE_SYNC_URL=ws://192.168.1.20:8787/sync
```

On a phone, the address has to be one the phone can route to — a LAN address works, `127.0.0.1` is
the phone itself. Nothing syncs while the app is closed; see `suite-go`'s decisions.

## Signing, and what the artifact in `dist/release` is

```sh
export SUITE_SYNC_RELEASE_KEY='…'          # base64 32-byte Ed25519 seed; a release secret
export SUITE_SYNC_RELEASE_PUBLIC='…'       # its public half, base64
pnpm release:relay                          # deploy, tar, hash, sign, write the manifest
pnpm release:verify                         # re-check hash, fingerprint and both signatures
pnpm verify:relay                           # unpack, start headless, join two devices
```

`release:verify` re-reads the artifact rather than trusting the run that made it: it checks each file's
hash and size, that the manifest's fingerprint matches the key you gave, and that the manifest **and**
the tarball each verify. That is three separate failures, because each has been the one that broke.

The artifact currently in `dist/release` was signed with a **development** key so the pipeline could be
exercised end to end. Its fingerprint is `aac3a4417a508af8834d86a8f967640d`, and nothing should pin it.
A real release is the same two commands with the release key, and the public half pinned wherever the
installer looks.

## Upgrading

Replace the binary, then `systemctl restart suite-sync`. The store is append-only and the format is
versioned; a relay does not read what it stores, so an upgrade cannot migrate it and does not need to.

Check `--version` on both sides after an upgrade. A protocol mismatch is refused at connect time, not
discovered as a corrupt document later.

## Backing up

Back up `/var/lib/suite-sync`. It is the only state a relay has, and losing it does not lose a
document — devices hold the truth — it only loses frames that had not been delivered yet.

## What this relay still does not do

- **No push.** A device with the app closed learns nothing until it is opened (`suite-go` decisions).
- **No device registry.** `--trust-all` is the only mode a `serve` will accept, which is why the
  acknowledgement flag exists.
- **No search, projection or rendering.** It cannot decrypt, so it cannot answer anything about a
  document.
- **No federation.** One relay, the addresses you give it.
