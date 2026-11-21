# Leave a relay running

`suite-sync` is the mailbox two devices sync through. It holds encrypted frames and cannot read them,
merge them, or tell you which document moved. This page is how to run one on a machine you own and
forget about it — a spare desktop, a home server, a laptop that stays awake.

The relay is not a service Suite operates. There is nothing to sign up for, and nothing leaves your
network that you did not put there.

## What you need

- A machine on the same network as the devices you want to sync (or reachable over a VPN).
- Flatpak, and a way to get `run.suite.sync`: this checkout, through the build script, while the public
  store does not carry the app yet, or the store once it does. The relay ships in the same app as the
  desktop tray, so there is no separate runtime to install: the Flatpak carries its own.
- A user session for the tray form; none for the headless form.

Both forms are one build. The **tray app** is what a person with a desktop wants: it keeps the relay
serving while its window is closed. The **headless command** is what a server or a NAS wants: the same
binary runs the same CLI and prints the same startup lines.

## 1. Install the relay

Build it from this checkout:

```sh
node scripts/flatpak.mjs --app sync
```

That packages the unpacked build `apps/sync/app/release/linux-unpacked`, signs the repository summary
with the store key, publishes it to `~/suite-flatpak/repo` and installs `run.suite.sync` from
`suite-local`. The manifest is `packaging/flatpak/run.suite.sync.yml`; `--no-build` reuses an unpacked
tree that already exists.

The public store does not carry `run.suite.sync` yet. It arrives with the release that publishes the
app, and from then on the ordinary store install is the shorter path:

```sh
flatpak remote-add --user --if-not-exists --from suite \
  https://flatpak.suite.run/suite.flatpakrepo
flatpak install --user suite run.suite.sync
```

Until the store carries it, the local build above is the install path. A machine with no checkout to
build from can still run the relay from the tarball the release script builds — a host install rather
than a Flatpak, described in
[Building and publishing a release](#building-and-publishing-a-release).

Either install updates with `flatpak update --user`; the app has no updater of its own.

Check what arrived:

```sh
flatpak run --command=suite-sync run.suite.sync --version
```

`suite-sync --version` prints the server and relay-protocol versions. Two devices need the same
protocol version; the relay refuses a client that speaks a different one.

The `suite-sync` command is a launcher inside the Flatpak. It runs the app's own binary with
`ELECTRON_RUN_AS_NODE=1`, because the Flatpak base carries no Node runtime. Everything after the
command is the ordinary CLI: `serve`, `status`, `--version`.

### Start the tray app

```sh
flatpak run run.suite.sync
```

The relay starts with the app and **listens on `127.0.0.1:8787` until you widen it**. The window's
**Who can reach it** selector is that choice, stored in the app's own config
(`$XDG_CONFIG_HOME/suite-sync/relay.json`) so a restart, including a login launch with `--hidden`,
starts the same way:

| Scope                      | Bind                           | What the window says                                 |
| -------------------------- | ------------------------------ | ---------------------------------------------------- |
| This device only (default) | `127.0.0.1`                    | "Only this device can reach the relay."              |
| My tailnet                 | the first IPv4 on `tailscale0` | "Only devices on your tailnet can reach it."         |
| This network               | `0.0.0.0`                      | "Any device on this network can write to the relay." |

The tailnet scope reads the interface Tailscale creates. The Flatpak shares the host's network
namespace, so no grant and no `flatpak-spawn` is involved; if Tailscale is not running, the option is
disabled with **Tailscale is not running on this machine.**, and a stored tailnet choice refuses that
bind and keeps the relay on loopback rather than widening.

The network scope is the acknowledgement `--trust-all-remote` asks for on the CLI, so selecting it
shows a warning and waits for **Use this network**; the relay only rebinds after that. Nothing is
stored until the confirmation, and the main process refuses an unacknowledged change even if a page
asked for one. Changing scope stops and restarts the relay, so the address, the code and the link are
the ones the new bind actually serves.

The window shows the address it advertises, the certificate fingerprint, a code to scan and a link to
the console. Closing the window hides it to the tray and leaves the relay serving; **Quit** from the
tray or the menu stops the relay and exits. The tray offers the address, **Copy relay link**,
**Open console** and **Quit**.

`SUITE_SYNC_BIND` still wins over the stored scope for a test, a smoke run or a unit that names an
address; the window then says the reach is fixed by the environment and disables the selector.

**Start the relay when I log in** writes one XDG autostart entry,
`~/.config/autostart/run.suite.sync.desktop`, whose command is `flatpak run run.suite.sync --hidden`.
The Flatpak is granted exactly one host path for it, `--filesystem=xdg-config/autostart:create`; a
directory grant keeps the host's own `~/.config/autostart` in place, so the session that reads the
file is the host's. The same entry can be written without a desktop session:

```sh
flatpak run --command=suite-sync run.suite.sync autostart on
flatpak run --command=suite-sync run.suite.sync autostart status
flatpak run --command=suite-sync run.suite.sync autostart off
```

The app keeps its store at `~/.var/app/run.suite.sync/data/suite-sync`, with the certificate pair in
`tls/` beside it, mode 0600. The pin survives restarts and updates: a new pair would unpin every
device, so it is only replaced deliberately.

### The headless command

A machine with no desktop runs the same install without opening a window:

```sh
flatpak run --command=suite-sync run.suite.sync serve \
  --store "$HOME/.var/app/run.suite.sync/data/suite-sync" \
  --host 127.0.0.1 --port 8787 --trust-all
```

`--store` has to name a path the sandbox can write: the app's own data directory is the one that
always is. `/var/lib` is not, so the host-install unit below is for a `suite-sync` binary on the host,
not for the Flatpak.

The reach scopes belong to the tray app. The headless command binds exactly what `--host` says, and
the loopback/TLS rules above decide whether that bind is allowed.

From a checkout, the same CLI runs through the workspace:

```sh
pnpm --filter @suite/sync-server run build:all
node apps/sync/dist/cli.js --version
```

### How Start finds a relay

Suite Start spawns `suite-sync serve` directly. It looks in this order:

1. `SUITE_SYNC_BIN`, if it is set. It has to point at the executable; Start does not fall back to
   another copy when the named path is missing.
2. a `suite-sync` beside Start's own binary (or in its resources directory);
3. `suite-sync` on `PATH`.

A Flatpak install is none of those: its launcher only exists inside the sandbox. Start does not
supervise the tray app's relay and does not need to. Enter the address and pin the app shows in each
app's Sync dialog, and leave Start as a launcher.

## 2. Choose an address, honestly

The tray app binds `0.0.0.0` and serves `wss://` with the pair it made. The headless command defaults
to `127.0.0.1`, which only this machine can reach — the right default, and the wrong setting for a
relay whose purpose is to be reached.

**Off loopback, the relay needs TLS.** A bind on any address other machines can reach refuses to start
without `--tls-cert` and `--tls-key`. Both flags or neither. The certificate is normally self-signed:
there is no authority to ask, and each app pins the SHA-256 fingerprint instead of trusting a chain.
The tray app makes and keeps this pair itself; a headless relay needs one of its own, inside the app's
data directory because that is the writable path:

```sh
mkdir -p "$HOME/.var/app/run.suite.sync/data/tls"
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
  -keyout "$HOME/.var/app/run.suite.sync/data/tls/relay-key.pem" \
  -out "$HOME/.var/app/run.suite.sync/data/tls/relay-cert.pem" -days 825 \
  -subj "/CN=suite-sync relay"
chmod 600 "$HOME/.var/app/run.suite.sync/data/tls/relay-key.pem"
```

Start the relay with both files:

```sh
flatpak run --command=suite-sync run.suite.sync serve \
  --host 0.0.0.0 --port 8787 --trust-all --trust-all-remote \
  --tls-cert "$HOME/.var/app/run.suite.sync/data/tls/relay-cert.pem" \
  --tls-key "$HOME/.var/app/run.suite.sync/data/tls/relay-key.pem"
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
# flatpak run --command=suite-sync run.suite.sync serve --host 0.0.0.0 --trust-all

# accepted, and the status line says what it now is
flatpak run --command=suite-sync run.suite.sync serve \
  --host 0.0.0.0 --trust-all --trust-all-remote \
  --tls-cert "$HOME/.var/app/run.suite.sync/data/tls/relay-cert.pem" \
  --tls-key "$HOME/.var/app/run.suite.sync/data/tls/relay-key.pem"
```

Put that relay on a network you trust, or behind a VPN, and keep the port closed at the router. The
store is encrypted frame bytes with no integrity story against a hostile stranger who can write to it;
`--trust-all-remote` is the flag that says you know that.

`suite-sync status` prints the configuration a `serve` would use without starting one, including
whether the transport is `ws` or `wss`, which is the cheapest way to check a unit file before
restarting it.

## 3. Run the headless relay under systemd

The Flatpak is a user install, so the unit is a user unit. Anything else would run as root against a
Flatpak root cannot see, and the store is the app's own data directory.

```sh
install -d -m 0700 ~/.config/systemd/user ~/.config/suite-sync
install -m 0644 deploy/suite-sync-flatpak.service ~/.config/systemd/user/suite-sync.service
install -m 0600 deploy/relay-flatpak.env.example ~/.config/suite-sync/relay.env
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

The host-binary alternative is `deploy/suite-sync.service`, a system unit with `DynamicUser=yes` and
`StateDirectory=suite-sync`. It is for a `suite-sync` tree on the host (`/opt/suite-sync` and a
`/usr/local/bin` symlink) and its own `deploy/relay.env.example`. A Flatpak cannot write
`/var/lib/suite-sync`, so do not mix the two.

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
document, an author or a change. `flatpak run --command=suite-sync run.suite.sync status` prints the
configuration, and the tray window draws the same two numbers on its console.

## The relay console and the relay code

`serve` starts a second, read-only listener on `127.0.0.1` and prints its URL:

```text
console: http://127.0.0.1:<port>/console?token=<token>
```

The token is made at startup and accepted as `?token=` or the `X-Suite-Console-Token` header; a
request without it gets a 401. The console is loopback-only even when the relay binds `0.0.0.0`. It
shows the relay's version, store size, workspaces, members and frame counts — metadata the relay
already reads — and no frame payload. **Open console** in the tray app opens it with the token the app
already holds.

The page draws a `suite://relay` QR code. `u` is the relay address, `f` the certificate fingerprint,
and a live invitation adds `w` (workspace id) and `i` (invitation id), so the code is also a bearer
invitation. The tray window draws a code with the address and pin; the console's code adds the
invitation when one exists. Friend codes and contacts are app data, not relay data; the relay never
stores them. The shipped ways to reach a relay are its address plus pin, an invitation, or one of
these codes.

## 5. Point devices at it

Open the app's Sync dialog and enter the relay address, for example
`wss://192.168.1.20:8787/sync`, then paste the relay's `certificate SHA-256 fingerprint:` line into
**Relay certificate fingerprint**. The field appears for a `wss://` address or invitation; the app
keeps the pin in its main process, and a different certificate is refused with no plaintext fallback.
A loopback address may stay `ws://` and needs no fingerprint. Nothing syncs while the app is closed;
see `suite-go`'s decisions.

Scanning the code in the tray window does the same thing on a device that scans codes: it carries the
address and pin, so nothing has to be typed.

## Running the relay somewhere else

A relay on a NAS, a Raspberry Pi or a spare desktop is the ordinary shape. Do steps 1–4 there and
leave it running; the machine with Start does not need a relay of its own.

Start's Sync pane manages only a relay it can find: `SUITE_SYNC_BIN`, a copy shipped beside Start,
then `suite-sync` on `PATH`. A Flatpak install is not on that path, so Start reports no relay and stays
a launcher. Enter that `wss://` address and its fingerprint in each app's Sync dialog. A relay on
`127.0.0.1` is private to the machine that runs it, which is the right default and the wrong setting
for one that exists to be reached.

The certificate pair belongs on the relay machine too. The pin each app stores is that certificate's
SHA-256, so replacing the pair means entering the new fingerprint once on every device.

The relay's store belongs to that machine — back up the app's data directory, not the laptop — and
Start's pane shows the store of a relay it started, not the store of one across the network.

## Building and publishing a release

The monorepo has one release path, and the Flatpak is built by the same script as the other apps:

```sh
node scripts/flatpak.mjs --app sync              # package, sign, publish and install locally
node scripts/flatpak.mjs --app sync --no-build   # reuse apps/sync/app/release/linux-unpacked
```

The manifest packages the unpacked build `package:dir` produced, so the relay inside the app is the
same code the gate tested. There is no pre-release identity for Sync: a tier would be a second mailbox
on the same data, so `--channel` is refused.

The `sync-v<version>` release still carries `suite-sync-<version>-<arch>.tar.gz`, `SHA256SUMS` and its
signature today; `node scripts/release.mjs sync` builds and signs them. Removing that artifact from the
release script is a separate change that has not landed yet, so this page does not tell you to skip
it. The Flatpak is the install path described above.

## Upgrading

```sh
flatpak update --user run.suite.sync
systemctl --user restart suite-sync   # for the headless form
```

The store is append-only and the format is versioned; a relay does not read what it stores, so an
upgrade cannot migrate it and does not need to. The tray app picks the new build up the next time it
starts.

Check `--version` on both sides after an upgrade. A protocol mismatch is refused at connect time, not
discovered as a corrupt document later.

## Backing up

Back up the app's data directory, `~/.var/app/run.suite.sync/data/suite-sync`. It is the only state a
relay has, and losing it does not lose a document — devices hold the truth — it only loses frames that
had not been delivered yet. The `tls/` pair is in there too; restoring the store with the pair keeps
every device's pin valid.

## What this relay still does not do

- **No push.** A device with the app closed learns nothing until it is opened (`suite-go` decisions).
- **No certificate authority.** The certificate is self-signed and the app pins its fingerprint; there
  is no chain, hostname validation or renewal service to trust.
- **No device registry.** `--trust-all` is the only mode a `serve` will accept, which is why the
  acknowledgement flag exists.
- **No search, projection or rendering.** It cannot decrypt, so it cannot answer anything about a
  document.
- **No federation.** One relay, the addresses you give it.
