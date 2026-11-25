# Repository and pack structure specification

Status: draft 0.1. Target layout and ownership. The product contract is [superapp.md](superapp.md);
the pipeline is [ci.md](ci.md); the delivery contract is [delivery.md](delivery.md).

## 1. Shape

**R1.1** One pnpm workspace. The root lockfile is the only lockfile. Shared packages are
`workspace:*`; no git-tag pins, no `link:` paths, no second package manager.

**R1.2** One tree with four roots. `hosts/<host>` is a host and owns its shell, tests and docs.
`packs/<app>` is a pack workspace package (`@suite/<app>-pack`) whose `pack/` holds the source.
`legacy/<app>` is a frozen app: its Electron shell, renderer, private packages, tests and docs.
`services/relay` is the relay. A shared package lives under root `packages/` only when two or more
apps consume it; an app's private packages stay under `hosts/<host>/packages/` or
`legacy/<app>/packages/`. Cross-app documentation is `docs/` and the Flatpak manifests are
`packaging/`.

**R1.3** The desktop host is `hosts/desk` (`@suite/desk`), and it is the way in: it reads a verified
index, installs packs and opens them. It is the only desktop install path. The legacy Start hub was
retired in [#314](https://github.com/mrrnbhd/suite-apps/issues/314); its catalogue and Home moved
here, and a frozen Flatpak keeps its documented `flatpak install` line. Go is the mobile host. The
relay is `services/relay`, with its app and server packages beside it.

**R1.4** Flatpak manifests live in `packaging/flatpak/`. The spec lives in `docs/spec/`. An app's
own docs stay beside its code: `hosts/<host>/docs/`, `legacy/<app>/docs/` or `services/relay/docs/`.

## 2. Packs

**R2.1** One pack format for desktop and mobile. `@suite/pack` owns the manifest, canonical bytes,
signature, capabilities and host fit. `@suite/pack-host` owns the archive reader/writer and scoped
store. Go consumes the same parser and verifier; `hosts/go/packages/go/src/pack.ts` retires rather
than keeping a second manifest. This closes #202.

**R2.2** A pack is a workspace package. `packs/<app>` is `@suite/<app>-pack`; its `package.json`
declares `"suite": { "pack": true }`, owns the pack's build toolchain, and its `pack/` directory
holds the source. `pack/` MUST contain `manifest.json` (the source manifest, whose `version` equals
the app version), `src/` with the pack entry and its prelude, one `vite.config.ts` build config, at
least one `*.test.*` run by the package's `test` script, and a `README.md` that links
[the pack authoring reference](../reference/pack-authoring.md). The source-only rules apply to
`pack/`: no `node_modules/`, `dist/` or other generated directory may live under it, and the build
writes its artifact to a generated output directory outside it. The package's installed tree is
`packs/<app>/node_modules/`, which pnpm creates and git ignores. Extra files are permitted.
`node scripts/pack-shape.mjs` enforces this minimum in the gate; the authoring reference explains
each item.

**R2.3** The pack version is the app version or an explicit pack version in one file; it is not
restated in prose. The manifest's file list and signature are generated from the build output, not
hand-edited.

**R2.4** A pack declares its documents, blobs, sync scopes, capabilities, widgets, components,
locales, export entry and add-ons in the manifest. A field a host does not implement is a refusal,
not a silent skip. [manifest.schema.json](manifest.schema.json) is the field list and the closed
capability vocabulary; a checker reads it rather than repeating it.

**R2.5** Legacy Canvas, Planner, Budget and Help stay frozen at their last Flatpak artifact until
each becomes a pack. A frozen app is not deleted; its code, docs and last artifact stay under
`legacy/<app>/`.

## 3. Ownership

**R3.1** Each app or package has an owner in `.github/CODEOWNERS`. A change that spans apps needs the
owning owners; changing a sibling to make one app pass is not the fix.

**R3.2** Contract boundaries: `@suite/pack` (manifest and signature), `@suite/pack-host` (archive and
scoped store), `@suite/pack-runtime` (pack-side services), `@suite/contracts` (widgets, screens,
sync capability), `@suite/document-runtime` (renderer replica and atomic store). A change to one is a
contract change and lands with its tests.

**R3.3** The host never parses an app document payload; the pack owns its schema. A shared package
must not import Electron, Node or DOM unless its package name and README say so.

**R3.4** A spec clause is the anchor for a change. A PR that implements a clause cites the ID
(`S4.2`) in its body; a test that covers one carries `// spec: S4.2`.

## 4. Release identity

**R4.1** The superapp is `desk` and `go`. A pack is per app. A legacy Flatpak is frozen. A channel
belongs to the superapp; a pack carries a version.

**R4.2** The app's `package.json` owns the app version; the Android Gradle file owns the Android
version; the pack manifest owns the pack version. Cross-references link the file, never restate the
number.

**R4.3** A release tag names the rolling suite (`suite-YYYY.MM.DD`) or a pre-release channel page;
per-app tags are retired, because an app's version lives in its `package.json` and the rolling
release carries it. A channel is a branch/artifact identity, not a tag namespace.

## 5. Concurrent agents

**R5.1** One task per branch/worktree. A branch is short-lived and names the issue or clause it
serves. A PR is small enough to review in one sitting; split a change that touches several apps.

**R5.2** Hotspot files are `package.json`, `pnpm-lock.yaml`, `scripts/gate.mjs`,
`.github/workflows/*`, `docs/spec/README.md` and the shared contracts. A change that touches one is
small and calls it out; a lockfile-only change is a dedicated chore PR where possible.

**R5.3** An agent runs the owning app's `--only` gate before pushing. It does not run the full e2e
unless the task needs it. The merge queue and nightly own the full proof ([ci.md](ci.md) C1.2).

**R5.4** Generated files (`.dev/`, build output, docs index, gate status) are not committed. A
generated page is refreshed by its script, not hand-edited.

**R5.5** A review-only agent comments or requests changes; it never merges. The coordinator runs the
merge queue; it is the last check.

## 6. Migration

**R6.1** The tree move is the one recorded exception to a staged migration. `hosts/`, `packs/`,
`legacy/` and `services/` landed in one mechanical pull request
([#429](https://github.com/mrrnbhd/suite-apps/pull/429)) rather than app by app, because two path
conventions alive for weeks cost more than one reviewed diff. It changed paths only — no behaviour,
package name or gate row — and the proof is the gate: it stayed green on the same rows and began
discovering `scripts/*.test.mjs` from the directory in the same change, so a moved test could not
silently stop running.

**R6.2** The rest of the migration stays staged. The order is:

1. **Unify the contract.** `@suite/pack` becomes the one parser; Go imports it; both hosts accept the
   same manifest. Add fixtures and host-fit tests.
2. **Standardize pack source.** Every packable app gets `packs/<app>/pack/` with the same shape. Move
   Budget and Planner first; they already have a pack directory.
3. **Port one legacy app.** Budget is the first witness: signed pack, documents, export/import,
   launch in a window, install/update/remove. Do not port the next app until the first passes.
4. **Retire the old path.** When a legacy app is a pack, remove its Flatpak release lane, keep its
   last artifact, and mark it frozen.
5. **Retire the hub.** Start's Home and Screens manager moved into the host and the rest of the hub
   was removed (#314); there is one install path, the host catalogue, not two.

## 7. Non-goals

- No second package manager, build system or lockfile.
- No app-private package under root `packages/` unless a second app consumes it.
- No pack source outside `packs/<app>/pack/` and no hand-edited built manifest.
- No second widget descriptor or a Go-only manifest.
- No long-lived feature or channel branches; channels are artifacts.
- No generated file committed as if it were authored.
