# Repository and pack structure specification

Status: draft 0.1. Target layout and ownership. The product contract is [superapp.md](superapp.md);
the pipeline is [ci.md](ci.md); the delivery contract is [delivery.md](delivery.md).

## 1. Shape

**R1.1** One pnpm workspace. The root lockfile is the only lockfile. Shared packages are
`workspace:*`; no git-tag pins, no `link:` paths, no second package manager.

**R1.2** An app owns its source, tests, docs and pack source under `apps/<app>/`. A shared package
lives under `packages/` only when two or more apps consume it. An app's private packages stay under
`apps/<app>/packages/`.

**R1.3** The desktop host is `apps/shell` (`@suite/shell`), and it is the way in: it reads a verified
index, installs packs and opens them. It is the only desktop install path. The legacy Start hub was
retired in [#314](https://github.com/mrrnbhd/suite-apps/issues/314); its catalogue and Home moved
here, and a frozen Flatpak keeps its documented `flatpak install` line. Go is the mobile host. The
relay is `apps/sync`, with its app and server packages beside it.

**R1.4** Flatpak manifests live in `packaging/flatpak/`. The spec lives in `docs/spec/`. An app's
own docs stay in `apps/<app>/docs/`.

## 2. Packs

**R2.1** One pack format for desktop and mobile. `@suite/pack` owns the manifest, canonical bytes,
signature, capabilities and host fit. `@suite/pack-host` owns the archive reader/writer and scoped
store. Go consumes the same parser and verifier; `apps/go/packages/go/src/pack.ts` retires rather
than keeping a second manifest. This closes #202.

**R2.2** A packable app declares itself with `"suite": { "pack": true }` in its `package.json` and
keeps its pack source in `apps/<app>/pack/`. The directory MUST contain `manifest.json` (the source
manifest, whose `version` equals the app version), `src/` with the pack entry and its prelude, one
`vite.config.ts` build config, at least one `*.test.*` run by the app's `test:pack` script, and a
`README.md` that links [the pack authoring reference](../reference/pack-authoring.md). A pack is
source, not a workspace package: no `node_modules/`, `dist/` or other generated directory may live
under `pack/`, and the build writes its artifact to a generated output directory outside it. Extra
files are permitted. `node scripts/pack-shape.mjs` enforces this minimum in the gate; the authoring
reference explains each item.

**R2.3** The pack version is the app version or an explicit pack version in one file; it is not
restated in prose. The manifest's file list and signature are generated from the build output, not
hand-edited.

**R2.4** A pack declares its documents, blobs, sync scopes, capabilities, widgets, components,
locales, export entry and add-ons in the manifest. A field a host does not implement is a refusal,
not a silent skip. [manifest.schema.json](manifest.schema.json) is the field list and the closed
capability vocabulary; a checker reads it rather than repeating it.

**R2.5** Legacy Canvas, Planner, Budget and Help stay frozen at their last Flatpak artifact until
each becomes a pack. A frozen app is not deleted; its code, docs and last artifact stay.

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

**R4.1** The superapp is `shell` and `go`. A pack is per app. A legacy Flatpak is frozen. A channel
belongs to the superapp; a pack carries a version.

**R4.2** The app's `package.json` owns the app version; the Android Gradle file owns the Android
version; the pack manifest owns the pack version. Cross-references link the file, never restate the
number.

**R4.3** A release tag names one app's release (`canvas-v0.1.12`) or the rolling suite
(`suite-YYYY.MM.DD`). A channel is a branch/artifact identity, not a tag namespace.

## 5. Concurrent agents

**R5.1** One task per branch/worktree. A branch is short-lived and names the issue or clause it
serves. A PR is small enough to review in one sitting; split a change that touches several apps.

**R5.2** Hotspot files are `package.json`, `pnpm-lock.yaml`, `scripts/gate.mjs`,
`.github/workflows/*`, `docs/spec/README.md` and the shared contracts. A change that touches one is
small and calls it out; a lockfile-only change is a dedicated chore PR where possible.

**R5.3** An agent runs the owning app's `--only` gate before pushing. It does not run the full e2e
unless the task needs it. The merge queue and nightly own the full proof.

**R5.4** Generated files (`.dev/`, build output, docs index, gate status) are not committed. A
generated page is refreshed by its script, not hand-edited.

**R5.5** A review-only agent comments or requests changes; it never merges. The coordinator runs the
merge queue; it is the last check.

## 6. Migration

Do not big-bang move the tree. The order is:

1. **Unify the contract.** `@suite/pack` becomes the one parser; Go imports it; both hosts accept the
   same manifest. Add fixtures and host-fit tests.
2. **Standardize pack source.** Every packable app gets `apps/<app>/pack/` with the same shape. Move
   Budget and Planner first; they already have a pack directory.
3. **Port one legacy app.** Budget is the first witness: signed pack, documents, export/import,
   launch in a window, install/update/remove. Do not port the next app until the first passes.
4. **Retire the old path.** When a legacy app is a pack, remove its Flatpak release lane, keep its
   last artifact, and mark it frozen.
5. **Retire the hub.** Start's Home and Screens manager moved into the shell and the rest of the hub
   was removed (#314); there is one install path, the shell catalogue, not two.

## 7. Non-goals

- No second package manager, build system or lockfile.
- No app-private package under root `packages/` unless a second app consumes it.
- No pack source outside `apps/<app>/pack/` and no hand-edited built manifest.
- No second widget descriptor or a Go-only manifest.
- No long-lived feature or channel branches; channels are artifacts.
- No generated file committed as if it were authored.
