# Suite Start

The hub for Suite. It is a launcher, not a host: apps stay separate signed processes, and Start
never holds a document. Suite operates no server; a person runs the Suite Sync app on a device they
control.

## Install it

Suite Start is the one app you fetch by hand; every other app in the suite arrives through it.
[Installing Suite Start](docs/how-to/install.md) owns the signed Flatpak remote, `flatpak install`,
the first launch and the card states worth recognising. [Packaging](docs/how-to/package.md) explains
why Flatpak is the only Linux desktop form: Start asks the writer that owns each deployment and never
replaces one itself. Everything below describes the code rather than the download.

## What exists

- **Built:** the shared packages (`@suite/contracts`, `@suite/files`), the Electron launcher shell with
  discovery, install, routing and the Suite Help card, the Sync tab's deployment states for the
  `run.suite.sync` Flatpak, and the invite/join flow in the apps' Sync dialogs.
- **Later:** person keys and the shared sync protocol's remaining surface. There is no hosted web app,
  control plane or relay; sync is a server the user runs.

Changes, in a person's words rather than commits: [CHANGELOG.md](CHANGELOG.md).
Where accessibility stands, and what is checked by hand: [ACCESSIBILITY.md](ACCESSIBILITY.md).

## Sync

Suite Sync is the Flatpak `run.suite.sync`, and its tray app is the relay. Start installs it and opens
it exactly like any other app: detection reads `flatpak list`, Install asks the Suite store, and Open
runs `flatpak run run.suite.sync`. Start never writes into the deployment and never supervises the
relay.

The Sync tab has three honest states: not installed (Install), installed (the version and commit
Flatpak reports, and Open), or a problem (why neither is possible). The app shows its own address,
relay code and SHA-256 fingerprint; the pane does not repeat them, open its console, or read its
frames. Start is not a contact book either: friend codes and contacts live in the apps.

A relay may run on this machine or another. Either way the tray app owns it, and a device joins with
an invitation, a relay code, or the address and fingerprint the app shows.

## Two rules

1. **Start is not in the data path.** It returns a path or a URL. It never proxies document bytes.
2. **Only the app owns its document.** Start opens, copies and bundles files; it cannot edit them.

---

For the product story and the influences behind it, read
[What Suite is](../../docs/explanation/why-suite-exists.md).

## Packages

| Package            | Owns                                                                          | Does not own                  |
| ------------------ | ----------------------------------------------------------------------------- | ----------------------------- |
| `@suite/contracts` | `suite.app`, `suite.deployment`, deep-link parsing, contract versioning       | Any app schema, any I/O       |
| `@suite/files`     | Envelope mechanics, base64, size limits, backup naming and retention planning | `fs`, an app's envelope shape |
| `src`              | App discovery, launch plans, `suite://` routing                               | App UI, app documents         |

`@suite/files` has two entry points: `.` is pure and can run in a renderer, `./node` is where `fs`
lives. They are one package because a package that depends on a sibling cannot be installed from a git
URL — pnpm refuses a git subdependency outright. The split is preserved as subpaths, so a renderer
importing `.` still never reaches `fs`.

## Gate

```sh
pnpm check
```

Biome, a workspace build, `tsc` across every package, then Vitest. Every gate is local; no CI service
gates this repository.

## Consuming these packages

The apps consume `@suite/contracts`, `@suite/files`, `@suite/desktop`, `@suite/theme` and `@suite/ui`
as `workspace:*` from this monorepo. A local edit is the edit that builds.

`dist` is still committed for the shared packages. `pnpm build:verify` rebuilds them and fails if the
committed output has drifted. The root gate builds the same packages once before the app checks.

## Releasing

1. `pnpm check` — green; `pnpm build:verify` — the committed shared `dist` has not drifted.
2. Run the root gate with `--fresh`, so `.dev/gate-status.json` proves the commit rather than the
   working tree.
3. `node scripts/flatpak.mjs --app start` builds the hub and installs the local deployment.
4. `node scripts/flatpak-remote.mjs --app start --publish` signs and copies the store. The hub is
   tagged `start-v<version>`, so it cannot collide with another app's version.
   [Version ownership](../../docs/how-to/package-and-release.md#version-ownership) names the file
   that owns the number.

The Flatpak is built from the same unpacked tree as every app; Flatpak owns its deployment and the
hub's own row offers **Update Start** only when the installed `run.suite.start` commit differs from the
newest commit on that deployment's own origin. A placed copy gets no update button.

[Package and release](../../docs/how-to/package-and-release.md) describes the scripts and what they
refuse; [Packaging channels](../../docs/reference/packaging-channels.md) explains the artifact forms.

## Working in the monorepo

The apps, the hub and the sync server share one repository and one gate. Start with the
[root README](../../README.md), then [Commands](../../docs/reference/commands.md) for the gate and
[Repository layout](../../docs/reference/repo-layout.md) for where each package lives.

## The launcher

The app is an Electron window: app cards, recent files, and the `suite://` handler. It is a
launcher, so it starts a process and gets out of the way — it does not embed an app's UI, proxy its
documents, or run its code.

The hub also ships as the Flatpak `run.suite.start`, with the same zypak wrapper as the apps. Its
sandbox grants the host Flatpak service (`org.freedesktop.Flatpak`, used with
`flatpak-spawn --host`) and the folders Start owns. That host access is effectively host command
execution; it is the trade that lets a sandboxed hub manage deployments. The hub's own row offers
**Update Start** only after the installed commit and its origin's newest commit are both read and
differ; a placed copy has no deployment Flatpak may replace, so it gets no update button.

A file row offers **Copy link**, which is `suite://<app>/workspace/<file name>`. Pasting one opens that
document in that app: the hub routes it, and the app resolves the name against its own folder. The link
names a file rather than an id, so it stays readable and needs no registry to resolve.

Discovery joins two records. The **manifest** (`suite.app.json`) is what an app ships beside its own
executable and says what it is; the **install record** (`installs.json`, under
`~/.config/suite/start`) is the only place an executable path lives. A manifest may not name a binary, so a tampered one cannot redirect
a launch.

**Add app…** runs a file picker in the main process, reads the manifest beside the chosen executable and
writes the record — the same handoff a packaged install has, for a copy you built or placed yourself.

Flatpak exports each app's menu entry, so Start no longer writes one. A folder copy is launched by
Start, so it needs no entry of its own. That is still the point of the hub — it does not keep the apps
to itself.

**One copy per app.** A Flatpak deployment is the app. A folder copy a person places is listed
separately and offers Open, Reveal and Forget; Start does not update it. Two copies of one app share a
profile and its single-instance lock, so only one can run. When discovery finds both, the Flatpak is
the card Start shows and the folder copy is listed as a duplicate to remove.

**Install is a Flatpak operation.** `catalogue.ts` names the document apps, Suite Help and Start, and
the store decides what it offers. A fresh install probes `suite` first, then `suite-local`; when a
remote offers an app, the card says `Not installed yet · from the store` and Install asks Flatpak. An
installed deployment is compared with its own origin's commit, so a copy from `suite-local` is not
measured against the public `suite` store; a newer commit says `update available`, and **Update**
asks Flatpak. A card is in one of five honest states: not installed, no release found, Flatpak,
Flatpak · update available, or from a folder. Pre-release cards sit in their own section below the
stable list under one shared caution, and each wears its stable app's mark. `SUITE_START_APPS_ROOT`
moves the folder-copy root for a test.

Each card carries the app's mark, including the new Help and Sync marks; the Sync pane uses the Sync
glyph at heading size. A mark is white on the hub's ink tile, and a light theme inverts the tile and
the glyph together so the same asset stays legible.

```sh
pnpm build && pnpm --filter @suite/start start   # the launcher
pnpm e2e                                         # its own gate; needs a display or xvfb-run
```

`pnpm e2e` is serial and launches the real application, because what it does with a handoff from the
operating system cannot be checked any other way.
