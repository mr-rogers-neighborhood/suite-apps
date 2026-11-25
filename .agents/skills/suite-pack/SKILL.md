---
name: suite-pack
description: Change the Suite pack contract or host. Use for pack manifests, capabilities, signing, publisher trust, catalogue, .suitepack archives, pack host views, or the Go container.
---

# Pack contract and host

A pack is a signed web bundle with a manifest. The host verifies the publisher key and every file
hash, gives the pack its own origin and session, and enforces the declared capabilities. The host
carries bytes and never parses a document. Read `docs/spec/superapp.md`,
`docs/spec/ledger.md`, and `docs/reference/decisions.md` before changing behaviour.

## Boundaries

| Package / app | Owns | Must not |
| --- | --- | --- |
| `packages/pack` | manifest, capabilities, canonical bytes, Ed25519 verify, pinned keys, trust | import Electron or Node |
| `packages/pack-host` | archive reader/writer, scoped files, locks, backups | import Electron |
| `packages/pack-runtime` | pack-side service types only | carry host policy |
| `apps/shell` | desktop host: views, sessions, consent, documents, catalogue | parse a pack document |
| `apps/go` | mobile container: iframe realm, IndexedDB documents, flush handshake | parse a document or learn a domain name |

## The live split (#202)

There is one `format: "suite.pack"` but two incompatible implementations:

- `apps/shell` uses `@suite/pack` — multi-publisher trust, rotation, documents, contributions,
  `HOST_CONTRACT_VERSION = 1`.
- `apps/go` uses `apps/go/packages/go/src/pack.ts` — one compiled pin, `independent` + `isolation`,
  a different canonical byte order, `HOST_CONTRACT_VERSION = 2`.

A pack built for one host is refused by the other. Do not "fix" one manifest to serve both without
reading the decision record; the golden vector covers the desktop shape only.

## Change checklist

- Capability is in the closed vocabulary; unknown fields and unknown capabilities are refused.
- Publisher trust is checked before signature verification; fingerprint is the SHA-256 of the raw
  key. A rotation or revocation path must not bypass the pin.
- Canonical bytes: fixed field order, absent optionals omitted (never `null`), deterministic sorts.
- Duplicate JSON keys are refused before `JSON.parse` at the host entry point, not only in the
  parser helper.
- File set and every size/hash are verified on install **and** on every load. Reject extra files.
- Origin and session are per pack on desktop; navigation, `window.open`, downloads, and permissions
  are denied; `contextIsolation` and `sandbox` stay on; no `nodeIntegration`.
- A capability is checked per call and by the resolved sender, not once at open. Missing capability
  is a refusal, not an empty success.
- Document and external-file handles are opaque tokens. Absolute paths stay in main.
- Network is enforced by the host, not only parsed from the manifest.

## Verification

- Unit tests in `packages/pack` and `packages/pack-host`.
- The golden vector: `mise exec -- node --test scripts/spec.test.mjs scripts/spec-golden.test.mjs`.
- A signed pack round-trip through the pack script with an ephemeral key.
- The owning gate row. A spec change updates `docs/spec/superapp.md`, `docs/spec/ledger.md`, and the
  golden fixture in the same change.
