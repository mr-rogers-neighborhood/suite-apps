# Suite docs reader

A local reader over the repository. **This is a development tool**, not a shipped app: it is
excluded from the root build and release, has no deployment and no telemetry.

The reader is **not organized by Diátaxis**. Its structure is the explorer: Browser, Modules and
Walkthroughs over one generated index of every file and declaration. Reference facts are derived;
module MDX and walks are the authored layer.

`/docs` is the older notes archive. It stays readable, but it is not the primary interface.

## Commands

From the repository root:

```sh
mise exec -- pnpm docs:index     # build tools/docs/public/data
mise exec -- pnpm docs:index:check # validate notes, walks, tours and generated data
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

| View             | Sidebar                                                                                | Detail                                          |
| ---------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Browser**      | Filesystem tree with module markers. Config files sit under a synthetic `config` root. | File or symbol, with code, notes and relations. |
| **Modules**      | Semantic module list with coverage counts.                                             | Module narrative, file map and child modules.   |
| **Walkthroughs** | Walks and their ordered steps.                                                         | The current step’s note and code.               |

`Start here` is a curated walk; `Full descent` is generated over every node. The selected node is
the anchor when switching views.

## What is where

| Path                                | Purpose                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `scripts/index-code.mjs`            | TypeScript compiler index: files, declarations, imports, tests, modules. Writes `public/data/`.                    |
| `public/data/`                      | Generated `tree.json`, `search.json`, `modules.json`, `modules/*.json`, `walks.json`, `tours.json`. Not committed. |
| `components/explorer/`              | The three-mode shell, tree, detail pane, search and code view.                                                     |
| `app/explore/page.tsx`              | The explorer route.                                                                                                |
| `scripts/sync-docs.mjs`             | Mirrors `docs/` into `.generated/docs/` for Fumadocs.                                                              |
| `app/docs/`                         | Reference pages generated from `docs/`.                                                                            |
| `docs/modules/*.mdx`                | One authored narrative per module, with `## <node-id>` notes.                                                      |
| `docs/walkthroughs/*.mdx`           | Curated ordered paths; headings are node IDs.                                                                      |
| `docs/walkthroughs/*.tour.mjs`      | Composed tours that cross modules, files, symbols, walks or docs. Normal walks need no file.                       |
| `app/llms.txt`, `app/llms-full.txt` | Agent-readable reference exports.                                                                                  |

## Index rules

- Every file in the indexed extensions becomes a file node.
- Every declaration becomes a symbol node: functions, classes, methods, consts, types, interfaces,
  enums. `export` nodes are visible; `internal` and `private` nodes are collapsed.
- Node IDs are stable: `path#Name`, `path#Class.method`, overloads with `~2`.
- Modules are package roots plus direct children of `src/`, with `docs/modules.json` able to add or
  split. Files without a natural module join a `config:*` virtual module.
- Imports resolve relative files and `.js` specifiers back to `.ts`. Test files mark the files they
  import.
- `docs:index:check` resolves every note heading, walk step and tour target, and compares the
  generated files with the ones on disk. A stale index or an unknown ID fails the check; a normal
  `docs:index` reports the same problems as warnings and rewrites the data.

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

A walkthrough is an MDX file whose headings are node IDs in step order:

```mdx
---
id: start
title: Start here
start: true
---

## packages/contracts/src/appManifest.ts#suiteAppManifestSchema

Why this is the first stop.
```

`Full descent` is generated from the index; it is not a file.

### Composed tours

A normal walk is already a tour: the runner plays its steps in order. Add a
`docs/walkthroughs/<id>.tour.mjs` only when the path crosses targets or needs a
callout that is not prose in a walk. It is data, not a second authoring format:

```js
export default {
  id: "suite-in-one-sitting",
  title: "The suite in one sitting",
  order: 50,
  steps: [
    { target: { kind: "module", id: "packages/contracts" }, callout: "…" },
    { target: { kind: "file", id: "packages/contracts/src/appManifest.ts" } },
    { target: { kind: "symbol", id: "…/appManifest.ts#suiteAppManifestSchema" } },
    { target: { kind: "walk", id: "start", step: 0 } },
    { target: { kind: "symbol", id: "apps/canvas/src/App.tsx#App", level: "file" } },
    { target: { kind: "doc", path: "docs/reference/decisions.md" } },
  ],
};
```

A target is `module`, `file`, `symbol`, `walk` or `doc`. `symbol` with
`level: "file"` opens the containing file with the declaration highlighted. The
index resolves every target; `docs:index:check` fails on an unknown one. A tour
step points at content and never restates it.

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
