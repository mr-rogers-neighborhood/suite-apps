# Planner inside Suite Go

Where this stands, what was proven, and what remains before it ships.

Planner is wired as the first real domain pack. The renderer is built from Planner's own source,
the pack's prelude installs `window.suitePlanner` on `@suite/go`'s frame client, and the pack owns
the `.planner` document. `pnpm planner:pack` produces the signed pack; it is not committed.

## The renderer builds as a web bundle

`pnpm planner:build` runs `planner.vite.config.ts`, which points Vite at
`apps/planner/src/renderer` and writes into `planner-dist`.

It succeeds with **no change to the Planner repository**: 2,671 modules, ~582 kB of JavaScript and
the 3.6 MB Loro WASM. The renderer is a plain Vite app — no Node builtins, no Electron import, and
its only machine access is `window.suitePlanner` inside `bootDocument()`.

Two settings are needed and are worth remembering:

- `cacheDir` is redirected into `.vite-planner`, so building the mobile app never writes into the
  Planner checkout.
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

- `apps/planner/packages/core/src/ports.ts` declares `loadSnapshot(): Promise<Uint8Array | null>`.
- `bootDocument()` calls `WorkspaceDocument.create()` when it receives `null`.
- [The bridge reference](../../../../docs/reference/bridges.md) documents the nullable contract,
  and [`loadsnapshot-proposal.md`](loadsnapshot-proposal.md) — the request that asked for it — is landed.

So the fixture is gone, and so is its cost:

1. No `.planner` seed is committed anywhere. The container carries no domain artifact, so nothing goes
   stale when Planner's schema moves.
2. There is no first-run special case. **`DocumentStore.create()` returns `bytes: new Uint8Array(0)`**
   (`src/host/documents.ts:101`), so the prelude's rule is exact and testable: an empty payload means
   `null`, and Planner creates its own schema-initialised document.
3. This app still keeps no dependency on Planner's source — by construction, not by carrying data.

## The pack owns the document

Planner's bridge only offers `commit(update)`, and desktop main is what applies updates and writes
the file. A pack has no main, so `planner/prelude.ts` holds the `LoroDoc`, applies each update, and
writes a **snapshot** at the durability boundaries: foreground loss, leaving the module, and closing
the app. Writing an _update_ as the whole file would corrupt the document; writing per keystroke is
the amplification the boundary refuses.

The shell cannot write a pack's document — that is the container's first rule — so it asks. A
generic `flush` control goes parent-to-pack on the frame protocol; the pack answers only after its
handlers settle, and `IsolatedModule` awaits that answer on leave. The control ids are negative so a
reply cannot be mistaken for a reply to one of the pack's own requests. See
[Domain packs](packs.md#the-durability-boundary).

## CSS isolation: own document

The Planner bundle ships Tailwind, whose preflight is global, so it cannot share the shell's
document without restyling the shell. Planner therefore mounts as an isolated pack
(`planner-dist/index.html`, with the prelude written by `scripts/planner-pack.mjs`), which is also
what makes the container stay domain-blind.

The generated entry carries the pack's own CSP: `default-src 'self'` and `connect-src 'self'`.
`'none'` would blank the frame because Loro fetches its own wasm. The prelude's wasm is emitted as a
file beside the module rather than inlined as a `data:` URL for the same reason.

## Layout: the rail collapses below `md`

At 768 px and wider the shell keeps its three panes exactly as before. Below that, `Sidebar` is not
rendered and the same navigation rides in a drawer opened from a header button, so the day view takes
the full width; `DayCalendar` still appears only at `lg`. `apps/planner/e2e/mobile-layout.spec.ts`
asserts, at 360, 390 and 430 px, that the rail takes no horizontal space and
`scrollWidth <= clientWidth`. `@suite/theme`'s density axis (v0.16.0) fixes control size, not layout,
so this breakpoint is still Planner's own.

## Build and install

```sh
pnpm planner:pack                # renderer + prelude + signed pack in .dev/planner.pack
pnpm android:install             # the shell; the pack is installed separately until there is an install screen
```

`pnpm planner:pack` signs with `SUITE_PACK_KEY`, `--key`, or the key at
`~/.config/suite/keys/pack-key`. The public half is `SUITE_PACK_PUBLIC_KEY` in
`packages/pack/src/pinnedKey.ts`, the one pin every host imports; `PACK_PUBLIC_KEY` in
`apps/go/src/host/packs.ts` only re-exports it. A rotation edits that shared pin and rebuilds every
pack — editing the re-export would reintroduce a second trust source. `pnpm keys status` says whether
the key on this machine agrees with the pin — a pack signed by any other key is refused on the device
as `untrusted`. The key was rotated when this pack was wired, because the earlier one had no private
half anywhere; [Manage signing keys](../../../../docs/how-to/keys.md) records where the replacement
lives and how the next rotation works.

## Reminders

The renderer owns the schedule, because the renderer owns the schema: it derives the pending
reminders with `pendingReminders` in `@suite/planner-core` and hands them to the bridge through
`syncReminders`. The desktop preload does not implement that member, because its main process already
schedules from the document and can notify while the window is hidden.

In the pack, the prelude asks the container's `notifications` service — the `notifications`
capability — which passes each reminder to the phone's own alarm clock through
`@capacitor/local-notifications`. Two details make it behave: cancelling a reminder that is no longer
pending is what stops a completed or deleted task from still ringing, and a permission the person
denied comes back to the UI as a notice instead of silence. Past-due times are never scheduled; a
platform alarm handed a time in the past fires immediately.

The renderer records the first ask in `settings.notificationsAskedAt`, so a permission the person
revoked is reported rather than prompted for again on the next edit.

Import and export go through the container's `files` service: `pickOpen` returns the bytes of a
`.planner` file the person chose, and `share` hands the current snapshot to Android. Neither side
learns a path. The pack declares `documents`, `files`, `recents` and `notifications` at contract 3 —
the version that serves the file store — in `planner/pack.json`, which the build and the bridge test
read from the same file. A host older than contract 3 refuses the pack rather than accepting it and
silently dropping the alarm or the import.
