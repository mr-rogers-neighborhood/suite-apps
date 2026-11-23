# Suite superapp and pack specification

Version 0.1 · Draft · [Orientation](README.md) · [Manifest schema](manifest.schema.json) ·
[Implementation ledger](ledger.md)

`MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT` and `MAY` follow RFC 2119. A clause is a target; the ledger
says whether the tree implements it.

Profiles: `host.desktop`, `host.mobile`, `pack`, `relay`, `catalogue`.

## 1. Scope and terms

- A **host** installs, verifies, sandboxes, renders and updates packs. It brokers bytes and
  capabilities and MUST NOT parse an app document.
- A **pack** is a signed web bundle with a manifest. It runs renderer-only, in its own origin and
  session.
- A **document** is a user-owned file kept in the suite document layer. The device copy is primary.
- A **blob** is pack-owned media or derived data. Its class is `asset`, `derived` or `cache`.
- A **relay** is a cloud peer that stores and forwards sealed frames. It holds no document and no
  document key.
- A **catalogue** is an optional signed index with review attestations.
- A **publisher** is the key that signs a pack or a catalogue entry.
- **Profiles** name a contract surface: `host.desktop`, `host.mobile`, `pack`, `relay` and
  `catalogue`. A host MAY implement several host profiles.

Non-goals: a platform account, mandatory review, server-owned truth, telemetry, DRM, a remote kill
switch, and arbitrary native code in the host.

## 2. Roles and trust

| Role | MUST | MUST NOT |
| --- | --- | --- |
| Host | Verify signature, file hashes and host fit before running a pack | Parse an app document, or load a pack into a half-working bridge |
| Pack | Declare every capability and document it uses | Reach another pack's data, or write host chrome |
| Publisher | Sign canonical manifest bytes and every release | Reuse a key it has retired without a signed rotation |
| Relay | Store and forward sealed frames, and honour retention | Read a frame, merge a document, or originate a write |
| Catalogue | Sign its index and attribute every review | Act as an install authority |

A host MUST refuse a pack whose signature, file hashes, contract version or host fit fails. Trust is
the publisher signature plus the capability diff plus, when present, the catalogue attestation plus
the person's consent. None of those is a substitute for another.

Publisher keys are Ed25519. A key rotation MUST be signed by the outgoing key and MUST carry the new
key. A revocation is a signed advisory; see §12.

## 3. Pack and manifest

A pack is a ZIP container with `manifest.json` at the root, the entry document, and its assets. The
manifest is also embedded in the signature.

- Canonical bytes MUST be deterministic: files are sorted by UTF-16 code unit, capabilities are
  sorted, and optional fields are omitted when absent.
- Every file MUST be listed with a lower-case SHA-256 and a byte count. The host MUST verify the
  bytes before running the pack.
- Unknown fields MUST be refused. A host does not guess what a newer field means.
- The archive writer SHOULD be deterministic (fixed timestamps, sorted paths) so two builds of the
  same tree produce the same hash.

| Field | Required | Meaning |
| --- | --- | --- |
| `format` | yes | `suite.pack` |
| `id` | yes | Stable lower-case id, 1–32 characters |
| `name` | yes | Human name |
| `description` | no | One line for the launcher |
| `version` | yes | Semver |
| `entry` | yes | Relative HTML path, listed in `files` |
| `contractVersion` | yes | Integer the host must understand |
| `minimumHostVersion` | no | Integer floor for the host |
| `capabilities` | yes | Declared vocabulary from §4 |
| `documents` | no | Document declarations (§6) |
| `blobs` | no | Blob stores and classes (§6) |
| `sync` | no | Sync scopes (§7) |
| `network` | no | Origin allowlist (§4) |
| `platforms` | no | `desktop`, `mobile`; absent means `desktop` |
| `input` | no | `pointer`, `touch`, `keyboard`; absent means all three |
| `widgets` | no | Widget descriptors (§9) |
| `contributions` | no | Commands, menus, file extensions, deep links |
| `subpackages` | no | Lazy entries inside the same signed pack |
| `addons` | no | Pinned signed module dependencies |
| `files` | yes | Every payload file with hash and size |
| `signature` | yes | Base64 Ed25519 over the canonical manifest |

**Subpackages.** A subpackage is a lazy entry inside the signed pack. It shares the pack's signature,
origin and capabilities; it adds no trust boundary. The host MAY fetch it on demand and MUST verify
the file hash before use.

**Add-ons.** An add-on is a separately signed module declared as `{id, version, sha256}`. The host
MUST verify the module's signature and pin, install it only as a dependency of a pack, and intersect
its capabilities with the pack's. An add-on MUST NOT update itself. A pack update MAY pin a new
version. A host MAY offer an add-on-registry profile with independent updates, but only with explicit
opt-in and a fresh capability consent.

## 4. Capabilities and consent

A capability is both a declaration and an enforcement point. A host MUST refuse a pack that asks for
a capability the host does not implement.

| Capability | Grants |
| --- | --- |
| `documents` | The suite document service, scoped to declared documents |
| `storage` | A small key-value store for pack state |
| `files` | The pack's scoped file root and consented external handles |
| `recents` | The host's recent-document list |
| `notifications` | Local notification delivery |
| `network` | Requests to origins in `network.allow` |
| `relay` | An opaque frame transport, not a general socket |
| `commands` | Contributions to host commands and menus |
| `identity.device` | The host device key, for signing and device encryption |
| `sync` | The sync service for declared document and blob scopes |
| `widget.code` | A sandboxed code widget |
| `media.map` | A host map component |
| `media.camera` | Camera frames or a host camera component |
| `media.model3d` | A host 3D model component |
| `media.ar` | A host AR profile |
| `media.vision` | Host face or hand tracking |

**Tiers.** A host MUST enforce four tiers:

- **Install** — the manifest declares it; the person sees it before the pack runs.
- **First use** — the host asks once per pack and remembers the answer.
- **Every use** — the host asks each time (camera, microphone, contacts-like data).
- **Token** — the host issues a short-lived token after consent (notifications, one-off grants).

**Network.** `network.allow` is a list of exact origins (`https://…`, `wss://…`). Wildcards are not
allowed. A request outside the list MUST fail. A host MAY let the person grant a broader origin
explicitly, and MUST show that grant in the pack's permission view.

**Updates.** An update MUST show a capability diff. A new capability requires a fresh consent; a
removed one takes effect immediately. A host MUST NOT silently expand a pack's access.

**Refusal.** A host MUST refuse at install or launch, with a sentence naming the missing capability
or profile. It MUST NOT load a pack that will half-work.

## 5. Addressing and lifecycle

- A pack is addressed as `suite://<id>/<path>`. The path is resolved inside the pack; it cannot escape.
- A document MAY be addressed as `suite://<id>/document/<document-id>`. A widget MAY be addressed as
  `suite://<id>/widget/<widget-id>`.
- A version pin is a query parameter (`?v=<semver>`). Without it, the host resolves the highest
  installed version that fits.
- The host MUST register file extensions and deep-link authorities from `contributions`.
- A pack has one instance per container. Multiple entries (deep link, file, widget, card) converge on
  that instance; a second window is a host capability, not a pack right.
- Lifecycle events are `install`, `first-run`, `launch`, `foreground`, `background`, `suspend`,
  `resume`, `terminate`, `update` and `uninstall`. Page events are `load`, `show`, `hide` and `unload`.
- `suspend` MUST stop visible work and release the camera, microphone and timers. `resume` MUST
  restore the same document state. `terminate` MUST flush documents and blobs first.
- A pack SHOULD report **time to interactive** (TTI) for each entry. TTI is the moment the first
  meaningful frame is visible and the primary input path responds. The host MUST record it.

## 6. Documents and blobs

**Documents.** A user document MUST go through the suite document layer, not through `localStorage`,
IndexedDB or an ad-hoc file.

- A document declares `{id, format, version, mode}` in the manifest.
- The document layer owns the atomic write, the backup, the lock and the migration. A pack MUST NOT
  write a document file directly.
- The current format is a Loro snapshot; the file envelope is versioned. A newer envelope or schema
  that the host cannot read MUST be refused by name, never treated as damage.
- Dynamic child containers MUST use `ensureMergeable*` so two offline peers that create the same
  logical key converge on one container. A shared logical key MUST NOT use concurrent
  `setContainer`.
- Migrations MUST write a backup before the new shape, MUST be idempotent, and MUST NOT read a record
  before the schema is current.
- Unknown fields in a document SHOULD be preserved when the host reads and rewrites it.

**Blobs.** A pack declares each store and its class:

- `asset` — user-created media or an imported file. It MUST be exported and backed up.
- `derived` — rebuildable from documents or assets, but worth keeping. It is backed up, not exported
  by default.
- `cache` — disposable. It MAY be deleted at any time and MUST NOT be the only copy of anything.

Blobs are content-addressed and pack-scoped. A blob path cannot escape its store. Export includes
every `asset` and its manifest entry.

## 7. Sync and sharing

Sync is optional. A pack declares `sync.documents` and `sync.blobs`; a host MAY refuse a pack whose
declared sync is not implemented.

- Frames are sealed. The relay sees workspace, device, epoch, kind, size and timing; it MUST NOT see
  document bytes, document keys or presence content.
- The relay is a cloud peer: store-and-forward, optional backup, discovery and bridge. It MUST NOT
  originate a document write or hold the only copy.
- Peers MUST exchange version vectors on join and reconnect, request the missing operations, and
  report pending imports when dependencies are absent.
- A client that has fallen behind the relay's retention MUST recover from a peer snapshot, not from a
  silent gap.
- Reconnect uses bounded backoff. A local edit is never blocked by the network.
- `asset` blobs sync as content-addressed chunks in the same sealed channel. `derived` and `cache`
  blobs do not sync.
- Sharing uses a per-document content key wrapped to recipient public keys, or a capability URL that
  carries the key. Removing a member rotates the key and stops wrapping for them. A copy already made
  cannot be recalled; the UI MUST say so.
- Roles are `owner`, `editor` and `viewer`. A viewer MAY propose a suggestion; a viewer MUST NOT write
  the live document.
- Background refresh is opt-in per workspace. A push is a signal or a user-visible notification; it
  MUST NOT carry document data or wake a device to accept a server-originated write.

## 8. Branches and review

Branches are an app-level model over Loro forks. Loro supplies `fork`, `forkAt`, `import`, `diff`,
`applyDiff`, `revertTo`, frontiers and version vectors; it does not supply named branches, review or
branch access control. This section owns that layer.

- A **private draft** is a local fork that is never synced. It has no membership.
- A **shared branch** is a fork visible to the document's members. It inherits the document's
  membership and roles; it does not create a second trust boundary.
- A **suggestion** is a diff from a base version to a draft or branch. A viewer may propose one; an
  editor or owner may accept or reject it.
- **Review** renders the diff by container. **Accept** applies it with `applyDiff` or imports the
  branch; **reject** discards the proposal without writing.
- A merge records a commit message and timestamp. If two peers changed the same property, the CRDT
  resolves it; the app MUST surface the result as a review item, not silently last-write-wins a
  critical field.
- A branch declares its base frontiers. A branch that cannot be merged without a shallow history
  cutoff MUST be refused, not silently truncated.
- Retention is explicit. Archiving a branch MAY be followed by a shallow snapshot; the full history
  is archived first, and the UI states that older peers can no longer sync from that point.

Conformance is staged: **L1** private drafts and suggestions, **L2** shared branches with review and
merge, **L3** retention and branch-scoped membership. L1 and L2 are normative; L3 is a profile.

## 9. Widgets and Screens

- A widget has two forms: **declarative** (host-rendered descriptor) and **sandboxed** (signed code
  entry). A pack that ships a sandboxed widget MUST also ship a declarative fallback, unless the host
  profile makes the sandboxed form mandatory.
- A sandboxed widget runs in its own origin and session, without Node, host DOM or top-level
  navigation. The host draws the frame, enforces a timeout and kills the widget on violation.
- Widget data has three scopes:
  - **projection** — a host-computed read-only view of declared fields (default);
  - **scoped** — declared document keys, read or read-write, intersected with the pack's grants;
  - **full** — the pack's document access, only by explicit install-time grant, with an indicator.
- A write SHOULD go through the capture contract: `{widget, action, values, settings}` with a typed
  result. A direct write scope is the exception.
- A Screen is host-owned. A widget may change its own settings through the host; it MUST NOT mutate
  the Screen document directly.
- A Screen exports as a portable `.screen` file. An unknown widget stays visible as a named
  placeholder; an unknown setting stays on the instance and is reported.
- A widget MAY open the full pack through its `suite://` URI.

## 10. Native surface, input and performance

**Native components.** A pack requests a host component by name (`map`, `video`, `camera`,
`model3d`, `ar.surface`), with props and events. It never receives a native handle and never runs
native code.

- Every component declares `fallback: web | none`.
- `none` is allowed only behind a host profile (`media.ar`, `media.vision`). A host without the
  profile MUST refuse at install or launch.
- A component set is versioned and signed by the host. A pack cannot add a native surface.
- Transitions are host-owned and declarative, and honour `prefers-reduced-motion`. A pack MUST NOT
  script host chrome.

**Input.** `input` declares `pointer`, `touch` or `keyboard`. A host MUST refuse a pack
that requires an input model it does not have. Focus order and a keyboard path are required for every
action. A remote or voice input model belongs to a future host profile.

**Performance.**

- Local reads and edits MUST NOT wait on a network round trip. A spinner is not allowed for a local
  operation.
- The host SHOULD prefetch an installed pack's entry and warm one render surface before first use.
- A subpackage loads on demand; the main entry MUST be usable without it.
- The host MUST record TTI and expose it to the pack. A host SHOULD publish budgets for cold start,
  first paint and input latency, and fail a build that regresses them beyond the budget.

## 11. Cross-app data

- No pack may enumerate another pack's documents. There is no ambient cross-app data.
- The person MAY open, drag or share a file; the host hands the target an opaque handle scoped to that
  pack and tab. The source pack never learns where it went.
- The host MAY keep an opt-in metadata index for recents and search: title, pack, modified time. It
  MUST NOT index document content.
- A host MAY offer a `documents.shared` profile: a user-granted folder or space with scoped handles.
  The grant is explicit, revocable and shown in the permission view.
- Platform-style data APIs (a host schema registry that lets packs query each other's data) are
  future work, not part of this version.

## 12. Catalogue and distribution

- Side-loading is first-class: a pack file installs without a catalogue, a network or an account.
- A catalogue is an optional signed index. It MAY be added, removed or replaced by the person.
- The index is signed by one or more operator keys. A review is signed by the reviewer's key. The
  host MUST verify both and show the provenance.
- Review states are `unreviewed`, `automated`, `reviewed` and `audited`. A record carries findings by
  category, severity and a link, plus declared vs observed capabilities, reproducibility, source URL,
  timestamps and expiry.
- The catalogue MUST NOT use popularity telemetry. Ordering is editorial and by update time.
- A revocation is a signed advisory naming the pack, version and reason. It MUST block new installs.
  It MUST NOT disable an installed pack without the person's choice; the host shows the advisory and
  offers disable or remove.
- Updates are signed, MAY be delta-compressed, and MUST be rollback-safe. A host MUST NOT accept a
  remote kill switch or an unsigned update.

## 13. Security and privacy

Threat model: a malicious pack, a compromised publisher, a malicious relay, a network attacker, and
another pack on the same device. The host itself is trusted.

- A pack runs with `contextIsolation`, `sandbox`, no `nodeIntegration`, no remote code and a
  Content-Security-Policy. Navigation is locked to its origin; `window.open` and webview attachment
  are denied.
- Each pack gets its own origin and session partition. State is not shared through cookies or storage.
- Permissions are denied by default and granted by the tiers in §4.
- Sync is end-to-end encrypted. The relay sees metadata, not content. Local files rely on OS
  encryption; the spec does not claim at-rest encryption.
- No telemetry by default. Any diagnostic is local and opt-in.
- A pack update shows the capability diff, the publisher key and the review state. A signature that
  does not verify is a refusal, not a warning.
- The catalogue and the publisher MAY publish an SBOM or a reproducibility attestation. A host SHOULD
  show it and MUST NOT treat it as a substitute for the signature.
- A relay MUST verify frame signatures in the shipped configuration. A relay that cannot verify MUST
  say so and MUST NOT be presented as a secure default.

## 14. Longevity and compatibility

- Every `asset` and every user document MUST export to a stable, documented format. JSON is the
  baseline; CSV, Markdown or the native format MAY be added.
- A pack MUST run with all servers off. Installation, launch, documents and export cannot require a
  service.
- A host SHOULD archive the signed pack artifact and its manifest so the software remains runnable
  after the publisher disappears.
- `contractVersion` is an integer the host understands. `minimumHostVersion` is an integer floor.
  Document formats carry their own `format` and `version`.
- A migration MUST be idempotent and MUST keep a backup. A host SHOULD support a dual-read window
  and write only the current shape.
- Unknown fields are preserved in documents and refused in manifests. A newer document that cannot
  be read is refused by name; it is never overwritten as if it were damaged.
- Deprecation is announced in the manifest and the changelog, never by silent removal.

## 15. Conformance

A conformance claim names a profile and the clause sections it covers. It is backed by a test, not a
sentence.

Required tests:

- signature and file-hash refusal;
- unknown field and unknown capability refusal;
- consent tier and network allowlist enforcement;
- offline install, launch and export with all servers off;
- document round-trip, migration and backup;
- sync convergence, pending imports, gap recovery and reconnect;
- widget data scopes and sandbox escape;
- branch review, accept, reject and merge;
- advisory revocation blocks install, not launch;
- catalogue signature and reviewer attestation verification.

The [ledger](ledger.md) records `implemented`, `partial`, `absent` or `future` per section. A clause
without evidence is not implemented.

## 16. Future work

- TV and IoT host profiles: input model, display, device capabilities and a declared storage role
  (`primary`, `replica`, `none`).
- Payments and platform services: external checkout first; a host-mediated payment sheet only if a
  commercial catalogue is ever chosen.
- Platform-style data APIs: a host schema registry with per-type consent.
- Add-on registry auto-update as a host profile.
- Vehicle and safety-critical profiles.
- Branch-scoped membership for shared branches.
