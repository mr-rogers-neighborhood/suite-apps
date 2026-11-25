# Manage signing keys

Four keys sign things the Suite ships, and no private half belongs in this repository. Each one
has a public half pinned in the source that verifies it, so the question a build actually needs
answered is narrow: **is the key on this machine the key this tree trusts?** `pnpm keys` answers it
for the pack and update keys, `pnpm android:key` answers it for the Android keystore, and
`packages/pack/src/pinnedKey.test.ts` answers it for the catalogue operator pin.

## What exists

| Key | Signs | Algorithm | Private half | Public half pinned in |
| --- | --- | --- | --- | --- |
| Pack signing | a signed app pack the phone and the desktop install | Ed25519 | `pack-key` | `SUITE_PACK_PUBLIC_KEY`, `packages/pack/src/pinnedKey.ts` |
| Update signing | nothing the suite ships any more; it signed the retired relay tarball's `SHA256SUMS` | Ed25519 | `update-key.pem` | `SUITE_UPDATE_PUBLIC_KEY`, `packages/desktop/src/updateSignature.ts` |
| Catalogue operator | the signed pack index | Ed25519 | `SUITE_INDEX_KEY` in the `release` environment | `SUITE_INDEX_PUBLIC_KEY`, `packages/pack/src/pinnedKey.ts` |
| Android release | every Suite Go APK, on all four channels | RSA-4096 certificate | `suite-go-release.jks` and `suite-go-release.pass` | `ANDROID_RELEASE_CERT_SHA256`, `scripts/lib/androidKey.mjs` |

The catalogue operator pin's fingerprint is
`77:F5:4E:74:8A:AF:47:67:45:31:E9:4F:A7:6A:CA:72:F2:85:95:F1:EF:61:40:62:61:36:AC:AC:47:CB:3B:A1`.
That is the value `SUITE_INDEX_PUBLIC_KEY` hashes to, and the one test beside the pin recomputes it
with the same SHA-256 rule `publisherKeyFingerprint` applies. Both hosts import the constant, so a
rotation changes it once and ships one release.

The Flatpak store key is a separate secret with a different job; [Packaging
channels](../reference/packaging-channels.md#signing) owns it and this page does not restate it.

## Where they live

```
~/.config/suite/keys/
  pack-key                 base64 PKCS#8, one line
  update-key.pem           PKCS#8 PEM
  suite-go-release.jks     PKCS#12 keystore
  suite-go-release.pass    the keystore's store password
```

The directory is `$XDG_CONFIG_HOME/suite/keys` when that variable is set, and `SUITE_KEYS_DIR` moves
the whole directory. The directory is readable by its owner only; each key and the password file are
mode `0600`.

`SUITE_PACK_KEY` and `SUITE_UPDATE_KEY` still name a key file elsewhere, which is what a different
machine or a test uses. Neither is required: the paths above are the default. The Android key has
the same escape hatches — `SUITE_GO_KEYSTORE` and `SUITE_GO_KEYSTORE_PASSWORD` — and
`SUITE_GO_KEY_ALIAS` overrides the `suite-go` alias. The catalogue operator key is a release
secret, read from `SUITE_INDEX_KEY` in the release environment rather than from this directory.

The pack key used to live in `hosts/go/.dev/`, which is the scratch directory the build replaces. A
cleanup took the only copy, and the pin was left with no key able to satisfy it. Nothing durable
belongs in a generated directory, and no script here looks for one there.

## Check a machine

```sh
pnpm keys status            # what is here, and whether each Ed25519 pin accepts it
pnpm keys status --strict   # also fail when a key is absent
pnpm android:key status     # the Android keystore's certificate against its fingerprint pin
```

Each `pnpm keys` line names the key, its fingerprint in groups of eight, and the constant it matches.
The fingerprint is SHA-256 over the public key's SPKI DER, first 128 bits — the same rule
`updateKeyFingerprint()` uses in `@suite/desktop`, so a number printed here and a number computed by
an app are comparable.

`pnpm android:key status` prints the certificate's full SHA-256 digest, which is the form Android
compares when it accepts an update, and whether `ANDROID_RELEASE_CERT_SHA256` names it.

Three outcomes matter:

- **absent** — a clean checkout does not sign anything, so this is not a failure. `--strict` is for a
  machine that is expected to sign.
- **matches** — this key signs artifacts the tree accepts.
- **mismatch** — the key is the wrong one. A pack signed with it is refused on the device as
  `untrusted`; a feed signed with it is refused by every installed app; an Android update signed with
  it is refused by the phone. The command exits non-zero and prints both fingerprints.

## Make a key

```sh
pnpm keys generate pack
pnpm keys generate update
pnpm android:key generate
```

The first two write the private half to `~/.config/suite/keys/`, readable by its owner alone, and
print only the public half and the fingerprint. `pnpm android:key generate` writes
`suite-go-release.jks` and a generated password in `suite-go-release.pass`, and prints only the
certificate digest. It refuses to replace an existing key unless `--force` is passed: an overwritten
key leaves every artifact signed with it unverifiable and the old private half gone.

Put the printed public half, or certificate digest, in the constant named above, in the same change.
A deal where the pin points at a key whose private half nobody kept is the failure this page exists
to prevent — it cannot be detected by building, only by trying to sign.

`pnpm pack:keygen` still prints a pair without storing either half. Use it for a throwaway key in a
test, never for one that gets pinned.

## Android release keystore

The Android key is not an Ed25519 keypair, so `pnpm keys` does not describe it: it is a PKCS#12
keystore and Android identifies it by the SHA-256 digest of its certificate. `pnpm android:key status`
and `pnpm android:key generate` are its two commands. The certificate is the trust root: a build
machine holding another key, or the debug keystore, produces an APK the phone refuses as an update
to the installed app.

The channel ids, the fingerprint check in the build and the `versionCode` rule belong to [Android
notes](../../hosts/go/docs/reference/android.md#release-signing-and-channels); this page owns where the
key lives, how to make one, and what losing it costs.

## Rotate

A pin is a trust root, so rotation is a sequence, not an edit.

**Pack key.** Generate, pin `SUITE_PACK_PUBLIC_KEY` in `packages/pack/src/pinnedKey.ts`, rebuild every
pack and reinstall them. The pin is shared: Suite Go re-exports it as `PACK_PUBLIC_KEY` and the desktop
host verifies with the same constant, so no host has a second copy. But the pin is a trust root, not
an install-time receipt: the host re-verifies every installed manifest at boot, so moving the pin
makes packs signed with the old key fail as `untrusted` and they stop loading. A rotation therefore
refuses the old packs; rebuild and reinstall them, and ship the new pin with those packs.

**Update key.** It signed the relay tarball's checksum list. The relay installs as a Flatpak now and
no release signs with this key, so it has no artifact to trust; it and its pin are kept until they are
retired deliberately, and `pnpm keys status` still proves the two agree. The Flatpak store key is
separate and rotates on the remote; see [Packaging
channels](../reference/packaging-channels.md#signing).

**Catalogue operator key.** Put the new private key in `SUITE_INDEX_KEY` and set
`SUITE_INDEX_KEY_FINGERPRINT` to its fingerprint, so the release refuses to sign with anything else.
Then update `SUITE_INDEX_PUBLIC_KEY` and `SUITE_INDEX_PUBLIC_KEY_FINGERPRINT` in
`packages/pack/src/pinnedKey.ts` in the same release that publishes the first index signed by the new
key. Both hosts import that constant, so one edit moves the phone and the desktop together. A host
still on the old release refuses the new index until it updates, which is a named refusal a person
sees rather than a catalogue that half works. The signing key and the host pin stay separate values:
the release can sign with a key a host does not trust yet, and that is what makes staging possible.

**Android release key.** Generate a new keystore, pin its digest in `ANDROID_RELEASE_CERT_SHA256`,
and rebuild every channel. Android compares the certificate of an update with the installed app's,
so every installed build signed with the old key is refused; a person has to uninstall it before the
new one installs. There is no side-by-side migration for the same package id, and each pre-release id
is separate from stable and from every other channel. Plan a rotation as a release, not as a machine
setup step. The build steps are in [Android](../../hosts/go/docs/reference/android.md#release-signing-and-channels).

## Back up

Copy each private file somewhere you control, outside the repository, and record the fingerprints
the status commands print beside the copy. A restored key is the same key when the fingerprint is the
same; a key that produces a different one is a different trust root, however similar the file looks.
The Android keystore needs its password file too: a keystore without its password is bytes, not a
key.

What losing each key costs:

- **Update signing key** — nothing shipped depends on it any more; a future artifact that wants the
  pin would need a new key and that key's fingerprint recorded with its release.
- **Pack signing key** — a new key and a new pin; packs signed with the old one are refused and every
  installed pack signed with it must be rebuilt and reinstalled.
- **Android release key** — a new key and a new pin; every installed Suite Go has to be uninstalled
  before a build signed with the new key installs. There is no way to update across a lost key.

A secret is not a backup because it was committed to a remote: nobody can read it back. GitHub's
secret store, when a service uses one, never shows a value again.

## What this repository never contains

- A private key or keystore, in any file, in any commit, in any `.dev/` or build directory.
- A keystore password.
- A pin whose private half was never stored anywhere.
- A signing step that reads a key from the working tree.

`pnpm keys status` and `pnpm android:key status` are the checks before a release and after restoring a
machine. They read keys, and never write one except through `generate`.
