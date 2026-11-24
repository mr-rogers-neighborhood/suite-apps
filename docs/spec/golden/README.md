# Golden vector (S3.4)

One signed pack manifest that a second implementation can verify with no shared code. The spec is
[§3 S3.4](../superapp.md#3-pack-format-canonical-bytes-and-manifest); the evidence is the
[ledger row](../ledger.md).

| File | Contents |
| --- | --- |
| [manifest.json](manifest.json) | The full signed manifest. Authored in a readable order, not the canonical order. |
| [canonical.json](canonical.json) | The exact bytes the signature covers: 1352 UTF-8 bytes, one line, no trailing newline. |
| [signature.b64](signature.b64) | The Ed25519 signature, standard base64 of 64 bytes. It equals `manifest.json`'s `signature` field. |
| [public-key.b64](public-key.b64) | The Ed25519 public key, standard base64 of 32 bytes. It equals `publisher.key` in the manifest. |

## Scheme

Ed25519 follows RFC 8032. The signature covers `canonical.json`, not the JSON text of
`manifest.json`: a reader rebuilds the canonical bytes from the manifest and compares them to
`canonical.json` before verifying.

The canonical form is the S3.3 rule:

- Fields appear in the fixed order `format`, `id`, `name`, `description`, `version`, `entry`,
  `contractVersion`, `minimumHostVersion`, `publisher`, `capabilities`, `optionalCapabilities`,
  `documents`, `blobs`, `sync`, `network`, `platforms`, `input`, `defaultLocale`, `locales`,
  `widgets`, `codeWidgets`, `components`, `contributions`, `subpackages`, `addons`, `export`,
  `license`, `source`, `deprecated`, `replacement`, `sunset`, `files`, with `signature` excluded.
- An absent optional field contributes no key; the canonical form never contains `null`.
- `capabilities`, `optionalCapabilities`, `contributions.fileExtensions` and
  `contributions.deepLinks` are deduplicated and sorted by UTF-16 code unit.
- `files` is sorted by `path` after each file's keys are put in code-unit order.
- Every other object has its keys in code-unit order; array order is preserved.
- The result is serialised with no whitespace.

This vector was chosen to exercise those rules: the manifest lists `relay` before `documents`, lists
files in a non-canonical order, writes nested keys out of order, and omits every optional field it
does not use.

## How it was produced

A fresh throwaway Ed25519 key pair was generated. `@suite/pack`'s `canonicalManifestBytes` produced
the canonical bytes and `signPackManifest` produced the signature. The secret half was discarded; it
is not a release key and is not committed. The vector only has to verify, not to be re-signed.

## How to reproduce

```sh
mise exec -- pnpm spec:check
mise exec -- node scripts/spec-golden.mjs
```

`scripts/spec-golden.mjs` is the independent verifier: it imports `node:crypto` and nothing from the
workspace. It rebuilds the canonical bytes from `manifest.json`, compares them to `canonical.json`,
and verifies the signature against `public-key.b64`. `scripts/spec-golden.test.mjs` runs the same
checks under `pnpm spec:check` and adds the two tamper cases: one flipped byte in the canonical form
fails, and one flipped byte in the signature fails.

Do not re-sign or edit this vector to make a failing check pass. If the canonicaliser and the spec
disagree, the spec is the target and the canonicaliser is the bug.
