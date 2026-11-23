# Suite

Two hosts, one pack contract, and documents that stay files. **Suite Shell** runs signed packs on the
desktop; **Suite Go** does the same on a phone. There is no account, no telemetry and no server the
project operates.

> **Alpha.** Suite Shell is alpha and Suite Go is v0. Linux x86_64 and Android arm64 are the only
> published targets. Keep documents somewhere you back up.

## The hosts

| Host | What it is | State | Install |
| --- | --- | --- | --- |
| **Suite Shell** | The desktop host: one window, a tab per pack, a Home Screen and a local catalogue | Alpha | `flatpak install --user suite run.suite.shell` |
| **Suite Go** | The mobile host: one container, one pack at a time, the same document boundary | v0 | [suite-go.apk](https://github.com/mrrnbhd/suite-apps/releases/latest/download/suite-go.apk) |

Add the signed store once; every desktop install comes from it:

```sh
flatpak remote-add --user --if-not-exists --from suite https://flatpak.suite.run/suite.flatpakrepo
flatpak install --user suite run.suite.shell
```

Suite Go is not a Flatpak. Download the APK and `adb install -r -t suite-go.apk`. Pre-release builds
live on the `suite-nightly-<date>` and `suite-preview-<date>` pages; [Channels](docs/explanation/channels.md)
says what each one promises. The Flatpak remote is the update path; the rolling
[`suite-<date>` release](https://github.com/mrrnbhd/suite-apps/releases/latest) is the GitHub mirror.

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

Shell is alpha: Home, the pack catalogue, install, update, remove and `suite://` routing work; capture,
contributions and Screen export/import do not. Go is v0: Scratch proves capture and the document
handoff, Canvas is a placeholder, and an installed pack appears on home.

[Status](docs/reference/status.md) has every subsystem, including the parts that are not built.

## Build

Node and pnpm are pinned in `package.json`; `mise exec --` resolves both.

```sh
mise exec -- pnpm install
mise exec -- node scripts/gate.mjs               # every row, in dependency order
mise exec -- node scripts/gate.mjs --only shell
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
