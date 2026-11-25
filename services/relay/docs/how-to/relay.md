# Leave a relay running

`suite-sync` is the mailbox two devices sync through. It holds encrypted frames and cannot read them,
merge them, or tell you which document moved. This page is how to run one on a machine you own and
forget about it — a spare desktop, a home server, a laptop that stays awake.

The relay is not a service Suite operates. There is nothing to sign up for, and nothing leaves your
network that you did not put there.

> **The relay is no longer a shipped app (#315).** `run.suite.sync` stopped being published, and its
> tray app is retired: the host the person is using owns that surface, and its shape for the relay is
> still owed ([Decisions](../../../../docs/reference/decisions.md#retiring-the-sync-tray-app-315)).
> `services/relay` stays in the tree as the protocol, the client library and the relay implementation. The
> signed remote keeps the last published ref for anyone who already has it, but no new build is
> published. This page runs the relay headlessly; that is the part of the code that did not retire.

## What you need

- A machine on the same network as the devices you want to sync (or reachable over a VPN).
- The relay itself: a built checkout, or the last `run.suite.sync` ref the signed remote keeps. Neither
  needs a desktop session; the relay is a foreground process and a supervised unit.

Both forms run the same code and print the same startup lines. There is no tray, no window and no
autostart entry to install: the relay is a process you start, and a host that owns the relay starts it
for you when that seam lands.

## 1. Get the relay

From a checkout, build the CLI and check the version:

```sh
pnpm --filter @suite/sync-server run build:all
node services/relay/dist/cli.js --version
```

From a checkout, `suite-sync` in the commands below is `node services/relay/dist/cli.js`; the published and
system forms install the same binary as `suite-sync`.

`suite-sync --version` prints the server and relay-protocol versions. Two devices need the same
protocol version; the relay refuses a client that speaks a different one.

If the last published ref is already installed, the same CLI is still inside it:

```sh
flatpak run --command=suite-sync run.suite.sync --version
```

That ref is the last published `run.suite.sync` build. It keeps working and keeps updating from
whatever `origin` it has, but it will not receive a new build, and its tray is not the surface this
project targets. The `suite-sync` command is a launcher that runs the app's own binary with
`ELECTRON_RUN_AS_NODE=1`, because the Flatpak base carries no Node runtime. Everything after the
command is the ordinary CLI: `serve`, `status`, `--version`.

A contributor can reproduce that last artifact locally:

```sh
node scripts/flatpak.mjs --app sync
```

That packages the unpacked build `.artifacts/sync-app/linux-unpacked`, signs the repository summary
with the store key, publishes it to `~/suite-flatpak/repo` and installs `run.suite.sync` from
`suite-local`. The manifest is `packaging/flatpak/run.suite.sync.yml`; `--no-build` reuses an unpacked
tree that already exists. This is a local check of the last build, not a release path.

## 2. Choose an address, honestly

The headless command defaults to `127.0.0.1`, which only this machine can reach — the right default,
and the wrong setting for a relay whose purpose is to be reached.

**Off loopback, the relay needs TLS.** A bind on any address other machines can reach refuses to start
without `--tls-cert` and `--tls-key`. Both flags or neither. The certificate is normally self-signed:
there is no authority to ask, and each app pins the SHA-256 fingerprint instead of trusting a chain.
Make and keep the pair on the relay machine, in a directory only that account can read:

```sh
mkdir -p ~/.config/suite-sync/tls
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
  -keyout ~/.config/suite-sync/tls/relay-key.pem \
  -out ~/.config/suite-sync/tls/relay-cert.pem -days 825 \
  -subj "/CN=suite-sync relay"
chmod 600 ~/.config/suite-sync/tls/relay-key.pem
```

The last app made and kept this pair under its own data directory
(`$XDG_DATA_HOME/suite-sync`); a checkout can keep it anywhere the relay's account can read, and the
last Flatpak must keep it inside the sandbox at `~/.var/app/run.suite.sync/data/tls`. Either location
works as long as a person backs it up with the store.

Start the relay with both files:

```sh
suite-sync serve \
  --host 0.0.0.0 --port 8787 --trust-all --trust-all-remote \
  --tls-cert ~/.config/suite-sync/tls/relay-cert.pem \
  --tls-key ~/.config/suite-sync/tls/relay-key.pem
```

The status line says `wss`, and the startup output ends with the line to copy into each app:

```text
listening on wss://0.0.0.0:8787/sync
certificate SHA-256 fingerprint: AB:CD:EF:…
```

Enter it in the app's **Relay certificate fingerprint** field when the address or invitation is
`wss://`. The app stores the pin in its main process; a certificate that does not match is refused
with no plaintext fallback.

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
suite-sync serve \
  --host 0.0.0.0 --trust-all --trust-all-remote \
  --tls-cert ~/.config/suite-sync/tls/relay-cert.pem \
  --tls-key ~/.config/suite-sync/tls/relay-key.pem
```

Put that relay on a network you trust, or behind a VPN, and keep the port closed at the router. The
store is encrypted frame bytes with no integrity story against a hostile stranger who can write to it;
`--trust-all-remote` is the flag that says you know that.

`suite-sync status` prints the configuration a `serve` would use without starting one, including
whether the transport is `ws` or `wss`, which is the cheapest way to check a unit file before
restarting it.

## 3. Run the relay under systemd

A relay belongs to one account and its store, so the usual unit is a user unit. The last published
Flatpak is a user install too; a system unit would run as root against a Flatpak root cannot see.

For the last published Flatpak ref, install the user unit:

```sh
install -d -m 0700 ~/.config/systemd/user ~/.config/suite-sync
install -m 0644 services/relay/deploy/suite-sync-flatpak.service ~/.config/systemd/user/suite-sync.service
install -m 0600 services/relay/deploy/relay-flatpak.env.example ~/.config/suite-sync/relay.env
```

Edit `~/.config/suite-sync/relay.env` and set `SUITE_SYNC_ARGS`. It starts empty: the unit's own line
serves loopback with the store in the app's data directory, and a relay other devices reach adds the
acknowledgement, the reachable address and the pair from step 2:

```sh
SUITE_SYNC_ARGS=--trust-all-remote --host 0.0.0.0 \
  --tls-cert /home/you/.var/app/run.suite.sync/data/tls/relay-cert.pem \
  --tls-key /home/you/.var/app/run.suite.sync/data/tls/relay-key.pem
```

A systemd environment file does not expand `$HOME`, so write the account's absolute path, and systemd
splits the value on whitespace, so a path with a space in it is not supported here.

Then:

```sh
systemctl --user daemon-reload
systemctl --user enable --now suite-sync
systemctl --user status suite-sync
journalctl --user -u suite-sync -f
```

Keep the unit alive between logins with `loginctl enable-linger "$USER"`; without it the user manager
stops when the last session closes, which is exactly the machine a relay is meant to outlive.

A checkout build can also run under the host-binary unit, `deploy/suite-sync.service`, which is a
system unit with `DynamicUser=yes` and `StateDirectory=suite-sync`. It expects the binary at
`/usr/local/bin/suite-sync` (built from a checkout at `/opt/suite-sync` and linked there) and its env
file at `/etc/suite-sync/relay.env`; there is no tarball to install any more. Do not mix the two
forms: a Flatpak cannot write `/var/lib/suite-sync`.

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
document, an author or a change. `suite-sync status` prints the configuration.

## The relay console and the relay code

`serve` starts a second, read-only listener on `127.0.0.1` and prints its URL:

```text
console: http://127.0.0.1:<port>/console?token=<token>
```

The token is made at startup and accepted as `?token=` or the `X-Suite-Console-Token` header; a
request without it gets a 401. The console is loopback-only even when the relay binds `0.0.0.0`. It
shows the relay's version, store size, workspaces, members and frame counts — metadata the relay
already reads — and no frame payload. The retired tray opened it with the token the app held; from a
headless relay, open the printed URL.

The page draws a `suite://relay` QR code. `u` is the relay address, `f` the certificate fingerprint,
and a live invitation adds `w` (workspace id) and `i` (invitation id), so the code is also a bearer
invitation. Friend codes and contacts are app data, not relay data; the relay never stores them. The
shipped ways to reach a relay are its address plus pin, an invitation, or one of these codes.

## 5. Point devices at it

Open the app's Sync dialog and enter the relay address, for example
`wss://192.168.1.20:8787/sync`, then paste the relay's `certificate SHA-256 fingerprint:` line into
**Relay certificate fingerprint**. The field appears for a `wss://` address or invitation; the app
keeps the pin in its main process, and a different certificate is refused with no plaintext fallback.
A loopback address may stay `ws://` and needs no fingerprint. Nothing syncs while the app is closed;
see `suite-go`'s decisions.

Scanning the console's code does the same thing on a device that scans codes: it carries the address
and pin, so nothing has to be typed.

## Running the relay somewhere else

A relay on a NAS, a Raspberry Pi or a spare desktop is the ordinary shape. Do steps 1–4 there and
leave it running; the machine with the host does not need a relay of its own.

No Suite process manages a relay it did not start. Enter that `wss://` address and its fingerprint in
each app's Sync dialog. A relay on `127.0.0.1` is private to the machine that runs it, which is the
right default and the wrong setting for one that exists to be reached.

The certificate pair belongs on the relay machine too. The pin each app stores is that certificate's
SHA-256, so replacing the pair means entering the new fingerprint once on every device.

The relay's store belongs to that machine — back up the store directory, not the laptop.

## Building the last artifact

The monorepo has one Flatpak path, and the relay's last artifact is built by the same script as the
other apps:

```sh
node scripts/flatpak.mjs --app sync              # package, sign, publish and install locally
node scripts/flatpak.mjs --app sync --no-build   # reuse .artifacts/sync-app/linux-unpacked
```

The manifest packages the unpacked build `package:dir` produced, so the relay inside the app is the
same code the gate tested. There is no pre-release identity for Sync: a tier would be a second mailbox
on the same data, so `--channel` is refused. This build is not published any more (#315); the signed
remote keeps the last ref it already has. The `sync-v<version>` tarball releases are retired and
remain downloadable history only.

## Upgrading

A checkout upgrade is a rebuild and a restart:

```sh
pnpm --filter @suite/sync-server run build:all
systemctl --user restart suite-sync
```

The last published Flatpak ref updates from its own `origin` with `flatpak update --user`, but no new
`run.suite.sync` build is published, so it will not move past the version it already carries.

The store is append-only and the format is versioned; a relay does not read what it stores, so an
upgrade cannot migrate it and does not need to.

Check `--version` on both sides after an upgrade. A protocol mismatch is refused at connect time, not
discovered as a corrupt document later.

## Backing up

Back up the relay's store directory. For the last app that was
`~/.var/app/run.suite.sync/data/suite-sync`; for a checkout it is whatever `--store` names. It is the
only state a relay has, and losing it does not lose a document — devices hold the truth — it only
loses frames that had not been delivered yet. The `tls/` pair lives beside the store in the last app,
so restoring the store with the pair keeps every device's pin valid.

## What this relay still does not do

- **No push.** A device with the app closed learns nothing until it is opened (`suite-go` decisions).
- **No certificate authority.** The certificate is self-signed and the app pins its fingerprint; there
  is no chain, hostname validation or renewal service to trust.
- **No device registry.** `--trust-all` is the only mode a `serve` will accept, which is why the
  acknowledgement flag exists.
- **No search, projection or rendering.** It cannot decrypt, so it cannot answer anything about a
  document.
- **No federation.** One relay, the addresses you give it.
