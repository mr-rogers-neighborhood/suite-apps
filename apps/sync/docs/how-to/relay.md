# Leave a relay running

`suite-sync` is the mailbox two devices sync through. It holds encrypted frames and cannot read them,
merge them, or tell you which document moved. This page is how to run one on a machine you own and
forget about it — a NAS, a Raspberry Pi, a spare desktop.

The relay is not a service Suite operates. There is nothing to sign up for, and nothing leaves your
network that you did not put there.

## What you need

- A machine on the same network as the devices you want to sync (or reachable over a VPN).
- **Node.js 22 or later.** The relay is JavaScript. The release tarball carries the CLI and its
  dependencies, but not a Node runtime.
- The `suite-sync` release tarball for your architecture: `x86_64`, or `aarch64` on 64-bit ARM.

## 1. Install the relay

The relay is published as release assets on the `sync-v<version>` tag. That tag carries
`suite-sync-<version>-<arch>.tar.gz`, the `SHA256SUMS` list it is checked against, a detached
`SHA256SUMS.sig`, and `SHA256SUMS.pub` to verify that signature.

Set `VERSION` to the release you are installing, download all four files, and check the signature
before trusting the checksum. The signature covers `SHA256SUMS` byte for byte; the signed list is
what verifies the tarball.

```sh
VERSION=<version>
ARCH=x86_64
BASE="https://github.com/mr-rogers-neighborhood/suite-apps/releases/download/sync-v$VERSION"

curl -fLO "$BASE/suite-sync-$VERSION-$ARCH.tar.gz"
curl -fLO "$BASE/SHA256SUMS"
curl -fLO "$BASE/SHA256SUMS.sig"
curl -fLO "$BASE/SHA256SUMS.pub"

# 1. Verify SHA256SUMS with the publisher's update key.
base64 -d SHA256SUMS.sig > SHA256SUMS.sig.bin
openssl pkeyutl -verify \
  -pubin -inkey SHA256SUMS.pub \
  -rawin -in SHA256SUMS -sigfile SHA256SUMS.sig.bin

# 2. The signed list verifies the tarball's bytes.
sha256sum -c SHA256SUMS
```

`SHA256SUMS.pub` is the same update key the Suite apps pin, so it can be compared by fingerprint:

```sh
openssl pkey -pubin -in SHA256SUMS.pub -outform DER | sha256sum
```

The first 32 hex characters are the fingerprint `pnpm keys status` prints on the publisher's machine.

Install the whole tree under `/opt`, then put the launcher on `PATH`:

```sh
sudo install -d /opt/suite-sync
sudo tar -xzf "suite-sync-$VERSION-$ARCH.tar.gz" -C /opt
sudo ln -sf /opt/suite-sync/bin/suite-sync /usr/local/bin/suite-sync

suite-sync --version
suite-sync status
```

Keep `/opt/suite-sync` in one piece: the launcher runs `dist/cli.js` and resolves its dependencies
from that tree. Copying only the launcher leaves a command that cannot find the server.

### How Start finds it

Suite Start spawns `suite-sync serve` directly. It looks in this order:

1. `SUITE_SYNC_BIN`, if it is set. It has to point at the executable; Start does not fall back to
   another copy when the named path is missing.
2. a `suite-sync` beside Start's own binary (or in its resources directory);
3. `suite-sync` on `PATH`.

`/usr/local/bin` is normally on `PATH`, so the symlink above is enough. If you keep the tree
elsewhere, add its `bin` directory to `PATH`, or set
`SUITE_SYNC_BIN=/path/to/suite-sync/bin/suite-sync` in the environment Start inherits.

From a checkout, build the three sync packages and run the CLI through the workspace:

```sh
pnpm --filter @suite/sync-server run build:all
node apps/sync/dist/cli.js --version
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

## Running the relay somewhere else

A relay on a NAS, a Raspberry Pi or a spare desktop is the ordinary shape. Do steps 1–4 there and
leave it running; the machine with Start does not need a relay of its own.

Start's Sync pane manages only a relay it can find: `SUITE_SYNC_BIN`, a copy shipped beside Start,
then `suite-sync` on `PATH`. When it finds none it says so and stays a launcher; nothing else in
Start depends on the relay. To use the remote one, point every app at it with `SUITE_SYNC_URL`
above. A relay on `127.0.0.1` is private to the machine that runs it, which is the right default and
the wrong setting for one that exists to be reached.

The relay's store belongs to that machine — back up `/var/lib/suite-sync`, not the laptop — and
Start's pane shows the store of a relay it started, not the store of one across the network.

## Building and publishing a release

The monorepo has one release path for the relay:

```sh
node scripts/release.mjs sync            # build, sign, print what it would upload
node scripts/release.mjs sync --publish  # upload the assets on sync-v<version>
node scripts/release.mjs sync --verify   # re-check the local tarball, checksum and signature
```

A dry run is the default; `--publish` is required to create the tag or upload anything. The script
refuses a dirty tree, a commit `.dev/gate-status.json` has not proven, and a `package.json` version
without a `## [version]` changelog section. It builds from the proven commit and signs `SHA256SUMS`
with the update key at `SUITE_UPDATE_KEY` or `~/.config/suite/keys/update-key.pem`; a key that does
not match the pin in `packages/desktop/src/updateSignature.ts` is refused before the build.

The tarball carries the built CLI, its JavaScript dependencies, a `suite-sync` launcher, the runtime
requirement in its README and the licence. It has no update feed: the relay is a server binary, and
a person replaces the tree deliberately. Re-check the release with the same commands shown in
[Install the relay](#1-install-the-relay).

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
