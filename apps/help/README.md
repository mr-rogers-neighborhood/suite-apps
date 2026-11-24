# Suite Help

The documentation reader, shipped as a local-first desktop app. It is one Vite + React renderer
inside an Electron shell, and it works with no checkout, no network and no account.

**Explorer.** Browser, Modules and Tours over one generated index of every file and declaration.
Reference facts are derived; module MDX and tours are the prose layer. Prose is **authored** only
after a person reviews or rewrites it and adds `reviewed: human` to the module or tour frontmatter.
Until then it is generated, whether a person or an agent wrote it.

**Handbook.** The notes archive under `docs/` rendered with the Fumadocs look. The source paths stay
where they are; the app labels the section _Handbook_. A link between two pages is rewritten to its
`/handbook/...` route, so it keeps the reader in the app; a link that leaves `docs/` opens GitHub.

## Commands

From the repository root:

```sh
mise exec -- pnpm docs:index        # build apps/help/public/data
mise exec -- pnpm docs:index:check  # validate notes, tours and generated data
mise exec -- pnpm docs:coverage     # authored vs generated prose; never fails on a gap
mise exec -- pnpm docs:explain <node-id> # scaffold one note section in its module MDX
mise exec -- pnpm docs:build        # index, sync docs/ and build the app
mise exec -- pnpm docs:dev          # index, sync and start Vite + Electron (foreground)
mise exec -- pnpm docs:clean        # remove out, release, .generated and public/data
mise exec -- pnpm help:pack         # build and sign Help's pack from the same content
```

From this directory: `pnpm index`, `pnpm sync`, `pnpm dev`, `pnpm build`, `pnpm test`,
`pnpm test:pack`, `pnpm typecheck`, `pnpm package:dir`.

## The pack

`pack/` is Help's pack source: the same renderer and handbook built into a signed archive for the
Suite host. It runs under `HashRouter` rather than the desktop app's `BrowserRouter`, because the
host serves one entry file and answers only files that exist. The archive carries the generated
`public/data` index and the compiled MDX pages, so the explorer and handbook work with no checkout.

The pack's `capabilities` list is empty by decision, not by omission: it reads only its own bundle
and asks the host for nothing. See [the pack source](pack/README.md) for the generated corpus and the
two-build reproducibility check.

## What is where

| Path                                 | Purpose                                                                                                                                              |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/`                          | Electron main: window policy and the `suite-help://app/` protocol.                                                                                   |
| `src/preload/`                       | The one `contextBridge` fact the renderer reads.                                                                                                     |
| `src/renderer/src/explorer/`         | The three-mode explorer, tree, detail pane, search and code view.                                                                                    |
| `src/renderer/src/handbook/`         | The handbook layout, page tree, contents and MDX components.                                                                                         |
| `src/renderer/src/lib/source.ts`     | Fumadocs headless source: the generated docs tree and MDX bodies.                                                                                    |
| `src/renderer/src/theme.ts`          | `@suite/theme` preset and mode resolution, the `suite.theme` store, and the `data-theme-mode` attributes Fumadocs and Shiki follow.                  |
| `src/renderer/src/theme-control.tsx` | The preset and brightness selects in both navigator footers.                                                                                         |
| `scripts/index-code.mjs`             | TypeScript compiler index: files, declarations, imports, tests, modules.                                                                             |
| `scripts/sync-docs.mjs`              | Mirrors `docs/` into `.generated/docs/` and writes the offline search index.                                                                         |
| `public/data/`                       | Generated `tree.json`, `search.json`, `modules.json`, `modules/*.json`, `tours.json`, `tour-membership.json`, `handbook-search.json`. Not committed. |
| `.generated/docs/`                   | Generated handbook content for the Fumadocs source. Not committed.                                                                                   |

Nothing under `public/data/` or `.generated/docs/` is edited by hand: `docs:index` and `docs:build`
write them from the code and `docs/`.

## The window

Production is served through a custom protocol, `suite-help://app/`, registered in the main process.
A route with no file of its own receives `index.html`, so the React Router SPA works offline; a
missing asset is still a 404. The renderer is sandboxed: `contextIsolation`, `sandbox`, no
`nodeIntegration`, and a content-security policy from `@suite/desktop`.

Development runs the same shell around Vite. `pnpm dev` starts both; do not run it in a headless
gate.

## Theme and mark

Help paints `@suite/theme`, not a palette of its own. The footer of both navigators offers a **Theme**
preset and a **Brightness** mode: **System**, **Light** or **Dark**. The choice is stored per device
in `localStorage` under `suite.theme`; a record with only an old mode string still reads, and a preset
this build does not ship falls back to the default.

The preset paints the suite's role variables. `styles.css` points the Fumadocs `--color-fd-*` names at
those roles, so the handbook and the explorer share one palette, and Shiki asks for `github-light` or
`github-dark` from the resolved mode rather than a fixed theme.

The window icon, the `electron-builder` icon, the Flatpak icons and the Help card in Start all use the
same headset on the ink tile. The card mark is white on the hub's ink and a light theme inverts the
tile and glyph together; the packaged icon is the same artwork.

## Index rules

- Every file in the indexed extensions becomes a file node.
- Every declaration becomes a symbol node: functions, classes, methods, consts, types, interfaces,
  enums. `export` nodes are visible; `internal` and `private` nodes are collapsed.
- Node IDs are stable: `path#Name`, `path#Class.method`, overloads with `~2`.
- Modules are package roots plus direct children of `src/`, with `docs/modules.json` able to add or
  split. Files without a natural module join a `config:*` virtual module.
- Imports resolve relative files and `.js` specifiers back to `.ts`. Test files mark the files they
  import.
- `docs:index:check` resolves every note heading, tour step and composed-tour target, and compares
  the generated files with the ones on disk. A stale index, an unknown ID or a note repeated in two
  module MDX files fails the check; a normal `docs:index` reports the same problems as warnings and
  rewrites the data. It also checks intros, interludes and overlays.

## Authoring

One MDX per module, not per file:

```mdx
---
module: packages/contracts
title: Contracts
summary: "The manifests and capabilities that cross an app boundary."
---

A short narrative.

## packages/contracts/src/appManifest.ts#suiteAppManifestSchema

The why, the invariant, and what breaks if it changes.
```

The index parses the `##` headings, merges each note into its node, and warns when a heading names an
unknown node. A module without an MDX still renders generated facts. Notes are optional; generated
facts are honest and never invent prose.

`pnpm docs:explain <node-id>` adds a section with the generated signature and a TODO, and refuses if
the section already exists. `pnpm docs:coverage` reports how many modules and tours a person has
reviewed, alongside the generated prose, file and symbol counts, plus the largest modules with no
prose. Neither command gates a change; the tour and note review does.

A module or tour becomes authored when its frontmatter carries `reviewed: human`. That is a claim a
person makes after reading and rewriting the prose, not a marker an agent may add. Remove it if a
later edit leaves the prose unreviewed.

A linear tour is an MDX file. The preamble is the intro; headings are node IDs or interlude chapters:

```mdx
---
id: start
title: Start here
start: true
---

What this tour is about: the shortest path from the shared contract to a document.

## packages/contracts/src/appManifest.ts#suiteAppManifestSchema

Why this is the first stop.

## interlude: The handoff

The next three stops cross from Start to the desktop shell.

### overlay: Why the manifest has no binary

A manifest says what an app is; the install record owns the executable.
```

`Full descent` is generated from the index; it is not a file.

### Composed tours

A linear tour already covers most paths. Add a `docs/tours/<id>.tour.mjs` only when the path crosses
targets or needs an overlay that is not prose in a tour. It is data, not a second authoring format:

```js
export default {
  id: "suite-in-one-sitting",
  title: "The suite in one sitting",
  intro: "What this tour is about: one seam at four altitudes.",
  order: 50,
  steps: [
    { kind: "interlude", title: "Start at the boundary", body: "…" },
    { kind: "node", target: { kind: "module", id: "packages/contracts" }, note: "…" },
    { kind: "node", target: { kind: "file", id: "packages/contracts/src/appManifest.ts" } },
    { kind: "node", target: { kind: "symbol", id: "…/appManifest.ts#suiteAppManifestSchema" } },
    { kind: "node", target: { kind: "tour", id: "start", step: 0 } },
    { kind: "node", target: { kind: "doc", path: "docs/reference/decisions.md" } },
  ],
};
```

A target is `node`, `module`, `file`, `symbol`, `tour` or `doc`. `symbol` with `level: "file"` opens
the containing file with the declaration highlighted. The index resolves every target;
`docs:index:check` fails on an unknown one. A tour step points at content and never restates it.

## Constraints

- Do not edit `.generated/` or `public/data/`; run `pnpm docs:index` or `pnpm docs:build`.
- Do not add one MDX per file. One module narrative, many nodes.
- Do not generate prose for every symbol. Use compiler facts plus written notes.
- The code index is data, not truth: the code and the prose MDX win.
- The app is offline. It has no network client; Flatpak owns updates.

## Pins

| Package               | Version |
| --------------------- | ------- |
| `fumadocs-core`       | 16.19.5 |
| `fumadocs-mdx`        | 15.6.4  |
| `react` / `react-dom` | 19.2.0  |
| `react-router`        | 8.5.1   |
| `ts-morph`            | 28.0.0  |
| `typescript`          | 5.9.3   |
