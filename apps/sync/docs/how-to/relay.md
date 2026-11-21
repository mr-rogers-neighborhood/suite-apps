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

**Off loopback, the relay needs TLS.** A bind on any address other machines can reach refuses to start
without `--tls-cert` and `--tls-key`. Both flags or neither. The certificate is normally self-signed:
there is no authority to ask, and each app pins the SHA-256 fingerprint instead of trusting a chain.
Make the pair once and keep the key private:

```sh
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
  -keyout relay-key.pem -out relay-cert.pem -days 825 \
  -subj "/CN=suite-sync relay"
```

Start the relay with both files:

```sh
suite-sync serve --host 0.0.0.0 --port 8787 --trust-all --trust-all-remote --tls-cert relay-cert.pem --tls-key relay-key.pem
```

The status line says `wss`, and the startup output ends with the line to copy into each app:

```text
listening on wss://0.0.0.0:8787/sync
certificate SHA-256 fingerprint: AB:CD:EF:…
```

Enter it in the app's **Relay certificate fingerprint** field when the address or invitation is
`wss://`. The app stores the pin in its main process; a certificate that does not match is refused
with no plaintext fallback.

When Start runs the relay it makes and keeps this pair itself, under the relay store's `tls/`
directory with mode 0600, and shows the fingerprint in its Sync tab. The manual pair above is for a
relay you run by hand or on another machine.

**Loopback may stay plaintext.** `ws://127.0.0.1:8787/sync` is the default and needs no certificate,
because only this machine can connect. A reachable bind without TLS is refused unless
`--allow-plaintext` says that is intended; the relay then prints a warning about the exposed metadata.
That flag is an explicit escape hatch, not a mode to leave running.

**`--trust-all` is required today.** The relay checks device signatures, and there is no device
registry yet, so a relay with nothing to check against refuses to start rather than admit everything
by accident. On loopback, `--trust-all` means "the only caller is a process on this machine".

On any other address it means **"any device that can route here may write to the mailbox"**. Because
that is a different decision, the CLI refuses it until you say so:

```sh
# refused: --trust-all on an address other machines can reach
# suite-sync serve --host 0.0.0.0 --trust-all

# accepted, and the status line says what it now is
suite-sync serve --host 0.0.0.0 --trust-all --trust-all-remote --tls-cert relay-cert.pem --tls-key relay-key.pem
```

Put that relay on a network you trust, or behind a VPN, and keep the port closed at the router. The
store is encrypted frame bytes with no integrity story against a hostile stranger who can write to it;
`--trust-all-remote` is the flag that says you know that.

`suite-sync status` prints the configuration a `serve` would use without starting one, including
whether the transport is `ws` or `wss`, which is the cheapest way to check a unit file before
restarting it.

## 3. Run it under systemd

Two files, no account to create:

```sh
install -m 0644 deploy/suite-sync.service /etc/systemd/system/suite-sync.service
install -d /etc/suite-sync
install -m 0600 deploy/relay.env.example /etc/suite-sync/relay.env
```

If the relay serves TLS, install the pair beside the unit too:

```sh
install -m 0644 relay-cert.pem /etc/suite-sync/relay-cert.pem
install -m 0600 relay-key.pem /etc/suite-sync/relay-key.pem
```

Edit `/etc/suite-sync/relay.env` and set `SUITE_SYNC_ARGS`. The example file's loopback line is ready
to use; for a relay other devices reach, add the TLS pair and the reachable address:

```sh
SUITE_SYNC_ARGS=--store /var/lib/suite-sync --trust-all --trust-all-remote \
  --host 0.0.0.0 --tls-cert /etc/suite-sync/relay-cert.pem \
  --tls-key /etc/suite-sync/relay-key.pem
```

Then:

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

The relay answers a health probe that says nothing about any document. On a plaintext relay:

```sh
curl -sS http://127.0.0.1:8787/health
# {"ok":true,"workspaces":0,"clients":0}
```

A `wss://` relay uses HTTPS for the same probe; `-k` accepts the self-signed certificate for this
local check:

```sh
curl -sSk https://192.168.1.20:8787/health
```

`workspaces` counts stores it has created; `clients` counts live connections. Neither names a
document, an author or a change.

## The relay console and the relay code

`serve` starts a second, read-only listener on `127.0.0.1` and prints its URL:

```text
console: http://127.0.0.1:<port>/console?token=<token>
```

The token is made at startup and accepted as `?token=` or the `X-Suite-Console-Token` header; a
request without it gets a 401. The console is loopback-only even when the relay binds `0.0.0.0`. It
shows the relay's version, store size, workspaces, members and frame counts — metadata the relay
already reads — and no frame payload. Start opens this URL from its **Sync** tab.

The page draws a `suite://relay` QR code. `u` is the relay address, `f` the certificate fingerprint,
and a live invitation adds `w` (workspace id) and `i` (invitation id), so the code is also a bearer
invitation. Start's Sync tab draws a code with the address and pin; the console's code adds the
invitation when one exists. A friend-code or contacts exchange is not built; the shipped ways to
reach a relay are its address plus pin, an invitation, or one of these codes.

## 5. Point devices at it

Open the app's Sync dialog and enter the relay address, for example
`wss://192.168.1.20:8787/sync`, then paste the relay's `certificate SHA-256 fingerprint:` line into
**Relay certificate fingerprint**. The field appears for a `wss://` address or invitation; the app
keeps the pin in its main process, and a different certificate is refused with no plaintext fallback.
A loopback address may stay `ws://` and needs no fingerprint. Nothing syncs while the app is closed;
see `suite-go`'s decisions.

## Running the relay somewhere else

A relay on a NAS, a Raspberry Pi or a spare desktop is the ordinary shape. Do steps 1–4 there and
leave it running; the machine with Start does not need a relay of its own.

Start's Sync pane manages only a relay it can find: `SUITE_SYNC_BIN`, a copy shipped beside Start,
then `suite-sync` on `PATH`. When it finds none it says so and stays a launcher; nothing else in
Start depends on the relay. To use the remote one, enter that `wss://` address and its fingerprint in
each app's Sync dialog. A relay on `127.0.0.1` is private to the machine that runs it, which is the
right default and the wrong setting for one that exists to be reached.

The certificate pair belongs on the relay machine too. The pin each app stores is that certificate's
SHA-256, so replacing the pair means entering the new fingerprint once on every device.

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
- **No certificate authority.** The certificate is self-signed and the app pins its fingerprint; there
  is no chain, hostname validation or renewal service to trust.
- **No device registry.** `--trust-all` is the only mode a `serve` will accept, which is why the
  acknowledgement flag exists.
- **No search, projection or rendering.** It cannot decrypt, so it cannot answer anything about a
  document.
- **No federation.** One relay, the addresses you give it.
