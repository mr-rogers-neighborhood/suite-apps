# `@suite/pack`

The Suite pack contract: the shared manifest, signature and capability contract for desktop and mobile. Suite Go's manifest builds on it with the `independent` and `isolation` fields; the desktop host reads the contract as written here.

A pack is a signed bundle. The manifest declares what the pack is, which entry the host loads, what it may ask for, what it contributes to the host chrome, and the SHA-256 of every file. The Ed25519 signature covers the manifest; the hashes cover the files. A host verifies both before it runs anything.

```json
{
  "format": "suite.pack",
  "id": "canvas",
  "name": "Canvas",
  "version": "0.2.0",
  "entry": "index.html",
  "contractVersion": 1,
  "minimumHostVersion": 1,
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
- `generatePackKeyPair` for the build script and tests.
- `SUITE_PACK_PUBLIC_KEY` at `src/pinnedKey.ts`, exported as `@suite/pack/pinned-key`: the one pack signing key the phone and the desktop both trust. A host imports it; it does not keep a second copy.

It is pure: no Node, no Electron, no filesystem. `@noble/ed25519` and WebCrypto are the only crypto dependencies.

## Capabilities

`documents`, `storage`, `files`, `recents`, `notifications`, `network`, `relay`, `commands`.

A host refuses a capability it does not implement. `files` is the pack's scoped storage; `relay` is an opaque frame transport, not a general socket; `commands` is the pack's contribution to the host chrome.

## What this package does not own

- Host policy: which capabilities this host implements, path scoping, size limits, TLS pinning, or pack installation.
- The pack archive format. `@suite/pack-host` owns the safe archive reader and writer; the manifest and hashes are what this package verifies.
- Any domain document format.
