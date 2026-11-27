---
audience: developer
---

# The bridges: what a host has to provide

Each app's renderer reaches the machine through exactly one global object installed by its Electron
preload. Nothing else in a renderer touches a Node API, `fs`, or Electron. That is why a renderer
bundles into a plain web bundle and why a different host can run it.

This document exists because **the three bridges disagree with each other**, and a host that wants
to run all three has to know how. It is written from the code, not from intent.

| App     | Global                | Declared in                               | Host marker       | Staleness check                     |
| ------- | --------------------- | ----------------------------------------- | ----------------- | ----------------------------------- |
| Canvas  | `window.suiteDesktop` | `packs/canvas/src/host/bridge.ts` | `host: "desktop"` | **Yes** — `REQUIRED_BRIDGE_METHODS` |
| Planner | `window.suitePlanner` | `packages/planner-core/src/ports.ts` | none              | no                                  |
| Budget  | `window.suiteBudget`  | `packs/budget/packages/core/src/ports.ts` | none              | no                                  |

## Canvas: `window.suiteDesktop`

Identity is a marker plus a version, and the renderer refuses to look like a browser when the host
is merely out of date:

```ts
readonly host: "desktop";
readonly version: string;
readonly platform: string;
```

Ten callable methods, all required:

| Method                  | Contract                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loadDocument()`        | The open document and its snapshot, or `null` when the host has none.                                                                                              |
| `saveDocument(request)` | Write a snapshot plus the manifest the host stores beside it.                                                                                                      |
| `flushDocument()`       | Wait for anything queued to reach disk. Returns `{ ok }` or a failure.                                                                                              |
| `documentInfo()`        | The open document's identity, or `null`.                                                                                                                            |
| `appInfo()`             | Host, version, platform, for diagnostics.                                                                                                                           |
| `createDocument(seed)`  | Create a file and open the window on it. **Cannot be a navigation**: on the desktop the file _is_ the document, so a workspace id in the address bar means nothing. |
| `openFileDialog()`      | Show the open dialog and open the choice. The renderer passes no path.                                                                                              |
| `openDocument(path)`    | Open a path this host reported earlier, re-validated in main.                                                                                                      |
| `recentFiles()`         | What the host remembers.                                                                                                                                           |
| `forgetRecent(path)`    | Drop one entry.                                                                                                                                                     |

**Why the staleness check matters.** A window left open by a previous build keeps the preload it
loaded at launch, so a method added since then is simply absent. Canvas compares the published
methods against `REQUIRED_BRIDGE_METHODS` and shows a stale-shell screen rather than silently doing
nothing when a method is missing. A host must implement all ten or expect that screen.

## Planner: `window.suitePlanner`

```ts
loadSnapshot(): Promise<Uint8Array | null>;
adopt?(snapshot: Uint8Array): Promise<void>;  // optional; a host that had a file never needs it
wasCreated?(): Promise<boolean>;   // optional; absent means false
commit(update: Uint8Array): Promise<void>;
onWorkspaceReplaced(listener): () => void;
onReminder(listener): () => void;
syncReminders?(reminders): Promise<{ permission: string; failure?: "schedule" }>; // optional; a host that schedules itself omits it
requestNotifications?(): Promise<string>; // optional; asks the platform once
onCommand(listener): () => void;
exportWorkspace(): Promise<ExportResult>;
importWorkspace(): Promise<ImportResult>;
info(): Promise<WorkspaceInfo>;
platform(): Promise<string>;
```

**`wasCreated` is the one to read carefully.** It was required, and that made the renderer
unhostable by anything that is not our preload, because a container handing over a document has no
"did I invent this" to report. It is optional now and absent reads as `false`, which sends the
person straight to the document instead of a start screen mobile should never see.

`loadSnapshot()` must return a **schema-initialised** snapshot. A raw `new LoroDoc()` is not enough
and produces an app that throws on first open. It is nullable for the same reason `wasCreated` is
optional: a container with no document has nothing schema-valid to hand over, and manufacturing one
would make the host own a domain's schema. `null` means "there is none", and the app calls
`WorkspaceDocument.create()` itself.

**`syncReminders` is how a phone gets a reminder that survives a closed app.** The renderer owns the
schedule because it owns the schema; the pack passes each pending reminder to the container's
`notifications` service, which hands it to the platform alarm. The desktop preload omits the member,
because the main process already schedules and can notify from the tray. A denial comes back as
`permission: "denied"`, and the renderer says reminders are blocked instead of going quiet. When
permission was granted but the platform refused an alarm, the result carries
`failure: "schedule"`, which the renderer reports as "could not be scheduled" rather than as a
blocked permission.

**`adopt` is what closes the loop, and it is not a convenience.** `commit(update)` carries what
happens _after_ creation. Measured: 98 bytes, and a replica rebuilt from it alone has
`meta === {}` — no schema, so the next launch throws. A host that answered `null` therefore receives
the document the app just made, once, before the person can edit it. A host that always had a file
from disk never implements it.

That asymmetry is the whole contract in one line: **the host may carry a document, so it must neither
create one nor be the only reason one is lost.**

A host that always has a file — Suite Desk always opens one — never returns `null`.

## Budget: `window.suiteBudget`

Nineteen methods, the widest surface of the three, because Budget owns a library of files rather
than one open document:

```ts
listBudgets()            createBudget(input)      openBudget(id)
closeBudget()            removeBudget(id)         revealBudget(id)
renameBudget(id, name)   importBudget()           openBudgetFile()
readImportSource()       loadSnapshot()           commit(update)
info()                   exportBudget()           exportRecords(format)
onBudgetReplaced(l)      onBudgetOpened(l)        onCommand(l)
platform()
```

`closeBudget()` is the one with no counterpart in the other two: Budget can hold no open document at
all, which is what its start screen represents. Its `loadSnapshot()` never returns `null`: it returns
bytes for the open budget or rejects because none is open.

## What a non-Electron host must supply

Regardless of shape, every bridge assumes the same four things:

1. **A snapshot in, updates out.** Planner's `loadSnapshot()` returns bytes, or `null` when there is
   no document yet; Budget's returns bytes and never `null`. `commit(update)` takes a CRDT update. The
   host never parses either.
2. **Replacement notification.** `onWorkspaceReplaced` / `onBudgetReplaced` fire when the host
   swaps the document underneath the renderer — an import, a sync arrival, a file reopened.
3. **Commands.** `onCommand` carries menu and accelerator intents. A host without a menu may
   register a no-op and lose only those.
4. **A platform string**, for diagnostics.

A host that supplies these can run a renderer. It must not expect to supply _only_ these, because
`importWorkspace` and `openFileDialog` are how a person picks a file, and a container needs its own
answer for that.

## Contract: `@suite/go`'s `install(host)`

The mobile container's `SuiteGoModuleRegistration.install(host)` is the seam this maps onto. It
receives a `ModuleHost` with `documents`, `storage`, `navigation`, `recents`, `files` and `theme`,
then installs whatever global the app expects, and returns its removal.

Nothing in this repository prescribes how that adapter is written. What this document does is name
the four assumptions above so an adapter author knows which parts of a bridge are load-bearing and
which are Electron ceremony.

## The MenuBar bridge (`menuBar`)

Mini-apps delegate top chrome to the host; the zones, the takeover rule and the vocabulary are in
[the menu bar reference](menu-bar.md). In a multi-app container such as Suite Desk tabs, the host
controls the physical application bar and the active mini-app populates semantic slots through this
bridge. **Desk's pack preload exposes it, and Desk consumes it.** Suite Go does not: it has no pack
tabs, so its shell draws its own bar.

The shipped shape is typed in `@suite/contracts/menu-bar`:

```ts
interface MenuBarBridge {
  /** Informs the container shell of active mini-app slots. */
  setSlots(slots: MenuSlots): void;
  /** Listens for a press on one of those slots. */
  onAction(listener: (action: MenuSlotAction) => void): () => void;
}
```

Two additions to the sketch this section used to carry, both learned from the packs:

- **`navigation` is a typed array of controls, not `unknown`.** A `unknown` slot would have meant the
  host learning each app's rendering, which is exactly the coupling the opaque ids avoid.
- **Every control may carry `help`.** It is the sentence a future explainer reads, and the reason the
  host must not interpret an id: one explainer that works in every app cannot rely on a host that
  knows what "explain mode" means.

A pack in a container publishes and draws nothing; a standalone pack renders `<MenuBar>` directly.
`menuBarBridge()` in `@suite/ui` answers which case it is in, from the presence of
`window.suite.menuBar`.

## Known inconsistencies worth resolving later

Listed rather than fixed, because fixing them is a cross-repo change with no current caller:

- **No shared marker.** Canvas has `host: "desktop"`; the other two have nothing. A host cannot tell
  a stale bridge from a current one for Planner or Budget.
- **No shared version handshake.** Canvas compares methods; the others assume a match.
- **Three different names.** `suiteDesktop`, `suitePlanner`, `suiteBudget`. Fine for Electron, more
  to document than necessary.
- **Platform arrives two ways.** Canvas exposes `platform` as a string property; Planner and Budget
  expose `platform()` as a promise, though it never changes after boot.
