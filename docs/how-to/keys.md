# Manage signing keys

Two keys sign things the Suite ships, and neither private half belongs in this repository. Each one
has a public half pinned in the source that verifies it, so the question a build actually needs
answered is narrow: **is the key on this machine the key this tree trusts?** `pnpm keys` answers it.

## What exists

| Key | Signs | Algorithm | Private half | Public half pinned in |
| --- | --- | --- | --- | --- |
| Pack signing | a signed app pack the phone and the desktop install | Ed25519 | `pack-key` | `SUITE_PACK_PUBLIC_KEY`, `packages/pack/src/pinnedKey.ts` |
| Update signing | nothing the suite ships any more; it signed the retired relay tarball's `SHA256SUMS` | Ed25519 | `update-key.pem` | `SUITE_UPDATE_PUBLIC_KEY`, `packages/desktop/src/updateSignature.ts` |

The Flatpak store key is a third secret with a different job; [Packaging
channels](../reference/packaging-channels.md#signing) owns it and this page does not restate it. The
Android release keystore is a fourth, and [Android](../../apps/go/docs/reference/android.md) owns it.

## Where they live

```
~/.config/suite/keys/
  pack-key          base64 PKCS#8, one line
  update-key.pem    PKCS#8 PEM
```

The directory is `$XDG_CONFIG_HOME/suite/keys` when that variable is set, and `SUITE_KEYS_DIR` moves
the whole directory. The directory is readable by its owner only and each key is mode `0600`.

`SUITE_PACK_KEY` and `SUITE_UPDATE_KEY` still name a key file elsewhere, which is what a different
machine or a test uses. Neither is required: the paths above are the default.

The pack key used to live in `apps/go/.dev/`, which is the scratch directory the build replaces. A
cleanup took the only copy, and the pin was left with no key able to satisfy it. Nothing durable
belongs in a generated directory, and no script here looks for one there.

## Check a machine

```sh
pnpm keys status            # what is here, and whether each pin accepts it
pnpm keys status --strict   # also fail when a key is absent
```

Each line names the key, its fingerprint in groups of eight, and the constant it matches. The
fingerprint is SHA-256 over the public key's SPKI DER, first 128 bits — the same rule
`updateKeyFingerprint()` uses in `@suite/desktop`, so a number printed here and a number computed by
an app are comparable.

Three outcomes matter:

- **absent** — a clean checkout does not sign anything, so this is not a failure. `--strict` is for a
  machine that is expected to sign.
- **matches** — this key signs artifacts the tree accepts.
- **mismatch** — the key is the wrong one. A pack signed with it is refused on the device as
  `untrusted`; a feed signed with it is refused by every installed app. The command exits non-zero
  and prints both fingerprints.

## Make a key

```sh
pnpm keys generate pack
pnpm keys generate update
```

Each writes the private half to `~/.config/suite/keys/`, readable by its owner alone, and prints only
the public half and the fingerprint. It refuses to replace an existing key unless `--force` is passed:
an overwritten key leaves every artifact signed with it unverifiable and the old private half gone.

Put the printed public half in the constant named above, in the same change. A deal where the pin
points at a key whose private half nobody kept is the failure this page exists to prevent — it
cannot be detected by building, only by trying to sign.

`pnpm pack:keygen` still prints a pair without storing either half. Use it for a throwaway key in a
test, never for one that gets pinned.

## Rotate

A pin is a trust root, so rotation is a sequence, not an edit.

**Pack key.** Generate, pin `SUITE_PACK_PUBLIC_KEY` in `packages/pack/src/pinnedKey.ts`, rebuild every
pack and reinstall them. The pin is shared: Suite Go re-exports it as `PACK_PUBLIC_KEY` and the desktop
host verifies with the same constant, so no host has a second copy. But the pin is a trust root, not
an install-time receipt: the shell re-verifies every installed manifest at boot, so moving the pin
makes packs signed with the old key fail as `untrusted` and they stop loading. A rotation therefore
refuses the old packs; rebuild and reinstall them, and ship the new pin with those packs.

**Update key.** It signed the relay tarball's checksum list. The relay installs as a Flatpak now and
no release signs with this key, so it has no artifact to trust; it and its pin are kept until they are
retired deliberately, and `pnpm keys status` still proves the two agree. The Flatpak store key is
separate and rotates on the remote; see [Packaging
channels](../reference/packaging-channels.md#signing).

## Back up

Copy both files somewhere you control, outside the repository, and record the fingerprints
`pnpm keys status` prints beside the copy. A restored key is the same key when the fingerprint is the
same; a key that produces a different one is a different trust root, however similar the file looks.

What losing each key costs:

- **Update signing key** — nothing shipped depends on it any more; a future artifact that wants the
  pin would need a new key and that key's fingerprint recorded with its release.
- **Pack signing key** — a new key and a new pin; packs signed with the old one are refused and every
  installed pack signed with it must be rebuilt and reinstalled.

A secret is not a backup because it was committed to a remote: nobody can read it back. GitHub's
secret store, when a service uses one, never shows a value again.

## What this repository never contains

- A private key, in any file, in any commit, in any `.dev/` or build directory.
- A pin whose private half was never stored anywhere.
- A signing step that reads a key from the working tree.

`pnpm keys status` is the check before a release and after restoring a machine. It reads keys, and it
never writes one except through `generate`.
