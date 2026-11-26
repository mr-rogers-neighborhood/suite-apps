---
audience: developer
---

# Pack readiness

Every pack makes one claim: it builds, installs, launches and does its primary job. This page records
the headless half of that claim and the part a person still has to do. The source layout and the
shape check are [Pack authoring](pack-authoring.md); the window proof for the frozen Electron
shells is [Desktop proof](desktop-proof.md).

```sh
mise exec -- node scripts/pack-readiness.mjs
```

It is on-demand, like `proof-of-changes`, not a gate row: it builds all four packs, compiles the
host, installs each archive and runs each pack's tests. `--no-build` reuses the archives a previous
run wrote; `--json` prints the structured result. The command writes
`.dev/pack-readiness/summary.json` and its per-app test reports under `.dev/pack-readiness/tests/`.

## What one run proves

1. **The signed artifact.** The app's own builder writes
   `packs/<app>/.dev/<id>-<version>.suitepack` and its `.sha256` sidecar. The command reads the
   archive, checks the sidecar digest, verifies the Ed25519 signature against
   `SUITE_PACK_PUBLIC_KEY`, verifies every payload hash, and checks the entry's launch metadata: a
   CSP that names `default-src 'self'` and `connect-src 'self'`, and a module script.
2. **Installability.** It installs the archive through `hosts/desk/src/installedPacks.ts` into a
   temporary Desk data root, checks `<root>/<id>/<version>/`, the installed manifest, every file hash,
   the installed capabilities and contributions, then removes the version and scans the root again.
3. **The primary path.** It runs the pack's own suite that mounts the pack the way the host does:
   Budget, Planner and Canvas open/create, edit, save, export and re-import; Help opens the explorer,
   searches the handbook and renders an article.
4. **The phone smoke.** It runs the pack's phone-layout tests. Those are jsdom tests: they prove the
   layout and the named controls, not a 44px measurement or a TalkBack pass on a device.

A clean root after removal means no pack version and no failed scan; the host keeps
`<root>/<id>/publisher.json` as the identity record, which is by design and is ignored when the id
has no versions.

## The matrix

The command prints one row per app. A run looks like this; `<version>` is whatever the source
manifest currently says, so the manifest stays the one home for the number.

```text
| App | Version | Capabilities | Contributions | Files | Signature | Shape | Launch | Install/remove | Primary path | Phone smoke |
| budget | <version> | documents, files | none | 6 | ok | ok | ok | ok | ok (1 file, 1/1 tests) | ok (1 file, 6/6 tests) |
| planner | <version> | documents, files, notifications, recents, relay?, commands? | commands:3, providers:2 | 18 | ok | ok | ok | ok | ok (1 file, 1/1 tests) | ok (5 files, 55/55 tests) |
| canvas | <version> | documents, files, recents, relay? | none | 465 | ok | ok | ok | ok | ok (1 file, 1/1 tests) | absent (#387) |
| help | <version> | none | none | 547 | ok | ok | ok | ok | ok (2 files, 8/8 tests) | ok (1 file, 2/2 tests) |
```

The file counts are build facts and change with the source. They are here to show that an archive
carries its whole payload, not only an entry page.

## Per app

### Budget

| Fact | Evidence |
| --- | --- |
| Artifact | `packs/budget/.dev/budget-<version>.suitepack`, built by `pnpm budget:pack`; version from [its manifest](../../packs/budget/pack/manifest.json) |
| Signature | `SUITE_PACK_PUBLIC_KEY`, `.sha256` sidecar and every payload hash; entry CSP and module script |
| Install/remove | Desk's verified path; installed tree, manifest and hashes checked; removal leaves no version and a clean scan |
| Primary path | [`packs/budget/pack/src/PackRender.test.tsx`](../../packs/budget/pack/src/PackRender.test.tsx): a budget opens through the launcher, an edit is flushed, the export is a `.budget` file and the re-import carries the edit |
| Export/import | The pack writes the host picker's `.budget` file and re-imports it as a second document |
| Phone smoke | [`packs/budget/pack/src/renderer/app/Shell.test.tsx`](../../packs/budget/pack/src/renderer/app/Shell.test.tsx): the phone bar changes views and opens the tools sheet |
| Intentionally absent | No network or sync; `reveal` is a notice; no commands, notifications or recents capability |
| #358 still owns | Install the release archive into a real Desk root, launch it, create and assign a category, enter a transaction, export and re-import it, and do the 44px/TalkBack pass on a phone |

### Planner

| Fact | Evidence |
| --- | --- |
| Artifact | `packs/planner/.dev/planner-<version>.suitepack`, built by `pnpm planner:pack`; version from [its manifest](../../packs/planner/pack/manifest.json) |
| Signature | `SUITE_PACK_PUBLIC_KEY`, `.sha256` sidecar and every payload hash; entry CSP and module script |
| Install/remove | Desk's verified path; the installed view carries the optional `relay` and `commands` capabilities and the command/scope providers |
| Primary path | [`packs/planner/pack/src/PackRender.test.tsx`](../../packs/planner/pack/src/PackRender.test.tsx): the pack boots from the host, writes a task and a day page, then re-imports its own export |
| Export/import | The pack writes a `.planner` workspace file and re-imports the same content |
| Phone smoke | `Shell`, `DayView`, `InboxView`, `TaskDetail` and `WeekView` tests under [`packs/planner/pack/src/renderer/`](../../packs/planner/pack/src/renderer/): drawer, thumb targets and controls that stay visible at phone width |
| Intentionally absent | Sync is still a host gap on mobile, so the pack's sync stays in the frozen desktop app; `relay` and `commands` are optional, so a host without them still installs |
| #358 still owns | Install the release archive, launch it, capture and edit a task, open the Command Surface, export and re-import, accept or deny a reminder, and do the 44px/TalkBack pass |

### Canvas

| Fact | Evidence |
| --- | --- |
| Artifact | `packs/canvas/.dev/canvas-<version>.suitepack`, built by `pnpm canvas:pack`; version from [its manifest](../../packs/canvas/pack/manifest.json) |
| Signature | `SUITE_PACK_PUBLIC_KEY`, `.sha256` sidecar and every payload hash; entry CSP and module script |
| Install/remove | Desk's verified path; the installed view keeps the optional `relay` capability |
| Primary path | [`packs/canvas/pack/src/PackRender.test.tsx`](../../packs/canvas/pack/src/PackRender.test.tsx): a board opens from the host envelope, an edit reaches the document, the `.canvas` export re-imports with the same card |
| Export/import | The whole canvas export envelope, images included, crosses the host unchanged |
| Phone smoke | Absent. Mobile layout is Canvas's own job (#387); only the manifest's `mobile` declaration is tested today |
| Intentionally absent | No relay service, so collaboration is unavailable in the pack; `relay` is optional and the pack shows the local-only state |
| #358 still owns | Install the release archive, launch it, create a board and card, add an image, export and re-import, and test a real phone once #387 lands |

### Help

| Fact | Evidence |
| --- | --- |
| Artifact | `packs/help/.dev/help-<version>.suitepack`, built by `pnpm help:pack`; version from [its manifest](../../packs/help/pack/manifest.json) |
| Signature | `SUITE_PACK_PUBLIC_KEY`, `.sha256` sidecar and every payload hash; entry CSP and module script |
| Install/remove | Desk's verified path; the archive carries the generated index and compiled handbook pages |
| Primary path | [`PackExplorer.test.tsx`](../../packs/help/pack/src/PackExplorer.test.tsx) and [`Handbook.test.tsx`](../../packs/help/pack/src/Handbook.test.tsx): the explorer renders from the bundled data, searches the handbook and renders an article |
| Export/import | Not applicable: Help is read-only and has no document or export path |
| Phone smoke | [`PhoneLayout.test.tsx`](../../packs/help/pack/src/PhoneLayout.test.tsx): the navigator opens as a drawer at phone width and closes without leaving the document |
| Intentionally absent | No capabilities, no document, no editing and no network |
| #358 still owns | Install the release archive, launch it, search a symbol, cross to the handbook and read a page offline, then do the drawer/TalkBack pass on a phone |

## The `@proof` matrix

The desktop proof runner covers the frozen Electron shells, not the installed pack entry. On a host
with no display, the documented fallback launches Electron with `--ozone-platform=headless` and does
not open a window. The shell builds are required; `--no-build` only works after a build.

| Row | Result | Why |
| --- | --- | --- |
| `desk` | passed | Opens Home, creates a Focus Screen and switches to it |
| `budget` | passed | Creates a budget, assigns $100 to Rent / Mortgage and updates the sheet |
| `planner` | passed | Opens a planner document, captures a task and shows it on the day plan |
| `canvas` | passed | Creates a `.canvas` document, adds a card and renders it |
| `help` | failed | The frozen shell's spec starts at the explorer, but the shared renderer now opens the user handbook at `/`; the pack's own explorer and handbook tests pass. The shell proof is stale, not the pack |

The pass rows prove the shared renderer source in a real Electron process. They do not prove the
installed archive: only the pack's own suite and a person's window pass do that.

## What only #358 can prove

- A release archive installed from the signed catalogue or a `.suitepack` file into a real Desk data
  root, with the host's trust prompt.
- Each pack launched in a real window, not only mounted in jsdom.
- A real phone: 44px targets, TalkBack reading order, and the absence of hover-only controls.
- Canvas's mobile layout, which does not exist yet (#387).
- Help's manual handbook read and the stale shell proof above.
