---
audience: developer
---

# Suite superapp and pack specification

Version 0.1 · Draft · [Orientation](README.md) · [Manifest schema](manifest.schema.json) ·
[Implementation ledger](ledger.md) · [Agent reading order](AGENTS.md)

`MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT` and `MAY` follow RFC 2119. Each clause has a stable ID.
A clause is a target; the ledger says whether the tree implements it. The spec is normative for
cross-boundary behavior; `docs/reference/status.md` and the ledger are the evidence of what exists;
`docs/reference/decisions.md` owns the rationale. Engineering standards and governance are separate
documents.

Profiles: `host.desktop`, `host.mobile`, `pack`, `relay`, `catalogue`. A clause applies to every
profile unless it names one.

## 1. Scope and terms

**S1.1** A **host** installs, verifies, sandboxes, renders and updates packs. It brokers bytes and
capabilities. It MUST NOT interpret an app document payload.

**S1.2** A **pack** is a signed web bundle with a manifest. It runs renderer-only, scoped by a
publisher and a pack id.

**S1.3** A **document** is a user-owned file kept in the suite document layer. The device copy is
primary. A **blob** is pack-owned media or derived data, classed `asset`, `derived` or `cache`.

**S1.4** A **relay** is a cloud peer that stores and forwards sealed frames. It verifies what it can
and holds no document payload or document key. A **catalogue** is an optional signed index with
review attestations; it recommends and never gates.

**S1.5** Non-goals: a platform account, mandatory review, server-owned document truth, telemetry,
DRM, a remote kill switch, and arbitrary native code in the host process.

**S1.6** The project operates no document, sync, identity, telemetry or account service. The signed
Flatpak store is distribution and host updates only; it is not document truth. A pack MUST remain
installable by side-load and runnable with all servers off.

## 2. Trust roots and publisher identity

**S2.1** A pack is signed by a **publisher key**: an Ed25519 public key in the manifest. The host
verifies the signature against that key and against a local trust store. The first-party Suite key is
preinstalled; a person MAY add another publisher key after seeing its fingerprint.

**S2.2** The install identity is `(publisher id, pack id)`. A publisher id is stable across key
rotation; if a manifest omits it, the key fingerprint is the id. Storage is scoped by both. A
container has one active pack per public id; installing another publisher's pack under an existing id
requires an explicit migration and MUST NOT inherit that pack's documents, blobs, storage or grants.

**S2.3** A publisher key rotation MUST be signed by the outgoing key and carry the new key, the same
publisher id and a monotonic sequence. The host updates the trust store only after the person confirms
the new fingerprint. Installed packs keep running.

**S2.4** A pack revocation is a signed advisory. The key that signed the installed pack, a catalogue
operator, or the person MAY issue it. No publisher may revoke another publisher's pack. A revocation
blocks new installs; an installed pack keeps running unless the person chooses to disable or remove
it.

**S2.5** The host MUST show the publisher fingerprint, pack id, version and capability list at
install and update. It MUST refuse a pack signed by an unknown publisher unless the person adds it.

**S2.6** The device key is the host's. A pack receives `identity.pack`, a per-pack derived key, never
the device key. A pack key MUST NOT sign relay frames, role records or membership changes.

**S2.7** `contractVersion` in a pack manifest is an integer the host understands. The `suite.app.json`
contract version is a semver string and is a different domain. A host MUST NOT compare them.

**S2.8** A **portable key** is optional, user-held and exportable. It identifies a person across
devices and can receive document grants. It is not an account: no server recovers it, and losing it
loses access unless a device still holds the grant. The host MAY offer export and import; it MUST
state the loss.

## 3. Pack format, canonical bytes and manifest

**S3.1** A pack is a ZIP container with `manifest.json` at the root, the entry document and its
assets. The archive reader MUST refuse path traversal, absolute paths, duplicate names, symlinks,
device entries and entries beyond the declared size before decompression.

**S3.2** The host MUST enforce minimum bounds: archive size, entry count, per-file size, total
decompressed size and a bounded verification time. The exact numbers are an implementation constant,
not a licence to be unbounded.

**S3.3** The signature covers every manifest field except `signature`. Canonical bytes are a fixed
field order, omit an absent optional field (never emit `null`), sort capabilities and files, and
reject duplicate JSON keys before parsing. Ed25519 follows RFC 8032 with standard base64.

**S3.4** The host MUST publish and test at least one golden vector: a manifest, its canonical bytes
and its signature. A second implementation MUST verify the same vector.

**S3.5** The manifest declares `format`, `id`, `name`, `version`, `entry`, `contractVersion`,
`publisher`, `capabilities`, `files` and `signature`. Optional fields cover a ring and host floor
(S3.11), documents, blobs, sync, network, platforms, input, locales, widgets, code widgets,
components, contributions, subpackages, add-ons, export, license and deprecation. A `platforms` value
is an opaque **host kind** (`desktop`, `mobile`, `tv`, `tablet`, `foldable`, `xr`, …), not a build
target. An unknown kind parses and simply matches no host: the list is open, and rejecting the
manifest would make the pack uninstallable everywhere. A manifest with no `platforms` is **unknown**,
never universal; an unknown value is the deliberate exception to the closed vocabularies in S3.7.

**S3.6** `id` is a stable lower-case id, 1–32 characters. `entry` is a relative HTML path listed in
`files`; a path with `..`, a backslash or a leading slash is refused. Every file carries a lower-case
SHA-256 and a byte count and is verified before the pack runs.

**S3.7** Unknown manifest fields and unknown capability names are refused. A host does not guess what
a newer field means.

**S3.8** A **subpackage** is a lazy entry inside the signed pack. It shares the pack's signature,
origin and capabilities and adds no trust boundary. The host MAY fetch it on demand and MUST verify
its hash before use.

**S3.9** An **add-on** is a separately signed pack-like artifact with its own manifest, publisher,
capabilities and file hashes. A pack pins `{id, version, sha256}`. The host verifies the add-on's
signature, installs it only as a dependency, and intersects its capabilities with the pack's. An
add-on MUST NOT update itself. Registry auto-update is not part of this version.

**S3.10** The archive writer SHOULD be deterministic (fixed timestamps, sorted paths) so two builds of
the same tree produce the same hash. The manifest's optional fields MUST be omitted, not `null`, when
absent.

**S3.11** A manifest MAY declare a `ring` and a host floor. `ring` is `stable` or `preview`; absent
means `stable`. It is the pack's own stability, signed as part of the version, and it is not a channel
(S12.8): `slop` and `nightly` name the host build, so they are refused as a ring, and so is any other
value, because the vocabulary is closed like a capability (S3.7), not open like a host kind (S3.5). The
host floor is `minHost`, an integer host version of 1 or more, and absent means no floor. A manifest
signed before this revision carries the same floor as `minimumHostVersion`; a host MUST accept either
spelling and MUST refuse a manifest that carries both. Neither field is a capability and neither is
guessed: a host that does not know a ring refuses the pack.

**S3.12** A host MUST refuse a pack whose `minHost` is above its own host version, and a pack whose
`ring` is not among the rings it offers (S12.10), before it installs or launches it, in one sentence
that names the pack, the requirement and the host's own value. It MUST NOT install the version, start a
renderer and fail part-way, and it MUST NOT quietly substitute an older ring. A refusal leaves an
installed older version running (S12.6) and says which value would have to change.

## 4. Capabilities, consent and associations

**S4.1** The capability vocabulary is closed. A host MUST refuse a pack that requires a capability it
does not implement. A manifest MAY list `optionalCapabilities`; a missing optional capability means
the pack degrades, not that the host loads a half-working bridge.

**S4.2** The host MUST enforce these tiers:

| Tier | Behaviour |
| --- | --- |
| Install | Shown before first run, with publisher, id, version, origins and capabilities |
| First use | Asked once per pack and remembered; a denial is remembered too |
| Every use | Asked each time (camera, microphone, contacts-like data) |
| Token | A short-lived grant after consent (notifications, one-off transfers) |

**S4.3** A consent record is local and exportable. It is keyed by `(publisher, id, version,
capability)` and records what was shown, granted, denied and when. An update that adds a capability
MUST pause on a fresh consent; a removed capability takes effect immediately.

**S4.4** `network` is an exact-origin allowlist. `network.allow` MUST be non-empty when `network` is
declared, MUST contain only `https://` or `wss://` origins, and MUST NOT contain a wildcard, a path
or a fragment. The host MUST derive `connect-src` from it and MUST apply the same check to fetches,
redirects, iframes, external links and every native component request.

**S4.5** `deepLinks` and `fileExtensions` are namespaced to the pack's own id or an authority it
owns. The host MUST NOT let a pack claim another installed pack's id, deep link or extension without
the person's explicit consent. A file extension is a contribution, not an authority.

**S4.6** The capability table is the enforcement surface. Each row names the profile, default tier,
scope and failure mode; a capability with no enforcement point is not added.

| Capability | Profile | Tier | Scope |
| --- | --- | --- | --- |
| `documents` | host.desktop, host.mobile | Install | Declared documents, host envelope |
| `storage` | host.desktop, host.mobile | Install | Pack KV, bounded |
| `files` | host.desktop, host.mobile | Install | Pack root and consented handles |
| `recents` | host.desktop, host.mobile | First use | Host recent list |
| `notifications` | host.desktop, host.mobile | Token | Local delivery |
| `network` | host.desktop, host.mobile | Install | `network.allow` only |
| `relay` | host.desktop, host.mobile | Install | `sync.documents` and `sync.blobs` only |
| `commands` | host.desktop | Install | Contributions and associations |
| `identity.pack` | host.desktop, host.mobile | Install | Per-pack derived key |
| `sync` | host.desktop, host.mobile | First use | Declared document and blob scopes |
| `widget.code` | host.desktop | Install | Sandboxed widget only |
| `media.map` | host.desktop, host.mobile | First use | Host map component |
| `media.camera` | host.desktop, host.mobile | Every use | Camera frames |
| `media.model3d` | host.desktop, host.mobile | First use | Host 3D component |
| `media.ar` | host.desktop | Every use | AR profile |
| `media.vision` | host.desktop | Every use | Face/hand landmarks |

**S4.7** A pack MUST NOT receive the device key, a relay role record or a membership secret. It MUST
NOT sign frames or role changes. `identity.pack` is scoped to the pack's own data.

**S4.8** A host MUST refuse at install or launch with a sentence naming the missing capability,
profile or permission. It MUST NOT load a pack that will half-work.

## 5. Addressing and lifecycle

**S5.1** The pack origin is assigned by the host and is opaque to the pack. The deep-link scheme is
`suite://<pack-id>/<path>`; a version pin is `?v=<semver>`. A legacy `suite://<app>/workspace/<file>`
MUST map to the document path for compatibility.

**S5.2** A document is addressed as `suite://<pack-id>/document/<document-id>`. A widget is addressed
as `suite://<pack-id>/widget/<widget-id>`. A document URI is a launch context, not a fetchable
same-origin resource.

**S5.3** A pack has one instance per container. A deep link, file, widget or card converges on that
instance. A second window is a host capability, not a pack right.

**S5.4** Lifecycle events are `install`, `first-run`, `launch`, `foreground`, `background`, `suspend`,
`resume`, `terminate`, `update` and `uninstall`. Page events are `load`, `show`, `hide` and `unload`.

**S5.5** `suspend` MUST stop visible work and release the camera, microphone and timers. `resume` MUST
restore the same document state. `terminate` MUST flush documents and blobs first.

**S5.6** A pack SHOULD report **time to interactive** (TTI) for each entry: the first meaningful frame
is visible and the primary input path responds. The host MUST record it and expose it locally.

**S5.7** File associations and deep links are registered only from `contributions` and only for the
pack's own names. A second pack MUST NOT silently replace an existing association.

## 6. Documents and blobs

**S6.1** The host document service owns an **envelope**: magic, envelope version, publisher, pack id,
document id, schema version, payload length and checksum. The host reads the envelope header only. It
MUST NOT interpret the payload.

**S6.2** The host owns the atomic write, lock, backup, crash recovery and quarantine. It writes a
temporary file, flushes, renames and keeps a previous copy. A corrupt envelope is quarantined, never
silently replaced by a fresh document.

**S6.3** The pack owns its schema, migrations and projections. It declares them in the manifest:
`documents: [{id, format, version, mode, migrations?, projection?}]`. The host invokes a declared
migration or projection entry with a scoped document handle and keeps the backup. It never reads the
migrated payload.

**S6.4** A newer envelope or schema the host cannot read MUST block opening with a sentence and an
export path. The host MUST NOT create a fresh document in place of the user's file.

**S6.5** A pack MUST use `ensureMergeable*` for dynamic child containers so two offline peers that
create the same logical key converge. A shared logical key MUST NOT use concurrent `setContainer`.

**S6.6** Migrations MUST be idempotent, MUST keep a backup and MUST NOT read a record before the
schema is current. A migration that cannot finish leaves the old document readable.

**S6.7** A blob store declares its class: `asset` (exported and backed up), `derived` (backed up, not
exported by default) or `cache` (disposable, never the only copy). Blobs are content-addressed and
pack-scoped. Export includes every `asset` and a manifest of the bundle.

**S6.8** A document, blob, Screen or Space MUST export to a stable, documented format. A pack declares
an `export` entry; the host invokes it with a save handle. Documents export as JSON or their declared
native format; assets export as original bytes with a SHA-256 and a manifest entry.

**S6.9** Unknown fields inside the payload are the pack's. The host preserves the payload bytes when
it rewrites the envelope. Unknown fields in host-owned documents (Screen, Space) are preserved and
shown as unknown, not dropped.

## 7. Sync, sharing and cloud peers

**S7.1** Sync is optional. A pack declares `sync.documents` and `sync.blobs`; a host MAY refuse a pack
whose declared sync it does not implement. A local edit is never blocked by the network.

**S7.2** The workspace MLS group authenticates devices and workspace membership. Each document has a
content key wrapped to the member device keys that hold a grant. A grant is a signed record
`{documentId, recipient, role, keyWrap, expiresAt, sequence}` delivered inside an MLS application
message. Frames are encrypted with the document key.

**S7.3** Removing a grant rotates the document key and re-wraps it for the remaining holders. A removed
member keeps the old key and any copy already made; the UI MUST say that a copy cannot be recalled.

**S7.4** The relay verifies every frame and role record and applies signed records in a deterministic
order (signer authority, sequence, explicit conflict flag). It orders membership; it cannot forge it.
Clients verify the same records and MUST report a conflict rather than guess.

**S7.5** The relay stores a content-free per-device high-water mark and frame sequence in the header.
It sees workspace, device, epoch, kind, size, sequence and timing; it MUST NOT see document bytes,
document ids, document keys or presence content.

**S7.6** Peers exchange version vectors on join and reconnect, request missing operations, and report
pending imports. A client behind retention MUST detect the gap from the header index and fetch an
authenticated snapshot from a peer. It MUST NOT silently continue from a gap.

**S7.7** Reconnect uses bounded backoff. Asset blobs sync as content-addressed chunks in the same
sealed channel; `derived` and `cache` blobs do not sync.

**S7.8** Sharing uses a document grant or a capability URL carrying the document key, role and expiry.
A capability URL is a bearer token; the UI MUST say so. Removing a member rotates the key; it cannot
recall a copy.

**S7.9** Roles are `owner`, `editor` and `viewer`. Only an owner invites, removes or changes a role; the
last owner cannot be removed or demoted. A viewer MAY propose a suggestion; a viewer MUST NOT write
the live document. Role changes are signed records, never a CRDT document field.

**S7.10** Presence is a separate, expiring channel and is never written into a document. A push is a
signal or a user-visible notification; it MUST NOT carry document data or authorize a write. Background
refresh is opt-in per workspace and pulls frames only; correctness never depends on it.

**S7.11** The relay is optional and replaceable: self-hosted, third-party or object-store. It MUST NOT
be the only copy. Discovery and bridge roles are not part of this version.

## 8. Branches and review

**S8.1** A **private draft** is a local Loro fork that is never synced. It has no membership and no
relay frames.

**S8.2** A **shared branch** is a fork visible to the document's grant holders. It inherits the
document's grants and roles; it does not create a second trust boundary.

**S8.3** A **suggestion** is a diff from a base version to a draft or branch. A viewer may propose one;
an editor or owner may accept or reject it.

**S8.4** Review renders the diff by container through the pack's schema. The host MUST NOT parse the
document to render a diff; the pack provides the diff entry and the host brokers the base and head.

**S8.5** Accept applies the diff with `applyDiff` or imports the branch; reject discards it without
writing. A merge records a commit message and timestamp.

**S8.6** If two peers changed the same property, the CRDT resolves it; the app MUST surface the result
for review. A field the schema marks `critical` MUST NOT be silent last-write-wins.

**S8.7** A branch declares its base frontiers. A branch that cannot merge without a shallow-history
cutoff MUST be refused, not silently truncated. Retention is explicit: archive full history before a
shallow snapshot, and tell the person that older peers can no longer sync.

**S8.8** Branch conformance is staged: L1 private drafts and suggestions, L2 shared branches with
review and merge, L3 retention and branch-scoped grants. L1 and L2 are normative; L3 is a profile.

## 9. Widgets and Screens

**S9.1** `widgets` are declarative: `{id, title, size, capabilities, action, settings?}`. They are
host-rendered, have no code and work on every host profile. This is the shipped shape and the baseline.

**S9.2** `codeWidgets` are sandboxed: `{id, title, size, capabilities, action, settings?, entry,
sha256, fallback}`. A code widget MUST ship a declarative fallback with the same id; a host without
`widget.code` places the fallback or opens the full pack. A host MUST verify the entry hash.

**S9.3** A sandboxed widget runs in its own origin and session, without Node, host DOM or top-level
navigation. The host draws the frame, enforces a timeout and kills the widget on violation. A widget
MUST NOT navigate the top level or open an arbitrary window.

**S9.4** Widget data has one scope: `projection` (host-computed read-only view of declared fields,
the default), `scoped` (declared document keys, read or read-write, intersected with the pack's
grants) or `full` (the pack's access, only by explicit install-time grant, with an indicator).

**S9.5** A write SHOULD go through the capture contract: `{widget, action, values, settings}` with a
typed result. A direct `write` scope is the exception, not the default.

**S9.6** A Screen is host-owned. A widget may change its own settings through the host; it MUST NOT
mutate the Screen document directly.

**S9.7** A Screen exports as a versioned `.screen` file. An unknown widget stays visible as a named
placeholder; an unknown setting stays on the instance and is reported. Imported settings are
untrusted input.

**S9.8** A widget displays its pack identity in the host frame. A hostile pack MUST NOT be able to
present a widget titled as another pack.

## 10. Native components, input and performance

**S10.1** A pack requests a host component by name (`map`, `video`, `camera`, `model3d`,
`ar.surface`) with props and events. It never receives a native handle and never runs native code.

**S10.2** Every component declares `fallback: web | none`. `none` is allowed only behind a host
profile (`media.ar`, `media.vision`); a host without it MUST refuse at install or launch. A component
set is versioned and signed by the host.

**S10.3** Transitions are host-owned and declarative, and honour `prefers-reduced-motion`. A pack MUST
NOT script host chrome.

**S10.4** `input` declares `pointer`, `touch` or `keyboard`. A host MUST refuse a pack that requires
an input model it does not have. Focus order and a keyboard path are required for every action.

**S10.5** Local reads and edits MUST NOT wait on a network round trip. A spinner is not allowed for a
local operation.

**S10.6** The host SHOULD prefetch an installed pack's entry and warm one render surface before first
use. A subpackage loads on demand; the main entry MUST be usable without it.

**S10.7** The host MUST record TTI and SHOULD publish budgets for cold start, first paint and input
latency. A build that regresses beyond the budget SHOULD fail.

## 11. Cross-app data

**S11.1** No pack may enumerate another pack's documents. There is no ambient cross-app data.

**S11.2** The person MAY open, drag or share a file; the host hands the target an opaque handle scoped
to that pack and tab. The source pack never learns where it went.

**S11.3** The host MAY keep an opt-in metadata index for recents and search: title, pack, modified
time. It MUST NOT index document content. A pack MAY provide its own search entry; the host aggregates
results and handles, not content.

**S11.4** A host MAY offer a `documents.shared` feature: a user-granted folder or space with scoped
handles. The grant is explicit, revocable and shown in the permission view.

**S11.5** Platform-style data APIs (a host schema registry that lets packs query each other's data)
are future work, not part of this version.

## 12. Catalogue, distribution and revocation

**S12.1** Side-loading is first-class: a pack file installs without a catalogue, a network or an
account. The catalogue is optional and may be added, removed or replaced by the person.

**S12.2** A catalogue index is signed by one or more operator keys and carries `sequence`, `previous`,
`expires` and a threshold. A review is signed by the reviewer's key and bound to
`{publisher, id, version, sha256}` with an expiry. The host MUST verify both and show provenance.

**S12.3** Review states are `unreviewed`, `automated`, `reviewed` and `audited`. A record carries
findings by category and severity, a link, declared vs observed capabilities, reproducibility, source
URL, timestamps and expiry.

**S12.4** The host MUST NOT use popularity telemetry. Ordering is editorial and by update time; a host
MUST NOT infer usage from local data for ranking.

**S12.5** A revocation is a signed advisory from the installed pack's publisher, a catalogue operator
or the person. It blocks new installs. It MUST NOT disable an installed pack without the person's
choice; the host shows the advisory and offers disable or remove.

**S12.6** An update is signed and MAY be delta-compressed. A pack update leaves the previous version
installed for rollback. A host MUST NOT accept a remote kill switch or an unsigned update.

**S12.7** Install MUST compare the verified manifest and hash with the catalogue entry that was
displayed. A mismatch is a refusal, not a warning.

**S12.8** Host updates and distribution channels are outside this contract; `docs/explanation/channels.md`
and `docs/reference/packaging-channels.md` own them. A pack carries a signed version, never a channel.
A pack's `ring` (S3.11) is the pack's own stability, not a channel: `slop`, `nightly`, `preview` and
`stable` describe what a host build has survived, and the host decides which channels it moves through
and which rings it offers. A pack never learns a channel name, and a channel name is never a pack value.

**S12.9** A catalogue index `version` 2 entry names one signed pack version:
`{id, name, publisher, version, ring, contractVersion, minHost?, archive: {url, size, sha256}, signature, capabilities, platforms?, description?}`
([catalogue.schema.json](catalogue.schema.json)). `version`, `ring`, `contractVersion` and `minHost`
MUST equal the manifest's **effective** values: an absent `ring` is `stable`, and the floor is the same
value under either spelling (S3.11), so a manifest signed before S3.11 matches an entry that says
`stable` and one floor. `contractVersion` is required — the manifest requires it, a generated entry
always carries it, and an entry without it is refused; a `version` 1 index written before this clause
has no such field and is read as contract 1. `archive.url`, `archive.size` and `archive.sha256` are the
only place an entry carries where the archive is and what it hashes to. `signature` is the manifest's
Ed25519 signature, standard base64, so the host can compare the entry with the manifest it unpacked
(S12.7) before it installs. The index is generated, not authored: an entry with an unknown ring, or
with no `ring`, is refused. An index written before this clause keeps `version` 1, whose entries carry
`url`, `size` and `sha256` at the top level and no ring; every such entry is `stable`.

**S12.10** A host offers a set of rings, and the default is `stable` alone; `preview` is added only by
the person's explicit choice, which is a host setting and never something a pack can widen. For one
pack id the host offers the highest version whose `ring` is in that set and whose `contractVersion`
(S12.9), `minHost` and platform claims fit (S3.12); the same checks run again on the unpacked manifest
before install (S12.7). A ring above the host's preference is never offered, even when its version is
newer. A version's ring is fixed by its signature. An operator stages a preview by signing a version
whose manifest says `ring: "preview"` and publishing it in the next index with the same ring and a
higher `sequence`; promotion is a new version signed with `ring: "stable"`, normally a patch bump,
never a re-signed archive under the same version. The preview version stays in the catalogue for
rollback (S12.6). A pack whose ring the host does not offer is not listed, and a direct install of one
is refused by S3.12 rather than installed quietly.

## 13. Security and privacy

**S13.1** Threat model: a malicious pack, a compromised publisher, a malicious relay, a network
attacker, another pack, and a stolen device. The host process is trusted; a pack renderer is not.

**S13.2** `host.desktop` gives each pack its own origin and session partition. `host.mobile` may share
an origin; it MUST provide a separate document and heap, per-request capability checks and path
scoping, and state which boundary it guarantees. The spec MUST NOT claim a process boundary where
there is none.

**S13.3** A pack runs with `contextIsolation`, `sandbox`, no `nodeIntegration`, no remote code and a
Content-Security-Policy. Navigation is locked to its origin; `window.open` and webview attachment are
denied.

**S13.4** Permissions are denied by default and granted by S4.2. The device key, role records and
membership secrets are never exposed to a pack. A relay MUST verify frame and role signatures in the
shipped configuration. A relay that cannot verify MUST say so and MUST NOT be presented as secure.

**S13.5** Sync is end-to-end encrypted. The relay sees metadata, not content. Local files rely on OS
encryption; the spec does not claim at-rest encryption. No telemetry by default; diagnostics are
local and opt-in.

**S13.6** A pack update shows the capability diff, publisher fingerprint and review state. A signature
that does not verify is a refusal, not a warning. An SBOM or reproducibility attestation is evidence,
not a substitute for the signature.

**S13.7** A local audit log MAY record installs, consent, updates and removals. It is bounded, local,
opt-in and never uploaded. A support bundle MUST NOT contain document payloads or keys.

## 14. Longevity, compatibility and recovery

**S14.1** Every `asset` and every user document MUST export to a stable, documented format. A pack
MUST run with all servers off: install, launch, documents and export cannot require a service.

**S14.2** A host SHOULD archive the signed pack artifact, manifest and publisher fingerprint so the
software remains runnable after the publisher disappears.

**S14.3** A migration MUST be idempotent and keep a backup. A host SHOULD support a dual-read window
and write only the current shape. A newer document that cannot be read is refused by name; it is never
overwritten as if it were damaged.

**S14.4** Deprecation is announced in the manifest (`deprecated`, `replacement`, `sunset`) and the
changelog. A host SHOULD warn; it MUST NOT silently remove a working pack.

**S14.5** Key recovery is explicit. A device key can be regenerated; a workspace root kit is the
recovery path; a document key can be re-wrapped by a holder. There is no account recovery and no
server escrow. The UI MUST state what is lost when a key is lost.

**S14.6** Backup and crash recovery are guaranteed by the document envelope: atomic write, previous
copy, quarantine, restore. A backup is not a substitute for export; the UI MUST distinguish them.

## 15. Cross-cutting requirements

**S15.1** Accessibility: host chrome and pack surfaces target WCAG 2.2 AA. Every action has an
accessible name, a focus order and a keyboard path; contrast, target size, zoom/reflow and reduced
motion apply. The host MUST expose pack content through host semantics, and a pack gate SHOULD run an
axe check. `docs/reference/accessibility/wcag-22-map.md` owns the evidence.

**S15.2** Internationalization: user-visible strings carry a BCP-47 locale; the manifest declares
`defaultLocale` and `locales`; the host negotiates and falls back to the default. RTL and text
expansion MUST be supported. Packaging may ship one locale until a translated string exists.

**S15.3** Resource limits: the host MUST enforce bounds on archive, entries, file size, decompressed
size, document size, blob size, widget count, frame size and relay retention. A limit breach is a
refusal with a sentence, never an unbounded scan.

**S15.4** Retention and deletion: `delete` removes the local document, its backups and its blobs; it
MAY request relay deletion but MUST NOT claim that copies on other devices are erased. A removed
member keeps a copy. The UI MUST say so.

**S15.5** Errors have stable codes for signature, hash, contract, capability, consent, offline,
retention, removal and migration, plus a separate user-facing sentence. A client MUST NOT parse the
sentence to decide behavior.

**S15.6** Required UX states: install, first run, offline, denied consent, missing pack, unknown
widget, removed member and migration failure. Each has a named message and a next action; a blank pane
is not a state.

**S15.7** A pack declares `license` and MAY declare `source`. The catalogue shows both. Licensing,
governance and security disclosure live in `docs/spec/governance.md`.

## 16. Conformance

**S16.1** A conformance claim names a profile and the clause IDs it covers. It is backed by a test,
not a sentence. The [`ledger`](ledger.md) records `implemented`, `partial`, `absent` or `future` per
clause.

**S16.2** Required tests: signature and hash refusal; unknown field and capability refusal; consent
tier and network allowlist; offline install, launch and export; document round-trip, migration and
backup; sync convergence, pending imports, gap recovery and reconnect; widget scopes and sandbox
escape; branch review, accept, reject and merge; advisory revocation; catalogue signature and
attestation; archive safety and resource bounds; golden canonical vector.

**S16.3** A test that covers a clause carries `// spec: S4.2` (or the fixture's `clause` field). A
clause with no evidence is a target, not a claim.

**S16.4** The fixtures in [`fixtures.json`](fixtures.json) are the minimum positive and negative
corpus. A new manifest field lands with a valid and an invalid fixture, a ledger row and, where
possible, a test tag.

**S16.5** The exact numbers in S3.2, S15.3 and the TTI budgets are implementation constants. The spec
requires a bound and a refusal; the values live in the owning host's code and README.

## 17. Future work

**S17.1** TV and IoT host profiles: input, display, device capabilities and `storage: primary |
replica | none`. Vehicle and safety-critical profiles remain out of scope.

**S17.2** Payments and platform services: external checkout first; a host-mediated payment sheet only
if a commercial catalogue is ever chosen. No platform account.

**S17.3** Platform-style data APIs: a host schema registry with per-type consent.

**S17.4** Add-on registry auto-update as an explicit host feature with re-consent and provenance.

**S17.5** Branch-scoped grants and a transparency log for catalogue attestations.
