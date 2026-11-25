# Pack authoring

How to lay out a pack source directory and prove it. The rule is
[repo-structure.md R2.2](../spec/repo-structure.md#2-packs); this page is the working reference the
pack READMEs link, not a second copy of the clause. The manifest itself is
[S3.5–S3.7](../spec/superapp.md#3-pack-format-canonical-bytes-and-manifest) and
[manifest.schema.json](../spec/manifest.schema.json).

A pack is source under `packs/<app>/pack/`. It is not a workspace package, so nothing is installed or
built into it; the build writes to a generated directory outside it.

## What the directory holds

| Path | What it is |
| --- | --- |
| `manifest.json` | The source manifest. `version` equals the app's `package.json` version. The build adds `format`, `publisher`, `files` and `signature`. |
| `src/` | The pack entry and its prelude. Renderer-only: no Electron, no Node. |
| `vite.config.ts` | The one build config, named the same in every app. |
| `*.test.*` | At least one test, run by the app's `test:pack` script. |
| `README.md` | Points at this page and names the app's build command. |

Anything else is allowed. `dist/`, `node_modules/` and other generated directories are not: the
before-commit tree is the pack's source, and a generated directory there means the build or the
install wrote into it.

## Declare the pack

The app's `package.json` carries the declaration, which is how the checker knows the app is a pack
and not an app that still ships its old artifact:

```json
"suite": { "pack": true }
```

The convention lands before the other apps convert, so an undeclared `pack/` is reported as skipped
rather than failed. Declaring it is the step that opts into the rule.

## Manifest rules

- The source manifest names only fields the host implements. An unknown field or capability fails
  the checker instead of failing at install (S3.7); the checker reads
  [manifest.schema.json](../spec/manifest.schema.json), so a new schema field needs no checker edit.
- Do not hand-write `files`, `publisher` or `signature`. The pack build generates them from the
  output directory (R2.3).
- The source manifest may omit the generated fields. Required fields are the built manifest's
  business, not the source's.

## Build and test

The app's own scripts own the commands; there is no shared pack build entry point. Budget, Planner,
Canvas and Help are the worked examples:

```sh
mise exec -- pnpm --dir legacy/budget run test:pack
mise exec -- pnpm --dir legacy/budget run typecheck:all
mise exec -- pnpm budget:pack

mise exec -- pnpm --dir legacy/planner run test:pack
mise exec -- pnpm --dir legacy/planner run typecheck:all
mise exec -- pnpm planner:pack

mise exec -- pnpm --dir legacy/canvas run test:pack
mise exec -- pnpm --dir legacy/canvas run typecheck:all
mise exec -- pnpm canvas:pack

mise exec -- pnpm --dir legacy/help run test:pack
mise exec -- pnpm --dir legacy/help run typecheck:all
mise exec -- pnpm help:pack
```

All four build to `legacy/<app>/.dev/pack` and sign the archive from there. The output path is the
app's, under a generated directory the root `.gitignore` already covers; never point it back into
`pack/`. A build also writes `<id>-<version>.card.json` beside `<id>-<version>.suitepack` for the
catalogue's shadow tiles; [Packaging channels](packaging-channels.md#packs-and-cards) owns that
sidecar's name, format and URL.

Canvas is the largest conversion and the first with a document format that already had an export
envelope of its own: the pack payload is that `.canvas` envelope, so the host carries the snapshot,
manifest and embedded images unchanged and a re-import returns the same content.

Help also carries generated content, so its build has a second proof:

```sh
mise exec -- pnpm help:pack --check-repro
```

It builds twice into generated directories and compares every payload path and SHA-256, with no
signing key. A pack whose bytes come from generated content must not change hash without a source
change; a mismatch fails the command and names the paths.

The app's `test:pack` script runs the pack tests from the app directory, with the pack's config and
an explicit `root`. That is what keeps `node_modules` out of `pack/` while the tests still import
the app's Vitest and jsdom.

## Check it

```sh
mise exec -- node scripts/pack-shape.mjs
```

It runs in the gate's `scripts` row. It fails a declared pack that is missing a required file, has
no test, carries a generated directory, whose manifest version differs from the app version, or
whose manifest names a field or capability the schema does not define. When the convention changes,
the required minimum changes in `scripts/pack-shape.mjs` and R2.2 explains it; no app is exempt
because it is older.
