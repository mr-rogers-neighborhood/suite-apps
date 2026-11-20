# Planning note: super-app architecture, and the path to it

Track E. A synthesis connecting the workspace repositories and specifying a path toward a sovereign,
distributed, local-first super-app.

**This is a plan, not a survey, and it sat in the wrong directory for a while.** §2 and §3 describe our
own code and a component to build — the [marking rule](README.md) governs claims about _other_ systems,
and the few of those here carry a mark. §5 is a roadmap, and its first tracks have since landed:

| Track | Item                                                          | State                                                           |
| ----- | ------------------------------------------------------------- | --------------------------------------------------------------- |
| 1     | `<MenuBar>`, `<SyncPill>` and the ARIA engine in `@suite/ui`  | **built** — `packages/ui/src/menu/`, with its own tests         |
| 1     | Canvas adopts `<MenuBar>` as the reference implementation     | **built** — `TitleBar.tsx` composes it                          |
| 1     | Planner and Budget adopt it, collapsing their sidebars        | not started                                                     |
| 2     | `menuBar.setSlots` / `menuBar.onAction` on the frame protocol | **not started, and not promised** — see ADR-0003's consequences |
| 3     | ADR: cross-app menu bar                                       | **written** — [ADR-0003](../adr/0003-cross-app-menubar.md)      |
| 4     | WAI-ARIA menubar traversal tests                              | **built** — `menuKeys.test.tsx` beside the implementation       |

Marks per [README.md](README.md): **Documented**, **Code**, **Measured**, **Unverified**.

---

## 1. Re-evaluating the Vision: The "Distributed, Local-First, Collaborative WeChat"

In [README.md](README.md#the-framing-under-test), the earlier research pass dismissed the WeChat framing by arguing that three of its four adjectives (_distributed_, _FOSS_, _local-first_) describe things WeChat is not, concluding that the analogy was useful only in one narrow direction: _host/pack isolation_.

**Code** + **Documented.** That dismissal conflated WeChat's **centralized server infrastructure** with its **client-side container UX architecture**. When viewed as an interaction and application container model, WeChat pioneered foundational design patterns that are directly relevant to Suite:

1. **The Host Anchor & The Navigation Capsule (胶囊按钮):**
   - In WeChat, the host reserves an immutable top-right capsule containing `···` (Host Menu: permissions, share, add to desktop, app info) and `⨂` (Close / minimize / exit to WeChat).
   - This gives users an absolute trust anchor and escape hatch, regardless of whatever state the mini-app enters.
   - In Suite today, [`suite-go`](file:///home/archlinux/Desktop/suite/suite-go/apps/go/src/shell/MountedModule.tsx#L89-L97) has an ad-hoc back button and title text with no host controls, while desktop apps ([`suite-planner`](file:///home/archlinux/Desktop/suite/suite-planner/apps/desktop/src/renderer/src/app/Shell.tsx) and [`suite-budget`](file:///home/archlinux/Desktop/suite/suite-budget/apps/desktop/src/renderer/src/app/Shell.tsx)) each invent their own custom header or completely omit one.

2. **The Mini-App Header Takeover Pattern:**
   - WeChat allows a mini-app to define its background color, title string, and contextual navigation controls _in the flexible zone between the back button and the host capsule_.
   - The mini-app "takes over" the application bar to present domain-specific tabs and search inputs, without breaking host-level window control or sandboxing.
   - This matches macOS's Application Bar concept: a unified physical top bar whose interior slots dynamically project the active application's menu hierarchy (`File`, `Edit`, `View`, `Domain Actions`).

3. **Inter-Mini-App Context & Routing:**
   - In WeChat, mini-apps invoke `wx.navigateToMiniProgram` with structured payloads and receive callbacks on return (`wx.navigateBack`). **Unverified** — widely repeated, and this pass did not read WeChat's own API reference; [wechat-architecture.md](wechat-architecture.md) covers the host model, not this call.
   - In Suite, `suite://` URIs exist ([`route.ts`](file:///home/archlinux/Desktop/suite/suite-start/apps/start/src/route.ts#L1-L26)), but only trigger top-level OS process spawns via `suite-start`. There is currently no in-memory or intra-container protocol for cross-domain referencing (e.g. referencing a Canvas card from a Planner task, or linking a Budget expense to a project board).

**Conclusion:** The true vision of a _"distributed, local-first, collaborative WeChat"_ is **bringing the modularity, instant multi-domain workflow, and unified shell of a Super-App into a sovereign, peer-to-peer, local-first environment**.

---

## 2. Cross-Repository Codebase & UX Audit

A rigorous cross-repo audit reveals both powerful positive qualities and structural fractures:

### 2.1 `suite-canvas`

- **Role:** Visual object graph and infinite workspace editor.
- **Positive Qualities:**
  - Deep CRDT implementation using Loro ([`WorkspaceDocument.ts`](file:///home/archlinux/Desktop/suite/suite-canvas/packages/graph/src/loro/WorkspaceDocument.ts)).
  - Mature chrome implementation in [`TitleBar.tsx`](file:///home/archlinux/Desktop/suite/suite-canvas/apps/canvas/src/chrome/TitleBar.tsx) with board switcher, workspace switcher, pinned tabs, and peer presence indicator.
  - Granular undo/redo tracking and peer cursors ([`LoroCollaboration.ts`](file:///home/archlinux/Desktop/suite/suite-canvas/apps/canvas/src/editor/LoroCollaboration.ts)).
- **Deficits & Fractures:**
  - ~~**Tightly Coupled Chrome:** `TitleBar.tsx` directly imports Canvas state stores (`useCanvasStore`), escape layer controllers (`useEscapeLayer`), and specific icon assets (`CanvasMark`), making it impossible to reuse across other apps without refactoring.~~ **Fixed.** The bar's structure lives in `@suite/ui`'s `MenuBar` and Canvas passes the nodes it already rendered; the state stays in Canvas, which is now the correct place for it.
  - **CSS Isolation:** Heavily reliant on Tailwind 3 utility classes and preflight styles that conflict with non-Tailwind sibling repositories.

### 2.2 `suite-planner`

- **Role:** Local-first daily task and agenda planner.
- **Positive Qualities:**
  - Snappy date-arithmetic and day-based organization ([`days.ts`](file:///home/archlinux/Desktop/suite/suite-planner/apps/desktop/src/renderer/src/day/days.ts)).
  - Clean Loro CRDT schema utilizing mergeable containers (`ensureMergeableMap`, `ensureMergeableList`).
- **Deficits & Fractures:**
  - **No Top Bar Chrome:** [`Shell.tsx`](file:///home/archlinux/Desktop/suite/suite-planner/apps/desktop/src/renderer/src/app/Shell.tsx#L11-L17) renders content directly with zero top chrome.
  - **Spatial Fragmentation:** View switching (`Today`, `Inbox`, `Upcoming`) is trapped in a fixed 228px left sidebar ([`Sidebar.tsx#L43`](file:///home/archlinux/Desktop/suite/suite-planner/apps/desktop/src/renderer/src/app/Sidebar.tsx#L43)), while temporal day navigation (`‹ Today ›`) is buried inside the scrolling content body ([`DayHeader.tsx#L37-L50`](file:///home/archlinux/Desktop/suite/suite-planner/apps/desktop/src/renderer/src/day/DayHeader.tsx#L37-L50)).
  - **No Sync or Peer Presentation:** Complete absence of network/sync state indication in the user interface.

### 2.3 `suite-budget`

- **Role:** Local-first envelope ledger and personal finance manager.
- **Positive Qualities:**
  - Strict double-entry ledger logic with automatic rollover arithmetic ([`records.ts`](file:///home/archlinux/Desktop/suite/suite-budget/apps/desktop/src/renderer/src/ledger/records.ts)).
  - Rolling backup system and auto-save protection.
- **Deficits & Fractures:**
  - **Ad-Hoc Header:** Renders a bespoke 44px `<header>` ([`Shell.tsx#L58-L105`](file:///home/archlinux/Desktop/suite/suite-budget/apps/desktop/src/renderer/src/app/Shell.tsx#L58-L105)) that visually clashes with Canvas's `TitleBar`.
  - **Split Navigation:** Primary view navigation is placed in a 236px sidebar ([`Sidebar.tsx#L64-L83`](file:///home/archlinux/Desktop/suite/suite-budget/apps/desktop/src/renderer/src/app/Sidebar.tsx#L64-L83)), while month selection and file metadata sit in the top header, creating cognitive friction.
  - **Unchecked IPC Bridge:** Communicates via 17 distinct bridge methods on `window.suiteBudget` without the schema or capability checks seen in Canvas ([`bridges.md#L30-L40`](file:///home/archlinux/Desktop/suite/suite-dev/docs/reference/bridges.md#L30-L40)).

### 2.4 `suite-go`

- **Role:** Unified mobile container (Android Capacitor APK).
- **Positive Qualities:**
  - Validated postMessage bridge protocol (`FRAME_PROTOCOL` / `suite.frame.v1`).
  - Document-boundary iframe sandboxing ([ADR-0002](file:///home/archlinux/Desktop/suite/suite-go/docs/adr/0002-isolation-is-a-document-boundary.md)).
  - Native SAF (Storage Access Framework) file management.
- **Deficits & Fractures:**
  - **Primitive Header:** [`MountedModule.tsx#L89-L97`](file:///home/archlinux/Desktop/suite/suite-go/apps/go/src/shell/MountedModule.tsx#L89-L97) renders a bare back button and title string; lacks menu support, sync status, and capsule actions.
  - **Destructive Lifecycle:** Switching modules triggers a complete teardown and unmount (`closeModule()`), which flushes edits but destroys scroll position, form inputs, and view caches ([`App.tsx#L174-L189`](file:///home/archlinux/Desktop/suite/suite-go/apps/go/src/shell/App.tsx#L174-L189)).

### 2.5 `suite-start`

- **Role:** Desktop application launcher and process supervisor.
- **Positive Qualities:**
  - Secure AppImage lifecycle management and signature validation ([`main.ts`](file:///home/archlinux/Desktop/suite/suite-start/apps/start/src/main.ts)).
  - Strict boundary: never intercepts or inspects document CRDT payloads.
- **Deficits & Fractures:**
  - **Process-Level Isolation Only:** Boots separate OS windows per app; does not provide an integrated multi-app workspace or unified tabbed window container on desktop.
  - **Vanilla DOM Rail:** Launcher rail UI is written in vanilla JS DOM manipulation ([`rail.js`](file:///home/archlinux/Desktop/suite/suite-start/apps/start/src/renderer/rail.js)) rather than leveraging `@suite/ui`.

---

## 3. Component Specification: The Generalized `MenuBar`

### 3.1 Design Objective

Abstract the mature layout, ergonomics, and interaction patterns of Canvas's [`TitleBar.tsx`](file:///home/archlinux/Desktop/suite/suite-canvas/apps/canvas/src/chrome/TitleBar.tsx) into a headless/slotted `@suite/ui/MenuBar` primitive that reinforces the "mini-app" takeover language across all applications.

### 3.2 Slot Architecture

```
+-------------------------------------------------------------------------------------------------------------------------------+
| [1. Mark/Home] | [2. Context Breadcrumb] | [3. Mini-App Takeover] | [4. Search Trigger] | [5. Sync/Peers] | [6. Actions] | [7. Capsule] |
+-------------------------------------------------------------------------------------------------------------------------------+
|<--------- Host Zone -------->|<----- Active Mini-App Zone ----->|<------- Universal ------>|<--- Collaboration --->|<-- Host Controls ->|
```

1. **Mark / Home Anchor (`mark`):**
   - Renders the application or workspace mark (e.g. `<CanvasMark size="sm" />`, `<PlannerMark size="sm" />`, or `<SuiteMark />`).
   - Clicking intercepts navigation to return to the host launcher / super-app home screen.
2. **Context Breadcrumb (`context`):**
   - Displays workspace, document, or project title.
   - Supports inline renaming with optimistic input switching and escape key cancellation.
   - Provides a dropdown menu for document-level actions (duplicate, export, archive).
3. **Mini-App Takeover Zone (`navigation`):**
   - The flexible center-left area where the active mini-app projects its primary navigation:
     - **Canvas:** Board switcher dropdown, pinned board tabs, and portal back buttons.
     - **Planner:** Day navigation strip (`‹ Today ›`, calendar trigger) and view selector (`Today` | `Inbox` | `Upcoming`).
     - **Budget:** Month selector (`‹ October 2026 ›`) and ledger view tabs (`Plan` | `Accounts` | `Reports`).
     - **Desktop OS Mode:** Traditional drop-down application menus (`File`, `Edit`, `View`, `Format`).
4. **Universal Command / Search Trigger (`search`):**
   - Provides an accessible button triggering the global command palette (`⌘K`).
   - Adapts placeholder based on active context (e.g., _"Search boards, cards, or commands…"_).
5. **Sync & Peer Presence Cluster (`sync`, `peers`):**
   - **`peers`:** Displays live presence avatars with active selection rings.
   - **`sync`:** Renders `<SyncPill>`, a standardized indicator communicating CRDT synchronization status:
     - `synced`: Subtle green indicator ("Saved & Synced").
     - `syncing`: Subtle animated pulse ("Syncing changes…").
     - `offline`: Neutral amber ("Local-only / Offline").
     - `conflict`: Alert indicator with one-click converge/diff trigger.
6. **Domain Actions (`actions`):**
   - Right-side contextual primary actions:
     - **Canvas:** Share workspace, Import vault, Export JSON/Markdown.
     - **Planner:** `+ New Task` quick-capture button.
     - **Budget:** Undo / Redo buttons, `+ Add Transaction` modal trigger.
7. **Host Controls / The Capsule (`controls`):**
   - **Desktop Standalone:** Theme toggle (`<ThemeToggle />`), window control hooks.
   - **Mobile Container:** The immutable Suite Capsule (`···` Host Menu + `⨂` Close/Suspend).

### 3.3 Keyboard Accessibility Specification

Following WAI-ARIA `role="menubar"` standards:

- Top-level items have `role="menuitem"`.
- `ArrowRight` / `ArrowLeft`: Moves focus cyclically across top-level menu triggers and navigation tabs.
- `ArrowDown` / `Enter` / `Space`: Opens active dropdown menu and places focus on the first item.
- `ArrowUp` / `ArrowDown`: Navigates vertically within an open menu.
- `Escape`: Closes open menu and restores focus to parent trigger.
- `Home` / `End`: Jumps to first or last item in the active bar or menu.

### 3.4 Decoupling from Canvas

To extract `TitleBar.tsx` into `@suite/ui`:

- Move keyboard navigation logic from [`menuKeys.ts`](file:///home/archlinux/Desktop/suite/suite-canvas/apps/canvas/src/dialogs/menuKeys.ts) to `@suite/ui/src/menuKeys.ts`.
- Replace Canvas-specific `useCanvasStore` with generic props and callbacks.
- Replace `useEscapeLayer` with `@suite/ui`'s native DOM keyboard listener pattern (as used in [`Modal.tsx`](file:///home/archlinux/Desktop/suite/suite-start/packages/ui/src/Modal.tsx)).
- Replace Canvas-specific CSS classes with `@suite/theme` CSS variables (`var(--surface-translucent)`, `var(--hairline)`, `var(--text-primary)`).

---

## 4. Speculative Abstraction: The Cross-Domain Object Browser ("Library")

Canvas features an 822-line [`LibraryDrawer.tsx`](file:///home/archlinux/Desktop/suite/suite-canvas/apps/canvas/src/library/LibraryDrawer.tsx) supporting faceted search across cards, boards, media, templates, and highlights.

**The Super-App Opportunity:**
Abstracting this into `@suite/ui/LibraryDrawer` (or `@suite/shell/Library`) provides the foundation for **cross-app object referencing**:

- **In Planner:** A task like _"Prepare Q4 Architecture Review"_ can open the Library Drawer, browse Canvas research boards, and attach a direct deep link to a card.
- **In Budget:** An expense item can attach a link to a Planner milestone or a Canvas project board.
- **In Canvas:** A card can embed a live preview of a Planner day view or a Budget category balance.

---

## 5. Parallel Systems Overhaul & Documentation Roadmap

| Track                            | Focus                             | Key Deliverables                                                                                                                                                                                                                                                                                                          |
| :------------------------------- | :-------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Track 1: UI & Shell**          | Shared Chrome & Mini-App Language | 1. Implement `<MenuBar>`, `<SyncPill>`, and ARIA menubar engine in `@suite/ui`.<br>2. Adopt `<MenuBar>` in `suite-canvas` as reference implementation.<br>3. Adopt `<MenuBar>` in `suite-planner` and `suite-budget`, collapsing duplicate sidebars.<br>4. Mount mobile Capsule and responsive `<MenuBar>` in `suite-go`. |
| **Track 2: Bridges & Protocols** | Inter-App & Host Communication    | 1. Extend `FRAME_PROTOCOL` (`frame.ts`) with `menuBar.setSlots` and `menuBar.onAction`.<br>2. Standardize `window.suiteBridge` across Electron preload scripts with staleness checks.<br>3. Implement two-message Loro version-vector delta sync in `suite-sync` (Finding F17).                                           |
| **Track 3: Architecture & ADRs** | Formalizing Decisions & Standards | 1. Author ADR: _Cross-App Menu Bar & Takeover Architecture_ (`suite-dev/docs/adr/0003-cross-app-menubar.md`).<br>2. Author ADR: _Super-App Shell & Host Capsule Mechanics_.<br>3. Update `suite-dev/docs/reference/bridges.md` to document standardized bridge contracts.                                                 |
| **Track 4: CI & Verification**   | Quality Gates & Guardrails        | 1. Add automated CI test enforcing mergeable container usage (Finding F1) across all CRDT schemas.<br>2. Add WAI-ARIA menubar accessibility and keyboard traversal tests to `@suite/ui`.<br>3. Validate cross-repo CI run via `scripts/ci.mjs`.                                                                           |

---

## 6. Next Steps

As of 2026-11-18 the first two are done and this is what is left:

1. **Adopt the bar in Planner and Budget.** Both still draw their own chrome; the `navigation` zone is
   where their sidebars collapse to, and that is the part nobody has designed yet.
2. **Decide about `setSlots`/`onAction` or drop them.** A pack that wants host controls in its own bar
   needs a new capability and a new frame request. ADR-0003 records that the hooks do not exist so a
   reader stops looking for them; if the mobile capsule is wanted, that decision comes first.
3. ~~Review the decision framework with stakeholders.~~ Done — this is a single-maintainer project, and
   the ADR is the review.
4. ~~Finalize the `MenuBar` implementation plan.~~ Done — it is in the code, and ADR-0003 records why.
