# ADR-0003: Cross-App Menu Bar and Mini-App Takeover Architecture

- Status: accepted
- Date: 2026-11-08

## Context

Application chrome across Suite was fragmented and ad-hoc:

- **Suite Canvas** possessed a rich 44px top bar (`TitleBar.tsx`) providing document identity, board switching, pinned cards, search palette triggers, sync status, and presence indicators, but it was tightly coupled to Canvas state stores and internal dialog logic.
- **Suite Planner** rendered zero top chrome (`Shell.tsx`), relegating date navigation to content scroll regions and view switching to a fixed 228px sidebar.
- **Suite Budget** implemented an isolated custom `<header>` (`Shell.tsx`) with bespoke styles, no sync indication, and no peer presence presentation.
- **Suite Go** (the mobile container) rendered a rudimentary header without support for mini-app contextual actions or container capsule controls.

This fragmentation broke the "mini-app" paradigm. In an operating system or container environment (similar to macOS's application menu bar or mobile mini-app containers), the top chrome represents a contract between the container host and the active application: when an application takes focus, it takes over the menu bar real estate to expose its own navigation, context, and actions while host-level anchors and controls remain stable.

## Decision

**Abstract the Canvas Menu Bar into a decoupled primitive (`@suite/ui/MenuBar`) implementing 7 semantic zones and accessible WAI-ARIA menubar navigation.**

### 1. The Seven Semantic Zones

```
+--------------------------------------------------------------------------------------------------+
| [1. Mark] [2. Context] [3. Navigation Takeover] [4. Search]   [5. Peers & Sync] [6. Actions] [7. Controls] |
+--------------------------------------------------------------------------------------------------+
```

1. **`mark`**: Host branding and navigation anchor. Emits `onNavigateHome` on unmodified clicks to allow animated shell exit transitions.
2. **`context`**: Document/workspace identity, subtitle, inline renaming (with Enter/Escape lifecycle), and switcher menu.
3. **`navigation`**: Active mini-app takeover slot. Hosts application-specific view switchers (Canvas board picker, Planner day/timeline navigator, Budget account selector).
4. **`search`**: Universal command palette trigger (`⌘K`). Reclaims available slack in horizontal layout.
5. **`peers` & `sync`**: Peer presence indicators and `<SyncPill />` presenting local-first sync state (`synced`, `syncing`, `offline`, `conflict`).
6. **`actions`**: Domain-specific contextual actions (export, share, filter).
7. **`controls`**: Host controls (theme toggle, window manipulation, container capsule).

### 2. Zero-External-Dependency Rule

`@suite/ui` maintains zero external runtime dependencies. `MenuBar` and `SyncPill` depend strictly on React and styles drawn from `@suite/theme` CSS variables (`var(--surface-translucent)`, `var(--hairline)`, `var(--ink)`, `var(--ink-muted)`, `var(--focus)`). No per-app Tailwind utility overrides, Lucide icon bundles, or state stores are imported into `@suite/ui`.

### 3. Accessible WAI-ARIA `role="menubar"` Traversal

Horizontal menubar navigation is codified in `menuKeys.ts`:

- Container role `role="menubar"` with keyboard controller `menuBarKeyDown` and programmatic `handleMenuBarKeyDown`.
- `ArrowRight` and `ArrowLeft` traverse items cyclically across boundaries.
- `Home` and `End` jump immediately to first and last items.
- Focus navigation is bypassed while typing within text input elements to avoid conflicting with inline renaming.
- `menuKeyDown` and `focusFirstMenuItem` are retained for nested `role="menu"` submenus.

## Consequences

- **Consistent Mini-App Takeover**: Mini-apps adopt a unified 44px top bar. Planner and Budget can collapse wide vertical sidebars by relocating primary navigation to the takeover slot.
- **Reference Implementation in Canvas**: `TitleBar.tsx` in `suite-canvas` adopts `<MenuBar>` and
  `<SyncPill>` from `@suite/ui` without altering its external props. The submenu key handling that
  used to live in `apps/canvas/src/dialogs/menuKeys.ts` moved into the package with its tests, and the
  shim that re-exported it is gone, so there is one implementation and one place it is tested.
- **Canvas is the only app that has adopted it.** Planner, Budget and Suite Go still draw their own
  chrome. The decision above says they _can_, which is what "the primitive exists" means; it does not
  say they have, and this record should not be read as claiming four apps on one bar.
- **The container hooks are not built.** An earlier draft of this record listed `menuBar.setSlots` and
  `menuBar.onAction` as established and documented in `docs/reference/bridges.md`. Neither exists: no
  preload, no bridge, no document. A host that wanted to slot its own controls into a pack's bar would
  need a new capability and a new `FrameRequest`, and that is a decision this record has not made.
  Recorded rather than deleted, because "we thought we had this" is the part worth keeping.
