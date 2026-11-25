# `@suite/ui`

The suite's one component base. Each component is a thing the apps had built separately and had
already let drift, painted from the custom properties `@suite/theme` publishes. Nothing here holds a
palette, a radius or a transition duration of its own.

## Why it exists

Planner and Budget each wrote a `Button`, named their variants differently, and both hardcoded
the ink on a filled paint — `text-white` and `text-[#07130d]`. Measured against presets neither
had considered, that is **2.53:1** and **3.47:1** against a floor of 4.5.

A shared primitive is where `on-accent` gets _enforced_ rather than remembered.

## The chosen base

**Radix primitives + Tailwind + CSS-variable tokens.** No Mantine: its theme is a JavaScript object
the pack would have to own, so it cannot be driven by the values a host injects after first paint.
No CVA: `cx()` is twelve lines and `Record<Variant, string>` already covers the variants.

Radix owns the behaviour that is easy to get subtly wrong. `Modal` is Radix Dialog, so focus-in,
focus-return, the Tab trap, Escape, outside press and the inert background come from the primitive
rather than a local reimplementation. Everything else is a plain element or a small disclosure over
plain elements; Radix has no primitive for a seven-zone menu bar or a transient notice. Icons stay
with the app, and an app that owns a genuinely richer component keeps it.

## Consuming it

`@suite/ui` is a workspace package. Consumers declare `"@suite/ui": "workspace:*"`; there is no tag to
bump. The package is built with `tsc`; there is no conditional source entry, so the `dist/` a consumer
resolves is the same `dist/` Tailwind scans.

**Then teach Tailwind to scan it.** Tailwind 4 does not read `node_modules`, so without this
every class in a primitive compiles to nothing — and the symptom is an unstyled button, which
looks like a styling bug and is a build-configuration one. The path is relative to the
stylesheet that declares it:

```css
@source "../../../../node_modules/@suite/ui/dist";
```

React 19 is a peer dependency. `@radix-ui/react-dialog` is the package's only runtime dependency.

### The tokens a host publishes

| Layer | Published as | Source |
| --- | --- | --- |
| Colour roles | `--canvas`, `--ink`, `--accent`, … | `cssVariables(preset, mode)` |
| Type, density, radius, shadow, motion | `--text-*`, `--control-*`, `--radius-*`, `--shadow-*`, `--duration-*` | `scaleVariables(density)` |

`@suite/theme` publishes both records, and the host publishes them together. `themeCss()` in
`hosts/desk` writes the colour roles and `scaleVariables(DEFAULT_DENSITY)` into one `:root` sheet,
inserted before the first paint (the host lane that closed this gap is #445). A pack reads
`var(--token)` from that document and imports neither `@suite/theme` nor a stylesheet; a theme
change moves both layers together.

The components keep fallbacks for a document with no host sheet — a story, a unit test, or a pack
opened outside Suite. They are the values that already shipped, so the fallbacks change no pixel
when the published layer arrives.

The rule inside this package is the same one a pack must follow: every colour, radius, shadow and
duration is a `var(--token)`, never a hex, `bg-black`, `rounded-2xl`, `shadow-lg` or
`duration-200`. `src/tokenLiterals.test.ts` fails the package if one appears.

## What is here

| Export | What it is |
| --- | --- |
| `Button` | `primary · secondary · ghost · danger`, `sm · md`. One background class per variant, never two. |
| `IconButton` | A glyph with a **required** accessible name. |
| `Field` | Label, hint and error wired to the control, so `aria-describedby` and `aria-invalid` cannot be left out. Renders the shared input, or labels a child `<select>`/picker. |
| `TextInput` | The shared input on its own, for a table cell or an inline rename with no label column. |
| `Modal` | Radix Dialog: focus in, focus back on close, Tab wraps, Escape and outside press close. Optional `header`, `description` and `footer` slots keep a caller's title, close control and fixed actions while the body scrolls. |
| `Toast` | `role` follows the tone: `alert` for a failure, `status` otherwise. |
| `EmptyState` | The "nothing here yet" panel. |
| `Launch` | The no-document-open screen. Everything app-specific is a child. |
| `AppMark` | An app's glyph on a themed tile, in `currentColor`. |
| `MenuBar` | The cross-app top bar in seven named zones. Takes nodes; owns no app's state. |
| `SyncPill` | Sync state as one control: `synced`, `syncing`, `offline`, `conflict`, … |
| `PrivacyLine` | The one privacy sentence, said the same way everywhere. |
| `menuKeys` | WAI-ARIA keyboard helpers for a `menubar` and its nested menus. |
| `cx`, `FOCUS_RING`, `MOTION` | The class helpers a pack needs to compose its own control. |

`ImportMenu` is internal to `Launch`; its `ImportOption` type is exported because `LaunchProps`
uses it. The former `Dialog` wrapper and the unused `defaultWorkspace` helpers were deleted: no
pack imported them, and `Modal` plus an app's heading covers the same job.

## Storybook and axe

Stories live beside the component (`src/**/*.stories.tsx`). The preview paints the host's colour
record and scale record on the story document, so a story is measured under the same tokens a pack
gets. The toolbar switches **preset** (Suite, Solarized, Warm) and **mode** (light, dark); that is
the second-theme proof — the surface changes without a component changing.

`a11y: { test: "error" }` makes every story an axe test. A new violation fails the story rather
than waiting for someone to open the accessibility panel.

```sh
pnpm --filter @suite/ui test           # jsdom unit tests, including the token-literal guard
pnpm --filter @suite/ui test:stories   # every story in headless Chromium, with axe
pnpm --filter @suite/ui build-storybook
pnpm --filter @suite/ui check          # build, typecheck, both test runs, storybook build
```

## Migrating a pack

The first consumer is Budget (#420). A pack migrates one screen at a time; nothing below changes
the pack contract.

1. **Make the tokens reachable.** Add the `@source` line above. The host's sheet already carries
   both the colour and scale records, so the pack reads `var(--token)` and imports nothing; a token
   layer arrives with no pack edit.
2. **Replace the local duplicates.** Import `Button`, `IconButton`, `EmptyState`, `Field`, `Modal`,
   `Toast`, `Launch`, `AppMark` and `MenuBar` from `@suite/ui`. A local wrapper is fine when it only
   adds layout, as Budget's `IconButton` and `EmptyState` wrappers already do.
3. **Delete only after the last import goes.** A wrapper with one call site is churn; leave it until
   the screen is migrated.
4. **Move the raw controls onto the base.** A `<button>` inside a row is the common gap: `IconButton`
   brings the required name, the density-sized target and the focus ring.
5. **Replace literals with the published steps** (`rounded-xl`, `shadow-2xl`,
   `text-[length:var(--text-*)]`). Do not tidy the type scale while migrating; the five roles are
   the values that shipped.
6. **Run the pack's own tests and the shared stories.** A pack does not need a Storybook copy; the
   shared stories are the contract.

### One screen, before and after

Budget's Plan → category row → row-action affordance (`CategoryRow.tsx`, the raw trigger):

```diff
-<button type="button" aria-label={`Actions for ${entry.category.name}`}
-  className="rounded p-0.5 text-faint opacity-0 transition-opacity hover:text-ink group-hover:opacity-100 focus-visible:opacity-100">
-  <MoreHorizontal size={14} />
-</button>
+<IconButton label={`Actions for ${entry.category.name}`} icon={<MoreHorizontal size={14} />}
+  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" />
```

`IconButton` adds the ring from `FOCUS_RING` and reads `--control-height-sm`; the current class has
no ring at all. The target chip keeps its `<button>` because it wraps a progress bar, and loses
`w-10 shrink-0` for the density gap. Net visible change: one ring, one size and one hover treatment
per row action instead of three.

## When not to use this

- **A richer component wins.** Canvas's toast is a stack with pause-on-hover and remaining-time
  tracking. Sharing one notice would be a downgrade, so Canvas keeps its own.
- **A pack-specific shape with one consumer wins.** A React Flow node, Budget's money input, or a
  chart belongs to that pack until a second consumer exists.
- **A genuinely different chrome wins.** A full-screen editor or a barless canvas should keep its
  own layout rather than bend the seven zones.

The test is whether the _job_ is identical, not whether the _shape_ is similar.

## The contrast test

`src/contrast.test.ts` parses the roles out of the class strings, so a component that stops using
a role fails to parse rather than quietly passing, then checks every pairing against every preset
in both modes. It found Solarized dark's `danger` at 4.10:1 as text on its own surface — the role
is both a fill and an ink, and only one of those had been checked.
