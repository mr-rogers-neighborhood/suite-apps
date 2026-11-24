# `@suite/pack`

The Suite pack contract for the desktop host: the manifest, signature and capability contract that
`apps/shell` installs and verifies.

The pinned key and the capability vocabulary are shared with Suite Go, but the manifest format is
not. Go's manifest requires `independent` and `isolation`, has its own capability list and different
canonical bytes, so a Go `.pack` is refused by this parser and a desktop `.suitepack` by Go.
Unifying the two is #202; [Status](../../docs/reference/status.md) records the current split.

A pack is a signed bundle. The manifest declares what the pack is, which entry the host loads, what it may ask for, what it contributes to the host chrome, and the SHA-256 of every file. The Ed25519 signature covers the manifest; the hashes cover the files. A host verifies both before it runs anything.

## Publisher trust

`publisher` names the key that signed the pack and the stable id that key belongs to. The host does not trust "the Suite key" as a fact of the format: it resolves `publisher.key` against its **local trust store**, then verifies the signature with that key. A signature proves the pack came from whoever holds a key; the store is the person's decision about who that is.

- The first-party Suite key is preinstalled. Its id is `suite`.
- Another key is added only after the person sees its fingerprint: the SHA-256 of the 32 raw key bytes, written as upper-case pairs joined by colons (`AB:CD:…:89`).
- A pack signed by a key the store does not hold is refused, and the refusal carries the fingerprint so it can be compared before anything is added.
- A manifest without `publisher` is accepted only for an install from before this seam, and only under the preinstalled first-party key. A new install must name its publisher.
- A manifest that names a key but no `publisher.id` is identified by that key's digest (S2.2), which is what an added key without an id is stored under.

`packages/pack` owns the fingerprint, the store match and the confirmation check (`checkPublisherTrust`, `addTrustedPublisher`, `publisherKeyFingerprint`). It does not own the store: the desktop host keeps it under its data root and the phone will keep its own. A publisher id is stable across a key rotation; a new key under the same id is a signed rotation, which is a separate seam.

The install identity is `(publisher id, pack id)`. A different publisher under an existing id needs an explicit migration and inherits no documents, blobs, storage or grants.

```json
{
  "format": "suite.pack",
  "id": "canvas",
  "name": "Canvas",
  "version": "0.2.0",
  "entry": "index.html",
  "contractVersion": 1,
  "minimumHostVersion": 1,
  "publisher": {
    "id": "suite",
    "key": "…32-byte Ed25519 public key, standard base64…"
  },
  "capabilities": ["files", "relay", "commands", "notifications"],
  "contributions": {
    "commands": [{ "id": "canvas.new-card", "title": "New card" }],
    "menus": [{ "menu": "file", "command": "canvas.new-card" }],
    "fileExtensions": [".canvas"],
    "deepLinks": ["canvas"]
  },
  "files": [
    { "path": "index.html", "sha256": "…", "bytes": 1234 },
    { "path": "assets/app.js", "sha256": "…", "bytes": 4567 }
  ],
  "signature": "…"
}
```

## What this package owns

- `parsePackManifest` and the Zod schema, with actionable issues.
- `canonicalManifestBytes`, the exact bytes a signature covers. Capabilities and files are sorted (paths by UTF-16 code unit, never by locale); command and menu order is preserved.
- `packFitsHost` and `packAllows`.
- `signPackManifest`, `verifyPackSignature`, `digestPackFiles`, `verifyPackFiles`, `sha256Hex`.
- `publisherKeyFingerprint`, `checkPublisherTrust` and `addTrustedPublisher`: the publisher fingerprint, the trust-store match and the fingerprint-confirmed addition.
- `generatePackKeyPair` for the build script and tests.
- `SUITE_PACK_PUBLIC_KEY` at `src/pinnedKey.ts`, exported as `@suite/pack/pinned-key`: the one pack signing key the phone and the desktop both trust. A host imports it; it does not keep a second copy.

It is pure: no Node, no Electron, no filesystem. `@noble/ed25519` and WebCrypto are the only crypto dependencies.

## Capabilities

`documents`, `storage`, `files`, `recents`, `notifications`, `network`, `relay`, `commands`.

A host refuses a capability it does not implement. `files` is the pack's scoped storage; `relay` is an opaque frame transport, not a general socket; `commands` is the pack's contribution to the host chrome.

## What this package does not own

- Host policy: which capabilities this host implements, path scoping, size limits, TLS pinning, pack installation, or where the trust store lives.
- The pack archive format. `@suite/pack-host` owns the safe archive reader and writer; the manifest and hashes are what this package verifies.
- Any domain document format.
