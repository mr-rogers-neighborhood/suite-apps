<p align="center"><a href="https://suite.run"><img src="docs/assets/suite-icon.png" alt="Suite" width="96" height="96"></a></p>

# Suite

Suite is a home for mini-apps. **Suite Desk** runs them on your computer; **Suite Go** runs them on
your phone. Canvas for boards, Planner for days, Budget for money, Help for the handbook: small apps
that share one place, and every document they open is a file you own. Share a board or a plan with
the people you choose, and it stays your file. There is no account, no ads, no telemetry and no
server this project operates: copy a document, back it up, open it offline.

<!-- The canonical brand asset is the Suite Desk app icon, promoted in #411. -->

> **Alpha.** Suite Desk is alpha and Suite Go is v0. Linux x86_64 and Android arm64 are the only
> published targets. Keep documents somewhere you back up.

## Install

Install Suite Desk on Linux or Suite Go on Android. Add the signed Flatpak remote once, then install
the stable release:

```sh
flatpak remote-add --user --if-not-exists --from suite https://flatpak.suite.run/suite.flatpakrepo
flatpak install --user suite run.suite.desk
```

Suite Go is not a Flatpak: download `suite-go.apk` from the stable release page and
`adb install -r -t suite-go.apk`. The Flatpak remote is the update path (`flatpak update --user`);
[Channels](docs/explanation/channels.md) says what each channel promises.

The tables below are generated from the channel model. They name the install command and the page
shape, not a version or a live pre-release tag: `package.json` owns the version (D6.4) and pruning
removes old pre-release pages. Run `node scripts/release-status.mjs --write` after a channel change;
`--check-readme` fails when the tables drift.

<!-- BEGIN generated:channels (scripts/release-status.mjs; do not edit by hand) -->

### Release

| Channel | Suite Desk | Suite Go | Page |
| --- | --- | --- | --- |
| `stable` | `flatpak install --user suite run.suite.desk` | [`suite-go.apk`](https://github.com/mrrnbhd/suite-apps/releases/latest/download/suite-go.apk) | [`suite-<date>`](https://github.com/mrrnbhd/suite-apps/releases/latest) |

### Pre-Release

| Channel | Suite Desk | Suite Go | Page |
| --- | --- | --- | --- |
| `preview` | `flatpak install --user suite run.suite.preview.desk//preview` | `suite-go-preview-<version>.apk` on that page | `suite-preview-<date>` |
| `nightly` | `flatpak install --user suite run.suite.nightly.desk//nightly` | `suite-go-nightly-<version>.apk` on that page | `suite-nightly-<date>` |
| `slop` | `flatpak install --user suite run.suite.slop.desk//slop` | `suite-go-slop-<version>.apk` on that page | `suite-slop-<date>-<revision>` |

<!-- END generated:channels -->

Each channel installs beside the others, so a `preview` build and the `stable` one can both be
installed. Suite Go is not a Flatpak: download the channel page's APK and `adb install -r -t`. The
rolling [`suite-<date>` release](https://github.com/mrrnbhd/suite-apps/releases/latest) is the
GitHub mirror; the signed remote is the update path.

## Mini-apps

A mini-app is a small signed app for one job. Suite checks who made it and that every file is the
one they signed before it runs, gives it its own space, and lets it do only what it asks for. A
mini-app draws its own screen; Suite carries your files without reading them.

Behind that promise are [the superapp specification](docs/spec/superapp.md) and its
[ledger](docs/spec/ledger.md), which says what the code already does. [The mini-app
model](docs/explanation/mini-app-model.md) explains what is borrowed from WeChat and the W3C MiniApp
work, and where Suite differs. Developers still call the package a pack; the contract is the same.

## Documents

A document is a file you own. Suite hands it to a mini-app without giving the app your file system:
each app sees only the documents it is allowed to open. Copy it, back it up, open it offline.
Nothing here has an account or a hosted copy.

## State

Desk is alpha: Home, the catalogue, install, update, remove and `suite://` links work; some parts are
still being built. Go is v0: Scratch proves capture and the document handoff, Canvas is a
placeholder, and an installed mini-app appears on home.

[Status](docs/reference/status.md) has every subsystem, including the parts that are not built.

## Build

Node and pnpm are pinned in `package.json`; `mise exec --` resolves both.

```sh
mise exec -- pnpm install
mise exec -- node scripts/gate.mjs               # every row, in dependency order
mise exec -- node scripts/gate.mjs --only desk
mise exec -- node scripts/gate.mjs --fresh       # prove the commit, not the tree
```

A pull request runs the rows its diff can break; `main` runs the full fresh gate, and the merge queue
adds the e2e suite. Read [Commands](docs/reference/commands.md) before running a heavy check.

## Documentation

The documentation app is the reader: `mise exec -- pnpm docs:dev` opens the explorer over the file
tree, one narrative per module, and ordered tours through the code. Reference facts are derived; module
notes and tours carry the prose. The check path is headless (`docs:check`, `docs:index:check`,
`docs:build`).

The pages in [docs](docs/README.md) are the source: decisions, architecture, commands and each app's
own docs. One fact has one home; a page links the owner rather than restating it.

## Contributing

Read `AGENTS.md` at the root and the owning app's `AGENTS.md` before editing. Shared packages are
`workspace:*`; a change that needs a sibling app edited is a coordination, not a side effect.
[Contribute a change](docs/how-to/contribute.md) has the branch, commit, docs and verification rules.

Report a vulnerability per the owning app's `SECURITY.md`.

## Licence

MIT, © Suite contributors.
