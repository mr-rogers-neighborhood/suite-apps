# Implementation ledger

The spec is the target. This page is the evidence. Status is `implemented`, `partial`, `absent` or
`future`; a clause with no test or owning file is not implemented.

| § | Area | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Scope and terms | — | This page defines the vocabulary; no code claim |
| 2 | Roles and trust | Partial | Host/pack signature and hash checks work; a catalogue does not exist; the relay verifies the workspace/role but not the frame signature in the shipped path |
| 3 | Pack and manifest | Partial | Signed `.suitepack`, per-file hashes and host-fit checks; the new `documents`, `blobs`, `sync`, `network`, `platforms`, `input`, `subpackages` and `addons` fields are absent; desktop and Go still have two manifest formats (#202) |
| 4 | Capabilities and consent | Partial | Declared capabilities are enforced by the shell and Go; there is no per-scope consent UI, no network allowlist and no update capability diff |
| 5 | Addressing and lifecycle | Partial | The shell parses `suite://`, locks one instance and keeps hidden tabs; Go has no deep links; suspend/resume and TTI are absent |
| 6 | Documents and blobs | Partial | Canvas, Planner and Budget own Loro documents with backups, locks and migrations; a pack document is opaque bytes in the host data root; there is no asset/derived/cache blob service |
| 7 | Sync and sharing | Partial | Canvas and Planner use a real MLS relay with sealed frames; there is no version-vector exchange, gap recovery or attachment sync; no host implements the pack sync capability; Canvas has no auto-reconnect |
| 8 | Branches and review | Absent | Loro provides `fork`, `diff` and `applyDiff`; the branch, suggestion and review layer does not exist |
| 9 | Widgets and Screens | Partial | Start renders declarative widgets and host-owned Screens; the shell is partial; capture handoff, code widgets and a portable `.screen` file are absent |
| 10 | Native surface, input and performance | Absent | No declarative native components, TTI, prefetch or warm-view pool |
| 11 | Cross-app data | Partial | No ambient cross-app access; host recents exist; the opt-in metadata index and `documents.shared` profile do not |
| 12 | Catalogue and distribution | Partial | A local drop directory installs verified packs; there is no signed remote index, review attestation or advisory revocation |
| 13 | Security and privacy | Partial | Per-pack origin/session isolation and MLS encryption work; the shipped relay calls `verifyFrame: () => true`; consent and the network allowlist are missing |
| 14 | Longevity and compatibility | Partial | Canvas and Budget export; Planner exports only `.planner`; packs, Screens and the shell space have no export; the two contract-version domains are not unified |
| 15 | Conformance | New | `scripts/spec.test.mjs` checks the schema, a fixture and ledger coverage |
| 16 | Future work | Future | TV/IoT, payments, platform data APIs, registry auto-update, vehicle and branch-scoped membership |

## Blocking gaps

These are the clauses a host cannot claim today, in the order they block a credible conformance
claim.

| Gap | Why it blocks | Owner |
| --- | --- | --- |
| Relay frame signatures | The shipped relay accepts frames with `verifyFrame: () => true`; a compromised relay or network path is not the claimed model | Sync |
| Consent and network allowlist | A declaration is not an authorization; a pack can reach any `https`/`wss` origin with `network` | Shell, Go |
| Pack document and blob contract | A pack cannot declare a document, an asset or a sync scope, so user data stays opaque bytes in the host root | Pack, shell |
| Version vectors and gap recovery | A device behind retention has no snapshot request path; reconnect publishes a whole snapshot | Sync |
| Canvas durability and reconnect | A relay-applied edit is not marked dirty for the file, and Canvas has no automatic retry | Canvas |
| Pack, Screen and Space export | The longevity test fails for the pack, the Screen and the shell space | Shell, Start |
| One pack format and one contract version | Desktop and Go refuse each other's manifest; `1` and `1.1.0` name different domains | Pack, Go |
| Truthful claims | Contributions are parsed but not rendered; the packaged shell registers `suite://`; Go has no widget adapter | Shell, Go, docs |
