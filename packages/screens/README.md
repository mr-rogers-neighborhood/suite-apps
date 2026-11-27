# `@suite/screens`

The shared Screens contract. It is the shape a host renders and the document it renders
from, with no window, no React, no Electron, no DOM and no file IO. The desktop shell
uses it; Go's launcher reuses the descriptor shape later, not a second contract.

The decision is [Widgets and Screens](../../docs/reference/decisions.md#widgets-and-screens).

```json
{
  "format": "suite.screen",
  "version": 2,
  "id": "home",
  "name": "Home",
  "widgets": [
    { "registryId": "desk.apps", "size": "full" },
    {
      "kind": "row",
      "size": "full",
      "layout": "row",
      "items": [
        { "registryId": "planner.quick-task", "weight": 2, "settings": { "project": "inbox" } },
        { "registryId": "budget.saved-views", "weight": 1 }
      ]
    }
  ]
}
```

`format` is `suite.screen` and `version` is `3`. `id` is a lower kebab-case screen id;
the host chooses the file path and derives nothing from it. `name` is the label a person
sees. `widgets` is ordered. Each entry is either a widget or a row:

- Every entry carries `x` and `y` on a four-cell-wide grid. `size` is the single source
  of its dimensions: `1x1`, `1x2`, `2x1`, `2x2` or `full` (four cells wide). Coordinates
  say where it starts; `x + width` may not exceed four.
- A widget entry names its descriptor as `<app id>.<widget id>`, uses one of the
  contract's sizes and may carry instance `settings`, a record of
  strings keyed by the descriptor's settings field id.
- A row entry has `kind: "row"`, its own `size`, a `layout` of `row` or `carousel`, and
  2–8 `items`. Each item declares a `weight` (1–12, its share of the row) and optional
  `settings`. A row is one level deep: it cannot contain another row or a Screen.

The placement budget is 64 widgets, rows included, so a Screen stays bounded on every
host. The schema is strict. A key such as `entry`, `src`, `html`, `script`, `path`,
`document` or `data` is refused, because a Screen must never become a page builder or a
second copy of app data.

## What the package owns

- `src/screen.ts` — the `suite.screen` v2 schema and `parseScreen`. A newer `version` is
  refused with a sentence and the file is left alone; nothing is guessed at. An unknown
  registry id is a valid entry.
- `src/migration.ts` — the one migration chain. `v1 → v2` stamped the row-capable
  version without touching a placement; the chain is contiguous and a missing step
  refuses with the action to take. `src/fixtures/versions/` keeps one fixture per
  version.
- `src/document.ts` — `ScreenDocument`: create from a Screen, open from a Loro snapshot,
  export a snapshot, and mutate the ordered list (add, remove, move before/after,
  resize, set/clear a setting, add a row). Stored snapshots and portable files both run
  the same migration chain; an older snapshot is rebuilt as the current document. Every
  unknown widget id, unknown setting and row survives a mutation and a snapshot.
- `src/codec.ts` — the portable `.screen` file. It is a Loro snapshot inside a small
  envelope: the 12-byte magic `SUITE-SCREEN`, a 2-byte envelope version (currently `1`),
  a 4-byte header length, a canonical JSON header (`format`, `version`, `id`, `name`,
  `home`, `payloadLength`) and the snapshot bytes. The extension is `.screen` and the
  media type is `application/vnd.suite.screen`. The payload is always the current Screen
  version on export; import accepts an older version through the migration chain and
  refuses a newer one before decoding it.
- `src/layout.ts` — `screenLayout(screen, { width })`, the responsive composition with no
  DOM. A row shares its width by weight on a wide window; below
  `SCREEN_LAYOUT_NARROW_WIDTH` (760) every row becomes one horizontal scrolling line, so
  a phone never squeezes two widgets into half width. `flattenScreenEntries` is the
  stacked fallback for a host that cannot draw the row primitive.
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
- File IO, backups, atomic writes or a document store. The host picks the destination
  for a `.screen` export and reads an import before passing the bytes in.
- Sync. A portable file is a manual copy; syncing a Screen across a person's devices is
  still #199, and the host owns that transport rather than a pack.
- App data. A capture carries strings to the app; the app writes through its own document
  layer.

## Tests

```sh
mise exec -- pnpm --filter @suite/screens test
mise exec -- pnpm --filter @suite/screens typecheck
```
