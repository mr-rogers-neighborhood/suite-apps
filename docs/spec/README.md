# Suite superapp specification

Status: **draft 0.1**. The normative text is [superapp.md](superapp.md); the machine-readable manifest
is [manifest.schema.json](manifest.schema.json); what actually exists is [ledger.md](ledger.md).

This is the contract for a local-first superapp: a host that runs signed packs, keeps the user's
document on the user's device, and treats every server as an optional peer. It borrows the ergonomics
of the W3C MiniApp model and the guarantees of local-first software, and resolves the places where
they disagree.

## The model in one page

- A **host** installs, verifies, sandboxes and renders packs. It brokers capabilities and documents; it
  never parses an app document.
- A **pack** is a signed web bundle with a manifest, capabilities, optional widgets and optional
  subpackages or add-on dependencies. It runs in its own origin and session.
- A **document** is a file the user owns, kept in the suite document layer on the device. It is the
  primary copy; sync moves sealed updates, never authority.
- A **blob** is pack-owned media or derived data. It is an `asset`, `derived` or `cache`, and the class
  decides whether it is exported and backed up.
- A **relay** is a cloud peer. It stores sealed frames, forwards them and holds no document, no keys
  and no truth.
- A **catalogue** is an optional signed index with review attestations. It recommends; it does not
  gate. Side-loading is always first-class.

## Where the papers disagree

| Question | W3C MiniApp | Local-first | This spec |
| --- | --- | --- | --- |
| Where authority lives | Platform | User's device | Device owns the document; the host is a broker |
| Identity | Platform account | No account | L0 device key, L1 pack profile, L2 portable key |
| Distribution | Platform store and review | User control | Side-load first; an optional curated catalogue |
| Permissions | Developer approval + user prompts | User agency | Manifest declaration + install/first-use/per-use consent |
| Widgets | Code in the host | Not specified | Declarative baseline; sandboxed code by profile |
| Add-ons | Silent auto-update | Signed bytes | Pinned signed modules; registry is opt-in |
| Data sharing | Platform APIs | No ambient access | Explicit handles; opt-in metadata index |
| Revocation | Platform can disable | Longevity | Advisory; blocks new installs, never silently disables |
| History | Platform keeps it | Branches and review | Full branch model, staged conformance |
| Servers | Required | Optional peers | Relay/backup/discovery/bridge; never the truth |

## What the spec decides

- A pack is signed, hashed, capability-scoped and refused when a host does not implement what it asks
  for. Unknown manifest fields are refused, not ignored.
- User documents go through the suite document layer. Pack-owned blobs are `asset`, `derived` or
  `cache`; `asset` is exported and backed up, `derived` is backed up, and `cache` is disposable.
- Sync is a user-run relay of sealed frames with version-vector negotiation and gap recovery. No
  server-originated document write. Background refresh is opt-in; a push is a signal, not data.
- Widgets are declarative by default. A pack may ship a sandboxed code widget, but must also ship a
  declarative fallback. Widget data is a projection, a scoped subset, or `full` by explicit grant.
- Add-ons are separately signed modules pinned by id, version and hash. They never update themselves.
- Native surfaces are declarative host components with a declared `web` or `none` fallback. There is
  no arbitrary native view.
- Branches are a first-class app-level model over Loro forks: private drafts, suggestions, shared
  branches, review and merge. A shared branch inherits the document's membership.
- Longevity is a test, not a slogan: export every user document and asset, install and run offline,
  and keep working with all servers off.

## How to read

1. [superapp.md](superapp.md) is normative. `MUST`, `SHOULD` and `MAY` follow RFC 2119.
2. [manifest.schema.json](manifest.schema.json) is the machine-readable pack manifest.
3. [ledger.md](ledger.md) maps each section to `implemented`, `partial`, `absent` or `future`. A
   written clause is a target, not a claim about the tree.
4. `pnpm spec:check` checks the schema, the fixture and the ledger coverage.

The papers are W3C, *MiniApp Standardization White Paper* v2 (2026), and Kleppmann et al.,
*Local-First Software: You Own Your Data, in spite of the Cloud* (Onward! 2019). Loro supplies the
document primitives; its version-control layer is app-level, not a branch API.
