# Implementation ledger

The spec is the target. This page is the evidence. Status is `implemented`, `partial`, `absent` or
`future`. A clause with no test or owning file is not implemented.

| Clauses | Area | Status | Evidence / gap |
| --- | --- | --- | --- |
| S1.1–S1.4 | Roles and terms | Partial | Host/pack/relay exist; catalogue does not; pack identity is not publisher-scoped |
| S1.5 | Non-goals | Implemented | No account, telemetry, DRM or remote kill switch in the tree |
| S1.6 | Server scope | Partial | No document/sync/identity service; the Flatpak store is distribution; all-servers-off is untested |
| S2.1–S2.5 | Publisher trust | Absent | One pinned Suite key; no publisher field, trust store, rotation chain, revocation or install fingerprint |
| S2.6 | Pack identity | Partial | Device key exists; no per-pack derived key; packs cannot sign relay frames |
| S2.7 | Contract domains | Partial | Pack integer `1` and app semver `1.1.0` exist; no mapping rule |
| S2.8 | Portable key | Absent | No user-held portable identity, export or recovery |
| S3.1 | Archive safety | Implemented | `packages/pack-host/src/archive.ts` refuses traversal, duplicates, symlinks and device entries |
| S3.2 | Archive bounds | Partial | Archive caps exist; document, blob, frame and widget bounds are not all enforced |
| S3.3 | Canonical bytes | Partial | Canonicalizer exists, but new fields are unsigned, absent fields emit `null`, duplicate keys are not rejected |
| S3.4 | Golden vector | Absent | No committed manifest/canonical/signature vector |
| S3.5 | Manifest fields | Partial | Core fields exist; publisher, documents, blobs, sync, network, components and add-ons are absent |
| S3.6 | Id, entry, files | Implemented | `@suite/pack` validates id, safe paths, hashes and byte counts |
| S3.7 | Unknown fields | Implemented | Strict Zod schemas refuse unknown fields and capabilities |
| S3.8 | Subpackages | Absent | No lazy entry or prefetch path |
| S3.9 | Add-ons | Absent | No signed module, pin or capability intersection |
| S3.10 | Determinism | Partial | Deterministic archive writer exists; absent-field encoding is inconsistent |
| S4.1 | Capability closure | Partial | Shell serves only `documents/files/network`; no optional-capability degradation |
| S4.2–S4.3 | Consent tiers and record | Absent | No consent screen, tier mapping or local grant record |
| S4.4 | Network allowlist | Partial | Shell allows any `https`/`wss`; external links bypass the session; no origin list |
| S4.5 | Associations | Absent | Deep links and file extensions are not namespaced or consented |
| S4.6 | Capability table | Partial | The spec table is new; hosts implement a subset |
| S4.7 | Pack keys | Partial | Packs do not get the device key today; no `identity.pack` API or test |
| S4.8 | Refusal | Implemented | Shell/Go refuse an unimplemented capability by name |
| S5.1 | Deep links | Partial | `suite://` parser exists; version pin is absent; `/workspace/` compatibility is Start-only |
| S5.2 | Document/widget URIs | Absent | No document or widget route |
| S5.3 | Single instance | Partial | Single-instance lock exists; the shell can open several tabs for one pack |
| S5.4 | Lifecycle events | Partial | Launch/hide/close exist; suspend/resume are absent |
| S5.5 | Suspend/resume | Absent | Go has a delayed destroy, not a suspended state |
| S5.6 | TTI | Absent | No measurement |
| S5.7 | Association ownership | Partial | Contributions are registered; no namespacing or second-pack refusal |
| S6.1 | Document envelope | Partial | Host stores opaque bytes; no envelope header, schema version or checksum |
| S6.2 | Host write/backup | Partial | Pack files have atomic write and backup; the host document service does not |
| S6.3 | Pack schema/migration | Partial | Apps own schema and migrations; the host cannot invoke a declared entry |
| S6.4 | Newer document | Partial | Apps refuse newer files; the Screen store quarantines and starts fresh |
| S6.5 | Mergeable children | Partial | Loro is used; `ensureMergeable*` is not the general rule |
| S6.6 | Migration safety | Partial | Per-app migrations and backups exist; not uniform |
| S6.7 | Blob classes | Absent | No asset/derived/cache store |
| S6.8 | Export | Partial | Canvas and Budget export; Planner only `.planner`; packs, Screens and Space do not |
| S6.9 | Unknown fields | Partial | Payloads are opaque; host-owned documents have limited preservation |
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
| S9.6 | Screen ownership | Implemented | Screens are host-owned; settings go through the host |
| S9.7–S9.8 | Screen export and identity | Absent | No `.screen` file; no pack identity in the widget frame |
| S10.1–S10.4 | Native, transitions, input | Absent | No declarative native components, host transitions or input-profile refusal |
| S10.5 | No spinners | Implemented | Local edits do not wait on a network round trip |
| S10.6–S10.7 | Prefetch and TTI | Absent | No warm view, prefetch or TTI budget |
| S11.1 | No ambient data | Implemented | Packs cannot enumerate another pack's documents |
| S11.2 | Explicit handles | Partial | External picker and handles exist; share/drag is partial |
| S11.3–S11.4 | Search and shared space | Absent | No metadata index, pack search entry or `documents.shared` |
| S11.5 | Platform APIs | Future | Deferred by contract |
| S12.1 | Side-load | Implemented | A local catalogue and file install verify and install without a network |
| S12.2–S12.5 | Catalogue and revocation | Absent | No signed index, sequence, attestation, review state or revocation |
| S12.6 | Updates | Partial | Additive installs keep the previous version; no delta or rollback pointer |
| S12.7 | Install TOCTOU | Absent | The installed bytes are not compared with the displayed catalogue entry |
| S12.8 | Channels | Implemented | Channels and the Flatpak remote are documented and shipped |
| S13.1 | Threat model | Implemented | Sync and app threat models exist |
| S13.2 | Host boundary | Partial | Desktop has per-pack origin/session; mobile is same-origin |
| S13.3 | Sandbox | Implemented | `contextIsolation`, sandbox, CSP, navigation lock and no Node |
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
| S3.3–S3.4 | New fields are unsigned and there is no golden vector, so a second implementation cannot verify the format | Pack |
| S2.1–S2.5 | No publisher identity, trust store, rotation or revocation; side-loading is first-party only | Pack, shell |
| S6.1–S6.3 | No document envelope or host-invoked migration, so the never-parse rule and pack-owned schema cannot both hold | Shell, document-runtime |
| S4.2–S4.5 | No consent record or network allowlist; external links and associations bypass the boundary | Shell, Go |
| S7.2–S7.6 | No per-document key, relay verification, header index or gap recovery | Sync |
| S9.2–S9.4 | No code-widget sandbox, fallback or data scope | Shell |
| S14.1, S14.5 | Export and key recovery are absent, so the longevity test fails | Shell, Start, Sync |
