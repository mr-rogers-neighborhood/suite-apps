# Design direction

Suite is a local-first canvas over a workspace of typed cards. One Loro document holds the whole workspace, the browser edits it offline, and an optional sync through a host one device runs keeps copies in step. A card exists on its own, and a board is a context that shows some of those cards at chosen positions.

Two rules decide most questions here. The document is the only source of truth, and anything that can be recomputed from it is not stored.

## The document

`WorkspaceDocument` in `packages/graph/src/loro/` wraps a single `LoroDoc`. Inside it, `cards`, `boards`, `placements`, `sections`, `types`, `tags`, `edges`, `views` and the per-card `titles` and `content` containers are Loro maps, keyed by id. Loro merges concurrent edits, and every write goes through a Zod-validated method on that wrapper, so no component touches raw CRDT calls.

Field granularity is what makes that merge useful. A property write sets one key in `card.properties`, a section move writes `x` and `y`, a tag add writes one key. A whole-record write would turn every unrelated concurrent edit into a last-write-wins conflict that nobody sees happen.

Stored facts are the ones a reader authored: identity, types, property values, tags, body text, placement geometry, board and section names, style rules. Everything else is derived at read time. Home board, section membership, display titles, reference counts and view results are computed from those facts, and a stored copy would be a cache with an invalidation problem.

Presence is separate from the document. Pointer, drag, marquee and connector movement travel over Loro `EphemeralStore` channels with a time to live, so a dropped connection cannot leave a ghost drag. A position is persisted on release, which is the moment the reader has decided.

## Projections

A projection is a read: a function from document state to something a surface draws, with no write back. The board face is a projection of placements through the placement and section code. The outline rail is a projection of section containment. `referencesFor` is a projection of mention nodes and card-valued fields. A share link would have served a projection built from an allowlist, keeping the index of every title private; there is no share link, because sharing is an invite to the running workspace or the exported file. [Decisions](../reference/decisions.md#sharing) records what replaced the hosted tier.

A projection may be cached only if it can be thrown away and rebuilt from the document. The reference index qualifies because it is recomputed from content. View results do not qualify and are not stored.

A projection that changes something is an explicit command with a name and a report of what it touched. Promoting a selection into a view, applying a section as tags, publishing a card: each is idempotent and reports its changes. Nothing runs a loop that rewrites cards because layout moved.

Splitting the workspace into one index document plus a document per card would buy isolated loading and per-card access control, and it would cost cross-document atomicity. Loro has no multi-document transaction, so creation order, trash retention and purge tombstones become a convergent sequence, and undo splits by scope. The split waits for a benchmark that asks for it and stays behind the `WorkspaceDocument` seam until then.

## Nested boards

A portal is a card whose primary type is the portal type and whose board property names another board. It is a card like any other: it is placed, tagged, searched and trashed by the same code, and the one thing it adds is a second board. On the board that holds it, a portal draws a live outline of the board it names, built from that board's placements and links. When the named board has a cover picture, the picture is drawn in place of the outline.

Opening a portal is a camera gesture: zoom into the card until it covers most of the canvas and its board replaces the one on screen. A board entered that way is left by zooming back out. The trail beside the tab strip lists the boards the reader passed through, and every step on it switches to that board with the viewport it had. The trail records history rather than ancestry: it is the order boards were left in, so a board reached from a tab and a board reached from a portal both appear on it, and the same board may appear more than once.

One board can be named by portals on several boards, and by more than one portal on the same board, so the shape is a directed acyclic graph rather than a tree. No board has a parent. Deleting a board does not delete the portals that name it: each portal's board property is cleared in the same commit, and the card stays on its board as a card that names no board.

## What is settled

| Question | Decision |
| --- | --- |
| Where truth lives | One Loro document per workspace, observed and mutated by clients; the host carries sealed frames it cannot read |
| What a board is | A named context showing placements of cards it does not own; removing from a board is not deleting |
| How a card is classified | One primary type plus supertags, with the other types unioning their fields |
| How cards relate | References derived from `@` mentions and card-valued fields; edges carry no data |
| How a section is defined | A named region whose membership is the smallest containing header anchor |
| How sharing works | An invite into the workspace one device runs, or an exported file; no share link exists |
| What owns the shell's colour | Style rules stored in the document and resolved through the contrast floor; the shell never holds a palette |
| How many inspectors | One panel driven by the selection, opened from the canvas or a library row |
| What a template is | A creation recipe duplicated on use; a type blueprint is itself a card |
| What a tutorial is | A card whose body holds tour steps, presentable on the canvas |
| Which field kinds compose | `rating`, `group` and `list` compose from the built-in kinds |
| What a workspace with no session may do | It edits and exports with no account; joining sync needs an invite from the device that runs the workspace, because the host cannot attribute updates otherwise |
## What is not settled

| Question | Where it stands |
| --- | --- |
| Document split | Waiting on a benchmark: one index document plus per-card documents, with the crash and undo costs above |
| Search | An in-memory index over summaries first; body search would load card documents, because a central index conflicts with per-card access and offline use |
| Card document retention | Trash retains content and purge tombstones first, while an offline client may still resurrect a purged record |
| Publishing | Serving a workspace as a site, with routes, slugs and navigation, is not built; the draft plan in `packages/graph/src/publish/` has no surface yet |

## Judging a proposal

Four questions settle most of them.

- Which word in the [glossary](../reference/glossary.md) does this change, and does it stay inside that word's scope?
- Is the new value stored, or can it be recomputed from what is already stored?
- What happens when two clients write at once: does the write land on a leaf field, or replace a record?
- Does it survive offline use, or does it need a round trip before the reader sees the result?

A proposal that cannot answer the second and third is not a design yet. The layer map, the data flow and the record shapes are in [reference/architecture.md](../reference/architecture.md); the editing surfaces are in [reference/editing.md](../reference/editing.md) and [reference/ui.md](../reference/ui.md).
