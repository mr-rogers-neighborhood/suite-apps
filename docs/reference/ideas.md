---
audience: developer
---

# Ideas

The planning tracker: what the suite is considering, in three horizons. It is not a reference page and
it does not own a fact. A row records an intention; the page or decision it links to owns the detail,
and that owner wins if the two disagree. The repository otherwise does not add pages to the reference
archive ([editing rules](../README.md#editing-rules)); this one is planning, not a new explanation.

## Now

| Idea | Why it matters | Owning app or package | State | Source |
| --- | --- | --- | --- | --- |
| Prove the friend-code trust loop across Canvas and Planner | A contact is a trust decision. If one app admits a stranger or refuses a known person, the failure is silent; both apps need the same check for add, forget, a signed invitation and an unknown code. | `@suite/sync`, Canvas and Planner main processes | Shipped in both apps; a cross-app parity test runs in the shared desktop-sync core | [Sync decisions](../../services/relay/docs/reference/decisions.md), [Planner's Sync](../../legacy/planner/docs/reference/sync.md), [Status](status.md) |
| Offer the friend link or QR in the Sync dialog | The protocol parses `suite://friend?c=…&k=…`, and only the text code is shown. A scan would carry the public key and complete a contact on the spot instead of waiting for the first invitation. | `@suite/sync`, Canvas and Planner Sync dialogs | Shipped in both apps | [Sync decisions](../../services/relay/docs/reference/decisions.md), [Protocol](../../services/relay/docs/protocol.md#friend-codes-and-signed-invitations) |
| Planner alpha hardening | The core loop works; the editing surfaces and rituals are still changing shape. Alpha needs the daily path to hold before the tier is promised. | `legacy/planner` | Bar written; unit gaps closed, the human end-to-end, relaunch, phone-width and device runs remain | [Alpha bar](../../legacy/planner/docs/reference/alpha.md), [Status](status.md), [Channels](../explanation/channels.md) |
| Budget alpha hardening | The core loop, targets, rules, schedules, import and reports are in place in the frozen app and its pack. Alpha needs the envelope and register rules to stay fixed under load. | `packs/budget/pack`, `legacy/budget` | Pre-alpha | [Budget](../../legacy/budget/README.md), [Status](status.md), [Channels](../explanation/channels.md) |
| Prove the shipping pack with Budget | A pack counts only when a real shipping app runs as a signed pack with its documents and consented export/import. Budget is the first witness; Canvas, Planner and Help stay separate Flatpaks until each passes. | `packs/budget/pack`, `hosts/desk`, `@suite/pack` | Open headlessly: the entry serves, the renderer mounts, a document round-trips through the envelope and an export re-imports. A person's window pass and a release-archive install remain | [Shipping packs](decisions.md#shipping-packs) |
| Keep the cross-app docs baseline current | No module has a person's review yet, and the largest unprose modules are Canvas and Help internals. The baseline makes the gap visible without closing app-owned pages from this lane. | `docs/`, `legacy/help` | Baseline recorded below; review not started | [Help](../../legacy/help/README.md), [Status](status.md) |
| Reconcile the sync threat model with friend codes | The threat model still says a friend-code or contacts exchange is not built, while the protocol and both apps ship one. The sync lane owns that page. | `services/relay` docs | Open, app-owned | [Threat model](../../services/relay/docs/threat-model.md) |

## Next

| Idea | Why it matters | Owning app or package | State | Source |
| --- | --- | --- | --- | --- |
| Decide whether contacts should cross apps | Each app keeps its own `sync/contacts.json`, so the same person is added twice. A shared trust store would cut that friction, but it moves a trust decision across the per-app boundary. | `@suite/sync`, Canvas and Planner main processes | Decision open; one file per app today | [Sync decisions](../../services/relay/docs/reference/decisions.md), [Planner's Sync](../../legacy/planner/docs/reference/sync.md) |
| Bring contact management to Planner's device list | An owner removes a device through Canvas or the relay's tools today; Planner's dialog only lets this copy leave. The friend list should make the same management reachable where the person is. | `legacy/planner`, `services/relay` | Open | [Planner's Sync](../../legacy/planner/docs/reference/sync.md) |
| Start the first human review pass on module prose | `docs:coverage` counts generated prose separately on purpose. A reviewed module is the first one a reader can trust without checking the code; the largest gaps are the natural starting points. | `docs/modules/`, `legacy/help` | Not started (0/118 reviewed) | [Help](../../legacy/help/README.md), [Coverage baseline](#coverage-baseline) |
| Run the first conformance pass against the superapp spec | The [ledger](../spec/ledger.md) names the blocking gaps: the signed envelope, publisher trust, document envelope, consent, relay verification and export. A first pass should prove one of them end to end. | `docs/spec`, `packages/pack`, `hosts/desk`, `services/relay` | Open | [Spec](../spec/README.md), [Ledger](../spec/ledger.md) |
| Offload heavy builds and runtimes | The gate's Electron e2e, the Android emulator, macOS/iOS builds and long agent sessions all compete with the workstation. GitHub Actions covers macOS/Linux/Windows builds and the independent gate (once the owner's account issue is fixed), Revyl covers iOS/Android runtimes, and AWS keeps the store and can host a paired Orca server — on demand, without making the local machine depend on them. | `hosts/*`, `legacy/*`, delivery | Epic filed; nothing built | [Epic #169](https://github.com/mrrnbhd/suite-apps/issues/169) |
| A persistent notification as the Android sync surface | Sync is most useful when it is visible without opening the app, and Android can pin a persistent notification that carries state and offers capture. It is an enhancement, not a first requirement, and iOS has no equivalent that can be pinned the same way, so the two hosts would differ on purpose. | `hosts/go`, `services/relay` | Idea only; not scheduled | [Sync as a host capability](https://github.com/mrrnbhd/suite-apps/issues/315), [Retiring the Sync tray app](decisions.md#retiring-the-sync-tray-app-315) |

## Someday

| Idea | Why it matters | Owning app or package | State | Source |
| --- | --- | --- | --- | --- |
| Revisit the renderer split only if it stops paying | The bet is one sandboxed renderer per app, not one container window: separate crash, memory and accessibility boundaries. Sharing chrome is the gain that would test the bet, and it has not outweighed the boundaries yet. | `@suite/desktop`, `docs/explanation/architecture.md` | Decided; revisit on evidence | [Architecture](../explanation/architecture.md#why-not-one-container-window), [Decisions](decisions.md#desktop-host) |
| Give every module a person's review | Generated facts are honest but thin. Reviews are the step that turns the explorer into prose a person can rely on; the baseline shows how far that is. | `docs/modules/`, `legacy/help` | Not started | [Coverage baseline](#coverage-baseline) |
| A person-run directory of friend codes? | Deliberately absent: a code resolves through each app's contacts file, never a lookup service. Reopening it would need a product decision, because it changes the trust model and adds a service to run. | `@suite/sync` | Rejected today; revisit only with a decision | [Sync decisions](../../services/relay/docs/reference/decisions.md), [Local-first](../explanation/local-first.md) |

## Parked themes

A theme stops being work when nothing in the tree can act on it. It is recorded here with the reason,
and its issues are closed as not planned rather than left open as a promise. The closed issues keep
their bodies, so the detail is still one click away.

| Theme | What it was | Why parked | Where it lives |
| --- | --- | --- | --- |
| Slopmaster 9000 | A factory that builds a session artifact from a change and hands it to a person to try: a session runner, an agent roster in configuration, machine-readable gate results in a spool, a hook plugin that refuses pushes and key reads, and a `slop` artifact produced from a build. | It was parked `blocked:awaiting-alpha`, and the later channel work (`slop` → `nightly` → `preview` → `stable`) already covers the part a person uses: a slop build is a local `--channel slop` install, and promotion is a boundary with checks, not a factory. | Closed issues #53–#75 on the tracker |

## Coverage baseline

Snapshot from `mise exec -- pnpm docs:coverage` after `mise exec -- pnpm docs:index` on 2026-11-21. The
command reports and never fails on a gap; re-run it rather than trusting a stale number.

| Measure | Baseline |
| --- | --- |
| Modules reviewed by a person | 0/118 |
| Modules with generated prose | 46/118 |
| Files with a note | 131/1838 (7%) |
| Symbols with a note | 195/10094 (2%) |
| Written tours reviewed by a person | 0/13 |
| Generated tour steps with a note | 147/147 |

The largest modules with no prose are `packs/canvas/packages/import-obsidian` (143 symbols), the Canvas
graph publish package (125), `legacy/help` (121), `legacy/help/src/renderer` (120) and
`packs/canvas/src/library` (114). The help and Canvas rows are the densest, but they are app-owned
prose: this pass records them and does not write app module notes.
