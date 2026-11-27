---
audience: developer
---

# Menu bar

`@suite/ui/MenuBar` is the shared top bar. Its rule is a contract between the host and the active app:
the host keeps two anchors, where you came from and how you leave, and the app takes over the middle.
The seven named zones make that division explicit.

## The seven zones

```
+--------------------------------------------------------------------------------------------------+
| [1. Mark] [2. Context] [3. Navigation Takeover] [4. Search]   [5. Peers & Sync] [6. Actions] [7. Controls] |
+--------------------------------------------------------------------------------------------------+
```

1. **`mark`**: host branding and the navigation anchor. Emits `onNavigateHome` on an unmodified click,
   so a shell can run its exit transition.
2. **`context`**: document or workspace identity, subtitle, inline renaming with Enter/Escape, and a
   switcher menu.
3. **`navigation`**: the active app's takeover slot for its own view switcher, such as Canvas's board
   picker, Planner's day/timeline navigator or Budget's account selector.
4. **`search`**: the universal command palette trigger (`⌘K`), which also takes any spare horizontal
   space.
5. **`peers` & `sync`**: peer presence and `<SyncPill>`, showing `synced`, `syncing`, `offline` or
   `conflict`.
6. **`actions`**: the app's contextual actions, such as export, share and filter.
7. **`controls`**: window controls and a container capsule. The theme is not here: the host's own View
   menu (desktop) or Settings (mobile) owns it.

Every zone takes a `ReactNode`. The bar decides nothing about what an app puts there.

## What the package may depend on

`@suite/ui` has no external runtime dependency. `MenuBar` and `SyncPill` use React and the
`@suite/theme` CSS variables directly; they import no Tailwind utility, icon bundle or state store.

## Keyboard and ARIA

`menuKeys.ts` holds the behaviour and its tests:

- The container is a `role="menubar"` with `menuBarKeyDown` for keyboard input and
  `handleMenuBarKeyDown` for the same traversal driven programmatically. Horizontal traversal is
  only attached when the container actually declares `role="menubar"`; a plain header leaves the
  arrows to the composite inside it, such as the tab strip or a text field.
- `ArrowRight` and `ArrowLeft` move through the items cyclically, including across the ends.
- `Home` and `End` move to the first and last item.
- Arrow traversal steps aside while the person is typing in a text input, so it does not fight inline
  renaming.
- `menuKeyDown` and `focusFirstMenuItem` handle a nested `role="menu"`, including skipping its rows
  during menubar traversal and returning focus to the trigger when the menu closes from inside.
- A slot dropdown is drawn in a portal positioned from its trigger's box, because the bar scrolls
  horizontally and would otherwise clip the menu to the bar's height.

## Adoption

Canvas is the reference implementation: `packs/canvas/src/chrome/TitleBar.tsx` renders `<MenuBar>` and
`<SyncPill>` with its existing props.

Planner and Budget adopt the bar too, each with only the material it has:

- Planner's `Shell.tsx` fills `mark` and the home anchor (back to today), a workspace context, a
  `navigation` takeover built from its `views.ts` registry, export and import in `actions`, and its
  `SyncPill` in `peers` and `sync`. It has no command palette, so `search` stays empty.
- Budget's `Shell.tsx` fills `mark` (back to all budgets), the budget name in `context`, a
  Plan/Accounts/Reports takeover in `navigation`, its existing Save status, undo, redo, import and Add
  transaction in `actions`, and the command palette trigger in `search`.

Empty zones stay empty. Planner fills `peers` and `sync` with its `SyncPill` and peer count; Budget
has neither, so those zones render nothing. Each app keeps its rail or sidebar as the full navigation;
the takeover is the compact one. Below `md` the wide zones hide rather than scroll, so the bar adds no
horizontal overflow at phone widths.

Both Planner and Budget auto-hide the native menu on Linux and Windows (`autoHideMenuBar`). The bar is
the visible menu in that case; the native accelerators still fire, and the two do not show two copies
of the same commands.

## Container hooks

A host that wants to project an app's takeover navigation into its own capsule needs a bridge.
That bridge is now built: `window.suite.menuBar` publishes the active pack's slots to the host's
one physical bar, and `@suite/contracts/menu-bar` is the vocabulary both sides speak. The rest of
this section describes how it works; [bridges](bridges.md) keeps the transport-level notes.

### Who draws the bar

Inside a host, **only the host draws a bar**. The active pack draws none and publishes its material
instead. Standalone (the frozen Flatpak, a browser) the same pack draws its own `MenuBar`, so one
component tree serves both cases.

A pack asks `menuBarBridge()` from `@suite/ui` which case it is in. The answer is the presence of
`window.suite.menuBar`: a host that offers it drives the bar, and one that does not gets the pack's
own. Nothing has to be passed down or configured, which is what makes the same bundle work in both
places.

A host with an active pack can spend two thin rows instead of one crowded one: the host's own row
(mark, open tabs, search, sync, window controls) and the pack's row (document name, takeover,
actions). The pack row is omitted when the active surface published nothing. Row height follows the
host's density scale, and a native host reports the measured total to its window so pack content
starts below the real bar.

### What a pack publishes

`MenuSlots` — a title, an optional title menu, a takeover row, actions and an optional status
readout. The takeover row is a small set of controls, because this is the union of what the three
packs actually draw rather than a general UI language:

| `kind` | What it is | Who uses it |
| --- | --- | --- |
| `menu` | A dropdown of rows, optionally checked | Canvas's boards, Planner's and Budget's views |
| `tabs` | A row of tabs, one active, carrying its own accessible `label` | Canvas's open boards |
| `toggle` | A mode control, on or off | Canvas's explain and interaction mode |
| `buttons` | A group of icon buttons | Undo/redo, history, outline, the drawer toggle |

A row with `checked` is drawn as a `menuitemradio`, not a plain item, so the chosen value is
announced rather than just marked. A disabled row may carry `disabledReason`, and the host shows that
sentence instead of a silent grey control.

### Ids are opaque, and `help` is the seam

The host renders a descriptor and **echoes back the id the pack chose**. It never learns that
`canvas.explain` toggles a mode or that `planner.view` switches a view, so it cannot special-case
either.

That restraint is the point rather than tidiness. One explain/tutorial layer that works in every
app needs to describe controls it has never seen; a host that understood each app's vocabulary
would need a host change per app. Every control may therefore carry `help: { title, body? }` — one
sentence the pack writes beside the control. Nothing reads it yet beyond the control's own title,
but it is in the contract now so a control becomes explainable without a second mechanism.

### What a press does

`{ id, item? }` goes back to the pack that published the control. The pack's own map from id to
behaviour is the only place meaning lives, and it calls the same store setters the in-app bar does,
so the two cannot disagree.

### Bounds

A label is text, never markup, and a `glyph` is at most a few characters rather than an icon name.
A `tone` names a theme role (`quiet`, `ok`, `warn`, `danger`), never a colour, so a pack cannot
choose styling the preset does not have. The whole object is validated at the IPC boundary, and a
malformed publish leaves the previous bar in place rather than half-applying a broken one.

