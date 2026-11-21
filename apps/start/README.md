# Suite Start

The hub for Suite. It is a launcher and a sync supervisor, not a host: apps stay separate signed
processes, and Start never holds a document. Suite operates no server; a person runs the `suite-sync`
server on a device they control.

## Install it

Suite Start is the one app you fetch by hand; every other app in the suite arrives through it.
[Installing Suite Start](docs/how-to/install.md) owns the Arch package, the AppImage, the Flatpak,
the checksum and the error messages worth recognising. [Packaging](docs/how-to/package.md) explains
the Linux forms and why the hub is packaged while the apps it installs come through Start or Flatpak:
Start can only replace a file it is allowed to write, or ask Flatpak to. Everything below describes the code rather than the
download.

## What exists

- **Built:** the shared packages (`@suite/contracts`, `@suite/files`), the Electron launcher shell with
  discovery, install, routing and the sync-status surfaces, supervision of the separate `suite-sync`
  server, and the invite/join flow in the apps' Sync dialogs.
- **Later:** person keys and the shared sync protocol's remaining surface. There is no hosted web app,
  control plane or relay; sync is a server the user runs.

Changes, in a person's words rather than commits: [CHANGELOG.md](CHANGELOG.md).
Where accessibility stands, and what is checked by hand: [ACCESSIBILITY.md](ACCESSIBILITY.md).

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
3. `node scripts/release.mjs start --publish`. It builds the AppImage, writes the signed feed under
   `feeds/start/`, builds the Arch package when `makepkg` is present, uploads them, and commits the
   manifest.
4. Keep the `start-` tag prefix: a hub release is tagged `start-v<version>` so it cannot collide with
   another app's release. [Version ownership](../../docs/how-to/package-and-release.md#version-ownership)
   names the tag for every app.

The Flatpak is built from the same unpacked tree with `node scripts/flatpak.mjs --app start`; the
signed store publishes it beside the apps.

[Package and release](../../docs/how-to/package-and-release.md) describes the script and what it
refuses; [Packaging channels](../../docs/reference/packaging-channels.md) explains the artifact forms.

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
execution; it is the trade that lets a sandboxed hub manage deployments. A Flatpak hub's own row
offers an update through Flatpak; an AppImage hub still updates the apps it placed but cannot replace
itself.

A file row offers **Copy link**, which is `suite://<app>/workspace/<file name>`. Pasting one opens that
document in that app: the hub routes it, and the app resolves the name against its own folder. The link
names a file rather than an id, so it stays readable and needs no registry to resolve.

Discovery joins two records. The **manifest** (`suite.app.json`) is what an app ships beside its own
executable and says what it is; the **install record** (`installs.json`, under
`~/.config/suite/start`) is the only place an executable path lives. A manifest may not name a binary, so a tampered one cannot redirect
a launch.

**Add app…** runs a file picker in the main process, reads the manifest beside the chosen executable and
writes the record — the same handoff a packaged install has, for a copy you built or placed yourself.

A managed install also earns a menu entry: `~/.local/share/applications/suite-<id>.desktop`, user scope,
written on install and rewritten on update, so the app can be opened without Start. That is the point of
the hub — it does not keep the apps to itself.

**One copy per app, and its owner is decided at install.** A copy Start installed is Start's to replace
and to delete: the card offers **Update** and **Uninstall**, and says **running** when the process Start
started is still alive, asking before it closes and replaces it. A copy you placed is first-class but
Start does not update it — the card offers Open, Reveal and Forget, never Uninstall, and its updates
are yours to make. Two copies of one app share a profile and its single-instance lock, so only one can
run. When discovery finds both an AppImage and a Flatpak deployment, the Flatpak is the one Start
shows; the AppImage is listed as a duplicate to remove. A per-app switch is not built yet.

**Install** is Start's own job. `catalogue.ts` names the three apps the suite offers and the feed each
one declares, and asks every feed what version it has when the window opens or when you press _Check for
updates_. When a Flatpak store (`suite` or `suite-local`) offers an app, Install asks Flatpak instead,
and the card says `from the store` before you press anything; a deployment whose commit is behind the
store's says `update available`. A card is then in one of four honest states: not installed, no
release found, an update available, or up to date. Pressing the button downloads the artifact named by
the **verified** manifest, checks its sha512 against that manifest, places it in `~/Applications/Suite/<App>/<version>/`,
makes it executable, writes the manifest and the install record — and nothing is unpacked, ever.
`SUITE_START_APPS_ROOT` and `SUITE_START_FEED_BASE` move those two roots for a test.

```sh
pnpm build && pnpm --filter @suite/start start   # the launcher
pnpm e2e                                         # its own gate; needs a display or xvfb-run
```

`pnpm e2e` is serial and launches the real application, because what it does with a handoff from the
operating system cannot be checked any other way.
