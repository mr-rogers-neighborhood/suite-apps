# Planner inside Suite Go

Where this stands, what was proven, and what remains before it ships.

No Planner pack is committed here. The build that produces one and the bridge contract it needs are
proven; the open items below are what remains.

## Proven: the renderer builds as a web bundle

`pnpm planner:build` runs `planner.vite.config.ts`, which points Vite at
`apps/planner/src/renderer` and writes into `planner-dist`.

It succeeds with **no change to the Planner repository**: 2,572 modules, ~557 kB of JavaScript and the
3.6 MB Loro WASM. The renderer turned out to be a plain Vite app — no Node builtins, no Electron import,
and its only machine access is `window.suitePlanner` inside `bootDocument()`.

Two settings were needed and are worth remembering:

- `cacheDir` is redirected into `.vite-planner`, so building the mobile app never writes into
  the Planner checkout.
- `vite-plugin-wasm` resolves `loro-crdt`'s `.wasm`, and `optimizeDeps.exclude` keeps it from being
  pre-bundled and losing its URL.

## The blocker: the first document

`bootDocument()` does this:

```ts
const bytes = await bridge.loadSnapshot();
const replica = new DocumentReplica(WorkspaceDocument.fromSnapshot(bytes));
bridge.onWorkspaceReplaced((snapshot) => replica.replace(snapshot));
```

`fromSnapshot` expects a **schema-initialised** snapshot — meta and settings written by
`WorkspaceDocument.create()` in `@suite/planner-core`. An empty or raw `new LoroDoc()` snapshot is not
enough, and a bridge that hands one over produces an app that throws on first open.

The obvious fix — import `@suite/planner-core` from the mobile app — is the wrong one. It would make
this app's typecheck and build depend on a sibling checkout that the mobile build does not own. The
mobile build would only work on a machine that also had Planner's source.

## The decision: `loadSnapshot()` may return `null` (this replaced the fixture)

An earlier version of this page decided to **ship a seed snapshot as a fixture**, because the bridge
had no way to say "there is no document yet". That is no longer necessary:

- `apps/planner/packages/core/src/ports.ts` now declares `loadSnapshot(): Promise<Uint8Array | null>`.
- `bootDocument()` calls `WorkspaceDocument.create()` when it receives `null`.
- [The bridge reference](../../../../docs/reference/bridges.md) documents the nullable contract,
  and [`loadsnapshot-proposal.md`](loadsnapshot-proposal.md) — the request that asked for it — is landed.

So the fixture is gone, and so is its cost. Points 1–3 of the old decision are withdrawn:

1. No `.planner` seed is committed anywhere. The container carries no domain artifact, so nothing goes
   stale when Planner's schema moves.
2. There is no first-run special case. **`DocumentStore.create()` returns `bytes: new Uint8Array(0)`**
   (`src/host/documents.ts:101`), so the bridge's rule is exact and testable: an empty payload
   means `null`, and Planner creates its own schema-initialised document.
3. This app still keeps no dependency on Planner's source — by construction, not by carrying data.

A second consequence, not visible when the fixture was decided: **the pack owns the document.**
Planner's bridge only offers `commit(update)`, and desktop main is what applies updates and writes the
file. A pack has no main, so the bridge prelude holds the `LoroDoc`, applies each update, and writes a
snapshot at the durability boundaries (foreground loss, leave, close). Writing an _update_ as the whole
file would corrupt the document; writing per keystroke is the amplification the durability boundary refuses.

## Still to decide after that

- **CSS isolation: decided — own document.** The Planner bundle ships Tailwind, whose preflight is
  global, so it cannot share the shell's document without restyling the shell. Planner therefore mounts
  as an isolated pack (`./planner/index.html` with a bridge prelude on `@suite/go`'s `createFrameHost`),
  which is also what makes the container stay domain-blind.
- **Layout: decided — the rail collapses below `md`.** At 768 px and wider the shell keeps its
  three panes exactly as before. Below that, `Sidebar` is not rendered and the same navigation rides
  in a drawer opened from a header button, so the day view takes the full width; `DayCalendar`
  still appears only at `lg`. `apps/planner/e2e/mobile-layout.spec.ts` asserts, at 360, 390 and
  430 px, that the rail takes no horizontal space and `scrollWidth <= clientWidth`.
  `@suite/theme`'s density axis (v0.16.0) fixes control size, not layout, so this breakpoint is
  still Planner's own.
- **Reminders.** `onReminder` has no notification plugin yet; the bridge returns a no-op unsubscriber
  and the UI says so rather than silently dropping them.
