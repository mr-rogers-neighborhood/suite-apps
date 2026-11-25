<p align="center"><a href="https://suite.run"><img src="docs/assets/suite-icon.png" alt="Suite" width="96" height="96"></a></p>

# Suite

Suite is a desktop app and a phone app for work you keep in your own files. **Suite Desk** runs
*packs* on your computer; **Suite Go** runs the same packs on your phone. A pack is a small signed
app for one job — Canvas for boards, Planner for days, Budget for money — and every document it
opens is a file you own. There is no account, no telemetry and no server this project operates:
copy a document, back it up, open it offline.

<!-- The canonical brand asset is the Suite Desk app icon, promoted in #411. -->

> **Alpha.** Suite Desk is alpha and Suite Go is v0. Linux x86_64 and Android arm64 are the only
> published targets. Keep documents somewhere you back up.

## Install

Suite Desk is the desktop host and Suite Go is the mobile host. Add the signed Flatpak remote once,
then install the stable release:

```sh
flatpak remote-add --user --if-not-exists --from suite https://flatpak.suite.run/suite.flatpakrepo
flatpak install --user suite run.suite.desk
```

Suite Go is not a Flatpak: download `suite-go.apk` from the stable release page and
`adb install -r -t suite-go.apk`. The Flatpak remote is the update path (`flatpak update --user`);
[Channels](docs/explanation/channels.md) says what each channel promises.

The tables below are generated from the versions in the tree and the newest published page of each
channel. Run `node scripts/release-status.mjs --write` after a release; `--check-readme` fails when
they drift.

<!-- BEGIN generated:channels (scripts/release-status.mjs; do not edit by hand) -->

### Release

| Host | Version | Install |
| --- | --- | --- |
| **Suite Desk** | 0.4.0 | `flatpak install --user suite run.suite.desk` |
| **Suite Go** | 0.2.0 | [`suite-go.apk`](https://github.com/mrrnbhd/suite-apps/releases/latest/download/suite-go.apk) |

### Pre-Release

| Channel | Suite Desk | Suite Go | Page |
| --- | --- | --- | --- |
| `preview` | `flatpak install --user suite run.suite.preview.desk//preview` | `suite-go-preview-<version>.apk` on that page | [`suite-preview-2026.11.25`](https://github.com/mrrnbhd/suite-apps/releases/tag/suite-preview-2026.11.25) |
| `nightly` | `flatpak install --user suite run.suite.nightly.desk//nightly` | `suite-go-nightly-<version>.apk` on that page | [`suite-nightly-2026.11.25`](https://github.com/mrrnbhd/suite-apps/releases/tag/suite-nightly-2026.11.25) |
| `slop` | `flatpak install --user suite run.suite.slop.desk//slop` | `suite-go-slop-<version>.apk` on that page | [`suite-slop-2026.11.25-f9bd624`](https://github.com/mrrnbhd/suite-apps/releases/tag/suite-slop-2026.11.25-f9bd624) |

<!-- END generated:channels -->

Each channel installs beside the others, so a `preview` build and the `stable` one can both be
installed. Suite Go is not a Flatpak: download the channel page's APK and `adb install -r -t`. The
rolling [`suite-<date>` release](https://github.com/mrrnbhd/suite-apps/releases/latest) is the
GitHub mirror; the signed remote is the update path.

## Packs

A pack is a signed web bundle with a manifest. The host verifies the publisher key and every file hash
before it runs, gives the pack its own origin and session, and enforces the capabilities the manifest
declares. A pack renders its UI; the host carries bytes and never parses a document.

The contract is [the superapp specification](docs/spec/superapp.md); its
[ledger](docs/spec/ledger.md) says which clauses the tree implements. [The mini-app
model](docs/explanation/mini-app-model.md) explains what is borrowed from WeChat and the W3C MiniApp
work, and where Suite differs.

## Documents

A document is a file you own, handed to a pack as an opaque handle scoped to that pack. Copy it, back
it up, open it offline. Nothing here has an account or a hosted copy.

## State

Desk is alpha: Home, the pack catalogue, install, update, remove and `suite://` routing work; capture,
contributions and Screen export/import do not. Go is v0: Scratch proves capture and the document
handoff, Canvas is a placeholder, and an installed pack appears on home.

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
