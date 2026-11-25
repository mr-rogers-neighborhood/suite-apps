# `@suite/pack`

The Suite pack contract for the desktop host: the manifest, signature and capability contract that
`apps/desk` installs and verifies.

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
  "minHost": 1,
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

## Rings and the host floor

A pack is versioned, not channelled (S12.8). Two signed fields let a host decide what to offer
without teaching the pack anything about how the host ships (S3.11):

| Field     | Values                             | Absent means |
| --------- | ---------------------------------- | ------------ |
| `ring`    | `stable`, `preview`                | `stable`     |
| `minHost` | an integer host version, 1 or more | no floor     |

- `ring` is the pack's own stability. `slop` and `nightly` are host channels and are refused as a
  ring, as is any other value, because the vocabulary is closed like a capability.
- A version's ring is fixed by its signature. An operator stages a preview by signing a version with
  `ring: "preview"` and publishing it in the next index; promoting it is a new version signed with
  `ring: "stable"`, never a re-signed archive under the same version (S12.10).
- `minimumHostVersion` is the same floor in the spelling a manifest signed before S3.11 carries. A
  manifest may carry either spelling, never both.
- Neither field is written when absent, so a manifest signed before they existed keeps the bytes and
  the signature it already had.

`packRing(manifest)` returns the effective ring, `packMinimumHost(manifest)` the effective floor, and
`packFitsHost(manifest, { contractVersion, hostVersion, rings })` refuses a floor above the host and
a ring the host does not offer. `rings` defaults to `["stable"]`; it is the host's preference and
never something a pack can widen.

## Catalogue index

A catalogue is an optional list of signed packs (S12.2). The index is a versioned JSON document
signed by **operator** keys — a trust root separate from a pack's publisher key. A host with no
operator key can still side-load packs (S12.1); it just has no catalogue. Nothing here verifies an
index with a pack key, and nothing verifies a pack with an operator key.

```json
{
  "format": "suite.catalogue",
  "version": 1,
  "sequence": 7,
  "generatedAt": "2026-01-01T00:00:00.000Z",
  "previous": "…digest of the index this replaces…",
  "expires": "2026-02-01T00:00:00.000Z",
  "threshold": 2,
  "entries": [
    {
      "id": "canvas",
      "name": "Canvas",
      "publisher": "suite",
      "version": "0.2.0",
      "description": "A whiteboard for the Suite.",
      "capabilities": ["files", "relay"],
      "size": 12345,
      "sha256": "…archive SHA-256…",
      "url": "https://packs.suite.run/canvas-0.2.0.suitepack"
    }
  ],
  "signatures": [{ "key": "…operator public key…", "signature": "…" }]
}
```

- `sequence` increases; an equal or lower value is a rollback and is refused.
- `previous` is the `packIndexDigest` of the index being replaced. Sequence 1 omits it; every later
  index must name its predecessor.
- `expires` is an instant; an index past it is refused.
- `threshold` is inside the signed bytes, so it cannot be lowered without the operator signatures. A
  host counts distinct pinned operator keys whose signature verifies and requires that many.
- An entry is safe only when `id`, `publisher` id, version, hash and URL pass the same rules a pack
  does. The host still verifies the downloaded pack's manifest signature and file hashes (S12.7); an
  index entry is a claim, not the proof.

The entry above is index `version` 1, which is what the builder writes today. S12.9 defines
`version` 2: the entry gains `ring`, `minHost` and the manifest `signature`, and the archive's `url`,
`size` and `sha256` move under `archive`. This package does not parse v2 yet; the reader, the builder
and the host's ring preference switch together.

`parsePackIndexJson`, `verifyPackIndex` and `packIndexDigest` are the shared implementation. The
canonical bytes reuse the S3.3 rules in `canonical.ts`: fixed field order, an absent optional field
omitted, nested keys in code-unit order, entries and capabilities sorted, and a duplicate key
refused before parsing. The index's `signatures` is excluded, exactly as a manifest's `signature`
is. Limits are `MAX_INDEX_BYTES`, `MAX_INDEX_ENTRIES` and `MAX_INDEX_SIGNATURES`.

The index is produced from the archives the pack build already writes, not by hand:

```sh
mise exec -- pnpm pack:index -- --out index.json --url-base https://packs.suite.run/ \
  --sequence 7 --previous <digest> --expires 2026-02-01T00:00:00.000Z \
  --key <operator key> dist/*.suitepack
```

Each archive's manifest signature and every file hash are verified before its entry is written.
`scripts/release-index.mjs` runs the builder in the release job, chains `sequence` and `previous` from
the published copy, and uploads it with its detached signature to the Flatpak remote's own origin.
Review attestations and revocation are later seams.

## Card sidecars

A published pack has a card beside its archive for a catalogue's shadow tiles. The card is not in
the signed index: a host derives its URL from the verified entry's archive URL
(`<id>-<version>.suitepack` → `<id>-<version>.card.json`), fetches the small JSON document and draws
the tile without the archive. `parsePackCard`, `cardUrlForArchiveUrl`, `cardFileNameFor` and the
`PACK_CARD_FORMAT` / `PACK_CARD_VERSION` constants are the pure contract this package exports for
the phone and the release build. The format itself is owned by
[Packaging channels](../../docs/reference/packaging-channels.md#packs-and-cards).

## What this package owns

- `parsePackManifest` and the Zod schema, with actionable issues: including the closed ring
  vocabulary and the `minHost` host floor under either spelling.
- `packRing` and `packMinimumHost`: the effective ring and floor, with absence defaulted to `stable`
  and no floor.
- `canonicalManifestBytes`, the exact bytes a signature covers. Capabilities and files are sorted (paths by UTF-16 code unit, never by locale); command and menu order is preserved.
- `canonicalPackIndexBytes`, `parsePackIndexJson`, `verifyPackIndex`, `signPackIndex` and `packIndexDigest`: the catalogue index, signed by operator keys.
- `parsePackCard`, `cardUrlForArchiveUrl`, `cardFileNameFor` and the card constants: the presentation sidecar that keeps the strict index entry free of card fields.
- `packFitsHost` and `packAllows`.
- `signPackManifest`, `verifyPackSignature`, `digestPackFiles`, `verifyPackFiles`, `sha256Hex`.
- `publisherKeyFingerprint`, `checkPublisherTrust` and `addTrustedPublisher`: the publisher fingerprint, the trust-store match and the fingerprint-confirmed addition.
- `generatePackKeyPair` for the build script and tests.
- `SUITE_PACK_PUBLIC_KEY` and `SUITE_INDEX_PUBLIC_KEY` at `src/pinnedKey.ts`, exported as `@suite/pack/pinned-key`: the one pack signing key and the one catalogue operator key the phone and the desktop both trust. A host imports them; it does not keep a second copy.

It is pure: no Node, no Electron, no filesystem. `@noble/ed25519` and WebCrypto are the only crypto dependencies.

## Capabilities

`documents`, `storage`, `files`, `recents`, `notifications`, `network`, `relay`, `commands`.

A host refuses a capability it does not implement. `files` is the pack's scoped storage; `relay` is an opaque frame transport, not a general socket; `commands` is the pack's contribution to the host chrome.

## What this package does not own

- Host policy: which capabilities this host implements, path scoping, size limits, TLS pinning, pack installation, or where the trust store lives.
- The pack archive format. `@suite/pack-host` owns the safe archive reader and writer; the manifest and hashes are what this package verifies.
- Any domain document format.
