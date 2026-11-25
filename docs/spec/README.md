---
audience: developer
---

# Suite superapp specification

Status: **draft 0.1**. The normative text is [superapp.md](superapp.md); the machine-readable manifest
is [manifest.schema.json](manifest.schema.json); the catalogue index is
[catalogue.schema.json](catalogue.schema.json); the fixture corpus is [fixtures.json](fixtures.json);
what actually exists is [ledger.md](ledger.md). [AGENTS.md](AGENTS.md) is the reading order for an
agent.

This is the contract for a local-first superapp: a host that runs signed packs, keeps the user's
document on the user's device, and treats every server as an optional peer. It borrows the ergonomics
of the W3C MiniApp model and the guarantees of local-first software, and resolves the places where
they disagree.

It is also an explicit exception to "docs describe the tree as it is." The spec is a target; the
ledger is the evidence. Do not change a clause to match the code, and do not mark a clause implemented
without a test or a named gap.

## The model in one page

- A **host** installs, verifies, sandboxes and renders packs. It brokers capabilities, envelopes and
  document bytes; it never interprets an app document payload.
- A **pack** is a signed web bundle with a publisher, a manifest, capabilities, optional widgets and
  optional subpackages or add-on dependencies. It runs renderer-only, scoped by publisher and id.
- A **document** is a file the user owns, kept in the suite document layer on the device. The host
  owns the envelope, atomicity, lock and backup; the pack owns the schema, migrations and projections.
- A **blob** is pack-owned media or derived data. It is `asset`, `derived` or `cache`; `asset` is
  exported and backed up, `derived` is backed up, and `cache` is disposable.
- A **relay** is a cloud peer. It stores sealed frames, verifies what it can, and holds no document,
  key or truth.
- A **catalogue** is an optional signed index with review attestations. It recommends; it does not
  gate. Side-loading is always first-class.

## Where the papers disagree

| Question | W3C MiniApp | Local-first | This spec |
| --- | --- | --- | --- |
| Where authority lives | Platform | User's device | Device owns the document; the host is a broker |
| Identity | Platform account | No account | First-party pin + opt-in publishers; device → pack key → portable key |
| Distribution | Platform store and review | User control | Side-load first; an optional curated catalogue |
| Permissions | Developer approval + prompts | User agency | Manifest declaration + install/first-use/every-use/token consent |
| Widgets | Code in the host | Not specified | Declarative baseline; sandboxed code with a fallback |
| Add-ons | Silent auto-update | Signed bytes | Separately signed, pinned modules; no self-update |
| Data sharing | Platform APIs | No ambient access | Explicit handles; opt-in metadata index |
| Revocation | Platform can disable | Longevity | Signed advisory; blocks new installs, never silently disables |
| History | Platform keeps it | Branches and review | Full branch model over Loro forks, staged conformance |
| Servers | Required | Optional peers | Relay/backup; never document truth; distribution is separate |

## What the spec decides

- A pack is signed by a publisher key, hashed file by file, closed to unknown fields, and refused when
  a host does not implement a required capability.
- User documents go through a host-owned envelope; the pack owns the schema and runs migrations and
  projections. Pack-owned blobs are `asset`, `derived` or `cache`.
- Sync is a workspace MLS group with per-document content keys. The relay verifies and orders signed
  records, keeps a content-free header index, and recovers a lagging device from a peer snapshot.
- A push is a signal, not data. Background refresh is opt-in; correctness never depends on it.
- Widgets are declarative by default. A sandboxed code widget must ship a fallback. Widget data is a
  projection, a scoped subset, or `full` by explicit grant.
- Native surfaces are declarative host components with a `web` or `none` fallback. There is no
  arbitrary native view.
- Branches are a first-class app-level model: private drafts, suggestions, shared branches, review and
  merge. A shared branch inherits the document's grants.
- Longevity is a test: export every user document and asset, install and run offline, and keep working
  with all servers off.

## Source map

| Fact | Owner |
| --- | --- |
| Normative host/pack/relay behavior | [superapp.md](superapp.md) |
| Packaging, channels, signing, release | [delivery.md](delivery.md) |
| Pipeline, gates, merge queue, runners | [ci.md](ci.md) |
| Platform tiers and lifecycles | [platforms.md](platforms.md) |
| App, package and pack layout | [repo-structure.md](repo-structure.md) |
| Manifest fields and enums | [manifest.schema.json](manifest.schema.json) |
| Positive/negative examples | [fixtures.json](fixtures.json) |
| What exists | [ledger.md](ledger.md) and [status](../reference/status.md) |
| Why a rule exists | [decisions](../reference/decisions.md) and app decisions |
| Release channels and Flatpak | [channels](../explanation/channels.md), [packaging](../reference/packaging-channels.md) |
| App schema, UX and migration | the app's own `docs/` beside its code |
| Accessibility evidence | [WCAG map](../reference/accessibility/wcag-22-map.md) |
| Engineering style and gate | [standards.md](standards.md), app `AGENTS.md` |
| Governance, licensing, disclosure | [governance.md](governance.md) |

## How to read

1. [superapp.md](superapp.md) is normative for the product contract. Every rule has a stable ID
   (`S4.2`).
2. [delivery.md](delivery.md), [ci.md](ci.md), [platforms.md](platforms.md) and
   [repo-structure.md](repo-structure.md) own packaging, the pipeline, the platform matrix and the
   tree.
3. [manifest.schema.json](manifest.schema.json) is the machine-readable half; [fixtures.json](fixtures.json)
   is the minimum positive/negative corpus.
4. [ledger.md](ledger.md) maps every product clause to `implemented`, `partial`, `absent` or `future`.
5. `mise exec -- pnpm spec:check` checks the clause IDs, schema, fixtures and ledger coverage.

The papers are W3C, *MiniApp Standardization White Paper* v2 (2026), and Kleppmann et al.,
*Local-First Software: You Own Your Data, in spite of the Cloud* (Onward! 2019). Loro supplies the
document primitives; its version-control layer is app-level, not a branch API.
