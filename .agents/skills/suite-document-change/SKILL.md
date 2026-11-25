---
name: suite-document-change
description: Change a Suite app document safely. Use for Loro schema, records, migrations, persistence, replicas, snapshots, file formats, or UI state that reads document data in Planner, Budget, or Canvas.
---

# Change the document layer

One Loro CRDT document is the source of truth for a workspace. The document layer owns it; the UI
projects it. Follow the app's `AGENTS.md` and `docs/reference/decisions.md`.

## The path

1. `schema.ts` — add the type and its Zod schema with tests. Schema changes are additive first.
2. `WorkspaceDocument` / `BudgetDocument` / graph facade — add typed accessors and mutations.
3. Record mapper — one function per entity, parsing with Zod before writing.
4. Snapshot projection — a pure read that produces the view model.
5. UI — consume the snapshot; never read or write the document directly.

Anchors:

- Planner core: `packages/planner-core/src/loro/`
- Budget core: `packs/budget/packages/core/src/loro/`
- Canvas graph: `legacy/canvas/packages/graph/src/loro/`
- Shared replica/store: `packages/document-runtime/src/replica.ts`, `src/node/store.ts`
- Shape checks: `legacy/{planner,budget,canvas}/scripts/check-shape.mjs`

## Invariants

- One writer per workspace. The main process owns the authoritative document in Planner and
  Budget; the renderer is a replica and forwards updates.
- No raw Loro import outside the document package. Canvas: no raw writes to graph roots outside
  `packages/graph`.
- Document truth never lives in Zustand, React state, or `localStorage`. Those hold UI state only.
- Only the declared observe site calls `observe()`. Do not add a second one.
- Parse every record with Zod on read and write. Write only the changed keys on a mergeable map so
  concurrent edits merge instead of clobbering a record.
- A replica sets a fresh peer id so its first edit cannot collide with the snapshot's author.
- Migrations run in `fromSnapshot` before any caller reads a record. An unsupported newer schema or
  format is a refusal, not a silent fresh document.
- Canvas browser persistence is IndexedDB snapshot + update log; desktop persistence sends whole
  snapshots to main and main owns the file, lock, backups, and mtime guard. Do not add a third path.

## Verify

- Schema tests, a migration test, and a file round-trip.
- The app's shape check, then the owning gate row (`node scripts/gate.mjs --only <row>`).
- For a visual behaviour, a Storybook story and a component test where non-trivial.

If a schema change needs a decision record, update the owning `decisions.md` in the same change.
