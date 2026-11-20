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
7. **`controls`**: host controls, such as the theme toggle, window controls and a container capsule.

Every zone takes a `ReactNode`. The bar decides nothing about what an app puts there.

## What the package may depend on

`@suite/ui` has no external runtime dependency. `MenuBar` and `SyncPill` use React and the
`@suite/theme` CSS variables directly; they import no Tailwind utility, icon bundle or state store.

## Keyboard and ARIA

`menuKeys.ts` holds the behaviour and its tests:

- The container is a `role="menubar"` with `menuBarKeyDown` for keyboard input and
  `handleMenuBarKeyDown` for the same traversal driven programmatically.
- `ArrowRight` and `ArrowLeft` move through the items cyclically, including across the ends.
- `Home` and `End` move to the first and last item.
- Arrow traversal steps aside while the person is typing in a text input, so it does not fight inline
  renaming.
- `menuKeyDown` and `focusFirstMenuItem` handle a nested `role="menu"`, including skipping its rows
  during menubar traversal and returning focus to the trigger when the menu closes from inside.

## Adoption

Canvas is the reference implementation: `apps/canvas/src/chrome/TitleBar.tsx` renders `<MenuBar>` and
`<SyncPill>` with its existing props. Planner and Budget still draw their own chrome. The primitive
exists for them to adopt; this page does not claim they have.

## Container hooks

A host that wants to project an app's takeover navigation into its own capsule needs a bridge. That
bridge is specified in [bridges](bridges.md) as `MenuBarBridge` (`setSlots` and `onAction`), but it is
not built: no preload exposes it, and no host consumes it. A standalone app renders `<MenuBar>`
directly.
