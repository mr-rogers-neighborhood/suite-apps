---
name: suite-release
description: Publish a Suite channel. Use only when the owner explicitly asks to release, promote, or publish a Flatpak or APK. Covers the signed OSTree remote, GitHub release mirror, channels, signing keys, and the gate proof.
argument-hint: "[slop|nightly|preview|stable]"
disable-model-invocation: true
---

# Release a channel

Side effects: signing, publishing, and immutable releases. Run only when the owner names a channel
and asks for it. Never rotate or create a key, never publish to a remote, and never re-tag a release
without an explicit instruction.

## Preconditions

- Clean working tree.
- A gate status at `HEAD` that is `ok`, `fresh: true`, and **not** `--only`. `gateProblems()`
  refuses a dirty tree or an `--only` status.
- The channel is one of `slop`, `nightly`, `preview`, `stable`. `canary` and `beta` are refused,
  not aliased.
- Release secrets exist only in the `release` environment. Never put a key in the repo or in
  `.dev/`.

## Flow

`.github/workflows/release.yml`:

```text
workflow_dispatch / workflow_call
  → approval (preview, stable; skipped for nightly)
  → gate
  → sign + attest
  → draft release
  → attach assets
  → publish signed Flatpak remote
  → verify a clean install
  → publish drafts
```

`mise exec -- node scripts/release-suite.mjs` without `--publish` prints the steps and changes
nothing. Read `docs/how-to/package-and-release.md` for the individual commands.

## Invariants

- Tags never move. `planTag` refuses divergence. Published releases are immutable.
- `RELEASES.md` is generated in the runner and is not committed; the committed copy can lag by
  design.
- The signed Flatpak remote is the update path; GitHub Releases are the human mirror. The rolling
  `suite-<date>` release is Latest; per-app releases are retired.
- Stable and pre-release are two ids: `run.suite.<app>` and `run.suite.slop.<app>`. The channel is
  the OSTree branch. Pre-release channels install side by side.
- `--target s3` publishes to `https://flatpak.suite.run`; `--target lan` is the test host. A
  publication merges refs already in the bucket so one channel does not drop another.
- Android: `versionCode = base × 10 + channel digit` (stable 0, slop 1, nightly 2, preview 3). The
  built APK's certificate must match the pinned digest and its package id, version code, and
  version name must match. A mismatch is a refusal.
- A verification that depends on the network failing is a release failure, not a warning.

## Reporting

State the channel, the tag, the commit, whether the gate was fresh, what was signed, and what was
verified. If any step was skipped, say so; do not describe an unattended nightly as reviewed.
