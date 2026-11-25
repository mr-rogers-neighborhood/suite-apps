# `@suite/screens`

The shared Screens contract. It is the shape a host renders and the document it renders
from, with no window, no React, no Electron, no DOM and no file IO. The desktop shell
uses it; Go's launcher reuses the descriptor shape later, not a second contract.

The decision is [Widgets and Screens](../../docs/reference/decisions.md#widgets-and-screens).

```json
{
  "format": "suite.screen",
  "version": 1,
  "id": "home",
  "name": "Home",
  "widgets": [
    { "registryId": "desk.apps", "size": "full" },
    { "registryId": "planner.quick-task", "size": "2x1", "settings": { "project": "inbox" } }
  ]
}
```

`format` is `suite.screen` and `version` is `1`. `id` is a lower kebab-case screen id;
the host chooses the file path and derives nothing from it. `name` is the label a person
sees. `widgets` is ordered. Each entry names its descriptor as `<app id>.<widget id>`,
uses one of the contract's sizes (`1x1`, `2x1`, `full`) and may carry instance
`settings`, a record of strings keyed by the descriptor's settings field id.

The schema is strict. A key such as `entry`, `src`, `html`, `script`, `path`, `document`
or `data` is refused, because a Screen must never become a page builder or a second copy
of app data.

## What the package owns

- `src/screen.ts` — the `suite.screen` v1 schema and `parseScreen`. A newer `version` is
  refused with a sentence and the file is left alone; nothing is guessed at. An unknown
  registry id is a valid entry.
- `src/document.ts` — `ScreenDocument`: create from a Screen, open from a Loro snapshot,
  export a snapshot, and mutate the ordered list (add, remove, move before/after, resize,
  set/clear a setting). The host owns the path, the atomic write and the backup. Every
  unknown widget id and unknown setting survives a mutation and a snapshot.
- `src/registry.ts` — `createWidgetRegistry`: resolve an app's declared `widgets` under
  its id, resolve a host widget the same way (`desk.apps`), apply settings defaults,
  validate settings, and build the capture payload `{ widget, action, values, settings }`.
  An unknown setting stays on the Screen and is reported; it is not sent to an app whose
  descriptor cannot use it.
- `src/fixture.ts` and `src/fixtures/home.screen.json` — one shared composition and the
  code that turns it into a Loro document, so two host renderers use the same fixture.

## What this package does not own

- Rendering. A host draws the widget descriptor with its own components.
- A registry of installed apps. The host decides which descriptors to pass in.
- File IO, backups, atomic writes or a document store.
- A portable `.screen` file or sync. The Screen is a local host document in this slice;
  export, import and sync come later.
- App data. A capture carries strings to the app; the app writes through its own document
  layer.

## Tests

```sh
mise exec -- pnpm --filter @suite/screens test
mise exec -- pnpm --filter @suite/screens typecheck
```
