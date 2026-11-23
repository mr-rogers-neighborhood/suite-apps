# Decisions

The rules that shape Canvas. The architecture and data model pages describe how they are implemented.

## Document

- One Loro document per workspace. Every write goes through `WorkspaceDocument` and is validated by
  the Zod schema in `@suite/graph`.
- Writes are field-granular. A change sets the leaf keys it touched, never a whole record.
- Document truth never lives in Zustand, React state or localStorage. Zustand holds UI state only.
- Persistence is a snapshot plus an update log, compacted by one leader per workspace.
- A schema change is additive first; a breaking change bumps the version and migrates.

## Model

- A workspace owns cards; a board is a view of placements; a placement is not a card.
- Removing a card from a board is not deleting it. Trash is workspace-level.
- A card has one primary type plus optional supertags. Tags are schema-free; fields belong to types.
- Section membership is derived from geometry, never written onto a card.
- A view is a read-only query. Changing a card may change a view; a view never writes a card.
- A template is instantiated, not linked.
- Derived facts are never stored as authority: home board, section membership, view results,
  backlinks, display title.

## References

- A mention or a card-valued property is workspace truth. An arrow is a drawing on one board.
- A backlink is derived from references, never mirrored onto a card.
- There is no typed-link registry. A property's name carries the meaning.
- Links are routes with two anchors and a path mode. A link carries no data.

## Editing

- One inspector, driven by the selection.
- One style vocabulary over the edges of a surface. Style is derived, not configured.
- Placement is a mode. The cursor says which mode is active.

## Sharing

- The hosted tier is gone from the tree, not moved: there is no collab server, no account service, no
  billing service, no control plane and no hosted build. There is no share link either, so nothing
  resolves a `?share=` address.
- What ships is a local document plus opt-in sync. One device runs the workspace and a `suite-sync` host
  carries the frames; another device joins with an invite. Sharing is that invite, or the exported
  file. Roles are owner, editor and viewer; the Canvas UI may expose only editor and viewer.
- Sync sends sealed frames. Group keys live in each member's main process, so the host stores frames
  it cannot read and signed records that name a device and a role, never the document.
- A removed device is revoked: the group moves to a new epoch, so the removed copy cannot read
  anything new. Membership is the authority, not an account.

## Non-goals

- No CMS in the core: no routes, slugs, templates or site trees as card properties.
- No infinite canvas as the whole model; Sketch and Portal cover drawing and navigation.
- No no-code dataflow layer.
- No plugin API before the object model settles.
- No stored view results or section membership.
- No type inheritance.

## Verification

- The gate is local: `pnpm check` for the edit loop, `pnpm verify` for the full local gate.
- E2E runs on request, not per change.
