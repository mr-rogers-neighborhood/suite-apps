# Suite docs reader

A local reader over the repository. **This is a development tool**, not a shipped app: it is
excluded from the root build and release, has no deployment and no telemetry.

The reader is **not organized by Diátaxis**. Its structure is the explorer: Browser, Modules and
Tours over one generated index of every file and declaration. Reference facts are derived; module MDX
and tours are the authored layer.

`/docs` is the older notes archive. It stays readable, but it is not the primary interface.

## Commands

From the repository root:

```sh
mise exec -- pnpm docs:index     # build tools/docs/public/data
mise exec -- pnpm docs:index:check # validate notes, tours and generated data
mise exec -- pnpm docs:coverage  # report authored coverage; never fails on a gap
mise exec -- pnpm docs:explain <node-id> # scaffold one note section in its module MDX
mise exec -- pnpm docs:dev       # index, sync and start the dev server (foreground)
mise exec -- pnpm docs:dev:bg    # the same, detached; log in .dev/docs.log
mise exec -- pnpm docs:status    # TCP check on the docs port
mise exec -- pnpm docs:logs      # follow the background dev log
mise exec -- pnpm docs:stop      # stop whatever listens on the docs port
mise exec -- pnpm docs:build     # index, sync and build the static pages
mise exec -- pnpm docs:start     # serve the last build
mise exec -- pnpm docs:clean     # remove .next, .generated, .source and public/data
```

Open <http://localhost:3001/explore>. `docs:start` needs a preceding `docs:build`.

From this directory: `pnpm index`, `pnpm dev`, `pnpm build`, `pnpm start`, `pnpm stop`,
`pnpm status`, `pnpm logs`, `pnpm clean`.

## The explorer

One index, three views:

| View        | Sidebar                                                                                | Detail                                                        |
| ----------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Browser** | Filesystem tree with module markers. Config files sit under a synthetic `config` root. | File or symbol, with code, notes and relations.               |
| **Modules** | Semantic module list with coverage counts.                                             | Module narrative, file map and child modules.                 |
| **Tours**   | Tours and their ordered steps, with interlude chapters.                                | The intro, an interlude, or the current step’s note and code. |

`Start here` is a curated tour; `Full descent` is generated over every node. The selected node is the
anchor when switching views.

A tour opens on its intro. Interludes are chapters and break up the code stops; an overlay is a
dismissible commentary card docked over the detail pane. A step advances manually with `←`/`→` (or
`j`/`k`); **Play** auto-advances one step every six seconds and pauses at an interlude or overlay.
`Esc` dismisses the overlay, then pauses Play. From a symbol, `⌘↑`/`Ctrl+↑` climbs to its file and then
its module; `⌘↓`/`Ctrl+↓` descends again. The breadcrumb does the same thing with the pointer.

A file or symbol that appears in a curated or composed tour shows a **Tours** section with a link to
the step, and the Browser tree marks it with a route icon.

The navigator is resizable: drag the divider, or focus it and use `←`/`→` (`Shift` for a larger
step). Below 260px the Browser / Modules / Tours tabs collapse to icons; double-click the divider to
return to the default width. The width is stored in `localStorage`.

## What is where

| Path                                | Purpose                                                                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `scripts/index-code.mjs`            | TypeScript compiler index: files, declarations, imports, tests, modules. Writes `public/data/`.                              |
| `public/data/`                      | Generated `tree.json`, `search.json`, `modules.json`, `modules/*.json`, `tours.json`, `tour-membership.json`. Not committed. |
| `components/explorer/`              | The three-mode shell, tree, detail pane, search and code view.                                                               |
| `app/explore/page.tsx`              | The explorer route.                                                                                                          |
| `scripts/sync-docs.mjs`             | Mirrors `docs/` into `.generated/docs/` for Fumadocs.                                                                        |
| `app/docs/`                         | Reference pages generated from `docs/`.                                                                                      |
| `docs/modules/*.mdx`                | One authored narrative per module, with `## <node-id>` notes.                                                                |
| `docs/tours/*.mdx`                  | Linear tours; headings are node IDs, the preamble is the intro.                                                              |
| `docs/tours/*.tour.mjs`             | Composed tours that cross modules, files, symbols, tours or docs.                                                            |
| `app/llms.txt`, `app/llms-full.txt` | Agent-readable reference exports.                                                                                            |

## Index rules

- Every file in the indexed extensions becomes a file node.
- Every declaration becomes a symbol node: functions, classes, methods, consts, types, interfaces,
  enums. `export` nodes are visible; `internal` and `private` nodes are collapsed.
- Node IDs are stable: `path#Name`, `path#Class.method`, overloads with `~2`.
- Modules are package roots plus direct children of `src/`, with `docs/modules.json` able to add or
  split. Files without a natural module join a `config:*` virtual module.
- Imports resolve relative files and `.js` specifiers back to `.ts`. Test files mark the files they
  import.
- `docs:index:check` resolves every note heading, tour step and composed-tour target, and compares the
  generated files with the ones on disk. A stale index or an unknown ID fails the check; a normal
  `docs:index` reports the same problems as warnings and rewrites the data. It also checks intros,
  interludes and overlays.

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
the section already exists. `pnpm docs:coverage` reports narrative, file, symbol and tour coverage
plus the largest modules with no authored prose. Neither command gates a change; the tour and note
review does.

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
    {
      kind: "node",
      target: { kind: "symbol", id: "…/appManifest.ts#suiteAppManifestSchema" },
      overlay: { title: "Why the manifest has no binary", body: "…" },
    },
    { kind: "node", target: { kind: "tour", id: "start", step: 0 } },
    { kind: "node", target: { kind: "symbol", id: "apps/canvas/src/App.tsx#App", level: "file" } },
    { kind: "node", target: { kind: "doc", path: "docs/reference/decisions.md" } },
  ],
};
```

A target is `node`, `module`, `file`, `symbol`, `tour` or `doc`. `symbol` with `level: "file"` opens
the containing file with the declaration highlighted. The index resolves every target;
`docs:index:check` fails on an unknown one. A tour step points at content and never restates it.

The intro's “What it covers” is generated from the node steps and grouped by interlude chapters. Do
not hand-write an outline or a “What this does not do” section.

## Constraints

- Do not edit `.generated/` or `public/data/`; run `pnpm docs:index` or `pnpm docs:dev`.
- Do not add one MDX per file. One module narrative, many nodes.
- Do not generate prose for every symbol. Use compiler facts plus authored notes.
- Do not add `tools/docs` to `pnpm build`, the release path, or a shipped package.
- The code index is data, not truth: the code and the authored MDX win.

## Pins

| Package               | Version                         |
| --------------------- | ------------------------------- |
| `next`                | 16.4.6                          |
| `fumadocs-core`       | 16.19.5                         |
| `fumadocs-mdx`        | 15.6.4                          |
| `fumadocs-ui`         | `npm:@fumadocs/base-ui@16.19.5` |
| `react` / `react-dom` | 19.2.0                          |
| `ts-morph`            | 28.0.0                          |
| `typescript`          | 7.0.2                           |

Tracked by the docs epic #97.
