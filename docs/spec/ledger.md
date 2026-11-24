# Implementation ledger

The spec is the target. This page is the evidence. Status is `implemented`, `partial`, `absent` or
`future`. A clause with no test or owning file is not implemented.

| Clauses | Area | Status | Evidence / gap |
| --- | --- | --- | --- |
| S1.1–S1.4 | Roles and terms | Partial | Host/pack/relay exist; catalogue does not; pack identity is not publisher-scoped |
| S1.5 | Non-goals | Implemented | Review rule in `.github/pull_request_template.md`; `apps/budget/scripts/check-shape.mjs` bans a network client; no tree-wide test |
| S1.6 | Server scope | Partial | No document/sync/identity service; the Flatpak store is distribution; all-servers-off is untested |
| S2.1–S2.5 | Publisher trust | Absent | One pinned Suite key; no publisher field, trust store, rotation chain, revocation or install fingerprint |
| S2.6 | Pack identity | Partial | Device key exists; no per-pack derived key; packs cannot sign relay frames |
| S2.7 | Contract domains | Partial | Pack integer `1` and app semver `1.1.0` exist; no mapping rule |
| S2.8 | Portable key | Absent | No user-held portable identity, export or recovery |
| S3.1 | Archive safety | Implemented | `packages/pack-host/src/archive.ts` refuses traversal, duplicates, symlinks and device entries |
| S3.2 | Archive bounds | Partial | Archive caps exist; document, blob, frame and widget bounds are not all enforced |
| S3.3 | Canonical bytes | Partial | `@suite/pack` signs every schema field in a fixed order, omits an absent optional field instead of emitting `null`, sorts capabilities and files, and `parsePackManifestJson` refuses duplicate keys before `JSON.parse`; `manifest.test.ts` proves field coverage, omission, sorting, nested key order and duplicate rejection, and `signature.test.ts` proves RFC 8032 Ed25519 with standard base64. The shell and the Go host still call `JSON.parse` and then `parsePackManifest`, so duplicate-key rejection is not wired at the host entry point |
| S3.4 | Golden vector | Implemented | `docs/spec/golden/manifest.json` commits a signed manifest, `docs/spec/golden/canonical.json` its 1352 canonical bytes, `docs/spec/golden/signature.b64` the Ed25519 signature and `docs/spec/golden/public-key.b64` the public key; `scripts/spec-golden.mjs` verifies them with `node:crypto` only, and `scripts/spec-golden.test.mjs` proves the vector verifies, one flipped canonical byte fails and one flipped signature byte fails |
| S3.5 | Manifest fields | Partial | `@suite/pack` parses every required and optional field family and `fixtures.json` covers each; the build path still signs under the pinned Suite key, so `publisher` is not required or emitted |
| S3.6 | Id, entry, files | Implemented | `@suite/pack` validates id, safe paths, hashes and byte counts |
| S3.7 | Unknown fields | Implemented | `packages/pack/src/manifest.test.ts` refuses an unknown field and an unknown capability |
| S3.8 | Subpackages | Absent | No lazy entry or prefetch path |
| S3.9 | Add-ons | Absent | No signed module, pin or capability intersection |
| S3.10 | Determinism | Implemented | `packages/pack-host/src/archive.test.ts` "builds the same bytes when the clock moves" proves the fixed timestamp, and `buildPackArchive` writes payloads in `comparePackPaths` order; `packages/pack/src/manifest.test.ts` "two builds of the same tree produce the same canonical bytes, hash and signature" proves absent optionals no longer shift the manifest bytes |
| S4.1 | Capability closure | Partial | Shell serves only `documents/files/network`; no optional-capability degradation |
| S4.2–S4.3 | Consent tiers and record | Absent | No consent screen, tier mapping or local grant record |
| S4.4 | Network allowlist | Partial | Shell allows any `https`/`wss`; external links bypass the session; no origin list |
| S4.5 | Associations | Absent | Deep links and file extensions are not namespaced or consented |
| S4.6 | Capability table | Partial | The spec table is new; hosts implement a subset |
| S4.7 | Pack keys | Partial | Packs do not get the device key today; no `identity.pack` API or test |
| S4.8 | Refusal | Implemented | `apps/shell/src/installedPacks.ts` names the unimplemented capability in its refusal; `apps/shell/src/installedPacks.test.ts` and `apps/go/packages/go/src/pack.test.ts` cover the refusal |
| S5.1 | Deep links | Partial | `suite://` parser exists; version pin is absent; `/workspace/` compatibility is Start-only |
| S5.2 | Document/widget URIs | Absent | No document or widget route |
| S5.3 | Single instance | Partial | Single-instance lock exists; the shell can open several tabs for one pack |
| S5.4 | Lifecycle events | Partial | Launch/hide/close exist; suspend/resume are absent |
| S5.5 | Suspend/resume | Absent | Go has a delayed destroy, not a suspended state |
| S5.6 | TTI | Absent | No measurement |
| S5.7 | Association ownership | Partial | Contributions are registered; no namespacing or second-pack refusal |
| S6.1 | Document envelope | Implemented | `apps/shell/src/documents.ts` writes magic, envelope version, publisher, pack, document, schema, payload length and checksum; "writes each header field and reads back the payload unchanged" and "reads the header without the payload" |
| S6.2 | Host write/backup | Implemented | Host document service: one write at a time, flushed temporary file and rename, `.bak`, crash recovery and `.corrupt-` quarantine; "quarantines a corrupt envelope…", "restores the previous copy…" and the atomic-write tests |
| S6.3 | Pack schema/migration | Partial | `apps/shell/src/documentMigrations.ts` finds a manifest's declared document, proves the chain and invokes a migration or projection entry with a one-document handle; `apps/shell/src/documentMigrations.test.ts` covers "finds the declared document and runs its two-step migration", "stamps the schema without touching the payload when the entry only validates", "invokes the declared projection with a read-only handle" and "refuses an undeclared document and a chain with a gap before writing". The runner is injected: the shell does not bind an entry to a pack renderer yet, so no app runs a declared migration |
| S6.4 | Newer document | Implemented | Host documents refuse a newer envelope or schema with a sentence and an export path and leave the file alone; "blocks a newer envelope…", "blocks a newer schema…" and "refuses a file from before the envelope…" |
| S6.5 | Mergeable children | Partial | Loro is used; `ensureMergeable*` is not the general rule |
| S6.6 | Migration safety | Partial | `apps/shell/src/documentMigrations.ts` skips a current document, backs up the whole envelope before a chain and restores it when an entry fails; `apps/shell/src/documentMigrations.test.ts` covers "running the two-step migration twice leaves the document unchanged", "keeps the pre-migration backup and puts it back when an entry fails" and "refuses a projection before the schema is current". Planner and Budget still carry their own migration bodies and backup rules |
| S6.7 | Blob classes | Partial | `apps/shell/src/blobs.ts` keeps the `asset`, `derived` and `cache` classes in pack-scoped content-addressed stores; `apps/shell/src/blobs.test.ts` covers "keeps asset, derived and cache in separate pack-scoped stores", "addresses a blob by the SHA-256 of its bytes and refuses a corrupt copy", "clearing the cache leaves every asset and derived blob intact" and "refuses a store the pack did not declare". Blob backup and a renderer binding are still absent, and the host cannot prove a cache blob is regenerable |
| S6.8 | Export | Partial | `apps/shell/src/exportBundle.ts` runs a pack's declared `export` entry through a host save handle, writes every `asset` as original bytes at `assets/<sha256>`, verifies each hash and records it in `manifest.json`; `apps/shell/src/exportBundle.test.ts` covers "exports every asset as original bytes with a manifest entry and a verified hash", "exports assets anyway when the pack declares no export entry", "refuses an export entry that writes outside the bundle or over a host name" and "writes no manifest when the pack's export entry fails". Canvas and Budget still own their app exports; Planner exports only `.planner`; Screens and Space do not export; the runner is injected, so binding it to a pack renderer remains |
| S6.9 | Unknown fields | Partial | The host preserves payload bytes exactly on an envelope rewrite (`rewrite` and "rewrites the envelope without changing the payload bytes"); Screen/Space unknown fields are still not shown as unknown |
| S7.1 | Sync declaration | Partial | Canvas and Planner sync; no pack sync service |
| S7.2 | Document keys | Partial | MLS workspace exists; per-document keys and grants are absent |
| S7.3 | Grant rotation | Absent | No document-key rotation |
| S7.4 | Relay verification | Partial | Role records exist; both shipped relays pass `verifyFrame`/`verifyRole` as `true` |
| S7.5 | Header index | Partial | Frames carry headers; the client never reads the high-water mark |
| S7.6 | Gap recovery | Absent | No version-vector exchange, peer snapshot or retention detection |
| S7.7 | Reconnect and blobs | Partial | Planner reconnects; Canvas does not; attachments do not sync |
| S7.8 | Capability URL | Partial | Invite links exist; no document key, role or expiry in the URL |
| S7.9 | Roles | Partial | Relay enforces owner/editor/viewer; clients have no viewer mode |
| S7.10 | Presence and wake | Partial | Canvas presence exists; no background refresh or signal |
| S7.11 | Replaceable relay | Partial | Self-hosted relay works; no third-party or object-store adapter |
| S8.1–S8.8 | Branches and review | Absent | Loro `fork`/`diff`/`applyDiff` exist; no branch model, review or retention |
| S9.1 | Declarative widgets | Partial | Start renders them; the shell is partial; capture handoff is absent |
| S9.2–S9.3 | Code widgets | Absent | No sandboxed widget runtime or fallback |
| S9.4–S9.5 | Widget data and capture | Partial | Capture contract exists; data scopes and delivery do not |
| S9.6 | Screen ownership | Implemented | `apps/shell/src/screens.ts` owns the Screen document; `apps/shell/src/screens.test.ts` keeps widget settings in it |
| S9.7–S9.8 | Screen export and identity | Absent | No `.screen` file; no pack identity in the widget frame |
| S10.1–S10.4 | Native, transitions, input | Absent | No declarative native components, host transitions or input-profile refusal |
| S10.5 | No spinners | Implemented | `apps/canvas/src/collab/loroPersistence.test.ts` applies offline edits; `apps/shell/src/documents.ts` has no network client |
| S10.6–S10.7 | Prefetch and TTI | Absent | No warm view, prefetch or TTI budget |
| S11.1 | No ambient data | Implemented | `apps/shell/src/documents.test.ts` refuses another pack's document; `apps/shell/src/documents.ts` scopes by container and pack |
| S11.2 | Explicit handles | Partial | External picker and handles exist; share/drag is partial |
| S11.3–S11.4 | Search and shared space | Absent | No metadata index, pack search entry or `documents.shared` |
| S11.5 | Platform APIs | Future | Deferred by contract |
| S12.1 | Side-load | Implemented | `apps/shell/src/installedPacks.test.ts` installs a signed archive with no catalogue or network |
| S12.2–S12.5 | Catalogue and revocation | Absent | No signed index, sequence, attestation, review state or revocation |
| S12.6 | Updates | Partial | Additive installs keep the previous version; no delta or rollback pointer |
| S12.7 | Install TOCTOU | Absent | The installed bytes are not compared with the displayed catalogue entry |
| S12.8 | Channels | Implemented | `docs/explanation/channels.md` and `docs/reference/packaging-channels.md` own the model; `scripts/flatpak-remote.mjs` publishes the signed remote |
| S13.1 | Threat model | Implemented | `apps/sync/docs/threat-model.md` and `apps/shell/SECURITY.md` name the actors and mitigations |
| S13.2 | Host boundary | Partial | Desktop has per-pack origin/session; mobile is same-origin |
| S13.3 | Sandbox | Implemented | `apps/shell/src/window.ts` sets context isolation, sandbox, no Node and the navigation lock; `packages/desktop/src/csp.test.ts` covers the CSP |
| S13.4 | Key and relay verification | Partial | Device key is not exposed; relay verification is disabled in shipped paths |
| S13.5 | Privacy | Partial | E2E sync and no telemetry; local files are not encrypted at rest |
| S13.6 | Update proof | Partial | Signature refusal exists; capability diff is absent |
| S13.7 | Audit log | Absent | No local install/consent/update log |
| S14.1 | Longevity | Partial | Per-app export exists; all-servers-off is not a test |
| S14.2 | Artifact archive | Partial | Flatpak/APK artifacts are archived; pack publisher fingerprint is absent |
| S14.3 | Migration/dual read | Partial | Per-app backups and refusals exist; no common dual-read rule |
| S14.4 | Deprecation | Absent | No manifest fields or warning |
| S14.5 | Key recovery | Absent | No device, workspace or document recovery story |
| S14.6 | Backup/crash recovery | Partial | App backups and quarantine exist; the host envelope does not |
| S15.1 | Accessibility | Partial | App work exists; no host/pack WCAG target or axe gate |
| S15.2 | Internationalization | Absent | `en-US` only; no locale negotiation or RTL |
| S15.3 | Resource limits | Partial | Archive caps exist; document, blob, frame and widget caps are partial |
| S15.4–S15.5 | Deletion and errors | Absent | No deletion contract or stable error codes |
| S15.6 | UX states | Partial | Some app states exist; no host-level required set |
| S15.7 | License and source | Absent | No manifest license/source fields |
| S16.1 | Ledger | Partial | This ledger is clause-level; evidence is still incomplete |
| S16.2 | Required tests | Absent | The conformance suite is not built |
| S16.3 | Test tags | Partial | `scripts/spec.test.mjs` checks fixtures, IDs and tags; two `// spec:` tags exist, most clauses are untagged |
| S16.4 | Fixtures | Partial | `fixtures.json` exists; the host matrix does not |
| S16.5 | Constants | Partial | Some limits exist in code; budgets and README values are absent |
| S17.1–S17.5 | Future work | Future | TV/IoT, payments, platform APIs, registry, branch-scoped grants |

## Blocking gaps

These are the clauses a host cannot claim today, in the order they block a credible conformance
claim.

| Clause | Why it blocks | Owner |
| --- | --- | --- |
| S3.3 | Duplicate JSON keys are refused only by the library text parser, which the shell and Go host do not call | Pack |
| S2.1–S2.5 | No publisher identity, trust store, rotation or revocation; side-loading is first-party only | Pack, shell |
| S6.3 | The host can invoke a declared entry, but no pack renderer is bound to the runner and no app runs a declared migration yet | Shell |
| S4.2–S4.5 | No consent record or network allowlist; external links and associations bypass the boundary | Shell, Go |
| S7.2–S7.6 | No per-document key, relay verification, header index or gap recovery | Sync |
| S9.2–S9.4 | No code-widget sandbox, fallback or data scope | Shell |
| S14.1, S14.5 | Export and key recovery are absent, so the longevity test fails | Shell, Start, Sync |
