# Delivery specification

Status: draft 0.1. Target for packaging, channels and release. Today's state is in
[Status](../reference/status.md); the open work is [#215](https://github.com/mrrnbhd/suite-apps/issues/215),
[#219](https://github.com/mrrnbhd/suite-apps/issues/219),
[#220](https://github.com/mrrnbhd/suite-apps/issues/220),
[#221](https://github.com/mrrnbhd/suite-apps/issues/221) and
[#222](https://github.com/mrrnbhd/suite-apps/issues/222). The product contract is
[superapp.md](superapp.md); the pipeline is [ci.md](ci.md); the platform matrix is [platforms.md](platforms.md).

The publication workflow is `.github/workflows/release.yml`: a manual
`workflow_dispatch` for the `preview` or `stable` channel, with no pull-request or tag trigger.
`publish` is off by default, so a dispatch rehearses the same gate, build and bundle without touching
a channel; it still needs the environment secrets, because the Android release APK cannot be built or
verified without the release key. Turning it on runs in two environments: `approval` (required
reviewers, restricted to `main` and release tags) gates `preview` and `stable`, and `release` (also
restricted to `main` and release tags, no reviewers) holds the keys and publishes. The nightly skips
`approval` and runs the same workflow for the nightly channel once the `NIGHTLY_PUBLISH` variable is
set. Only the S3 target is wired; the `lan` target stays a workstation
operation. An owner configures that environment with the secrets `SUITE_STORE_KEY`,
`SUITE_STORE_KEY_ID`, `SUITE_GO_KEYSTORE`, `SUITE_GO_KEYSTORE_PASSWORD`, `SUITE_GO_KEY_ALIAS` and
`SUITE_GO_KEY_PASSWORD`, and the variables `AWS_RELEASE_ROLE_ARN`, `SUITE_FLATPAK_S3_BUCKET` and
`SUITE_FLATPAK_CLOUDFRONT_DISTRIBUTION`. A release tag is followed by a dispatch. Publication is
three steps in one run: `release-status.mjs --draft` creates the releases as drafts,
`android-release.mjs --upload` attaches the exact attested APK, and `release-status.mjs --publish`
flips the drafts and writes `RELEASES.md`. `--channel` names the APK asset, the channel in the body, and the release itself: stable is
`suite-YYYY.MM.DD` and Latest; `nightly` and `preview` are `suite-<channel>-YYYY.MM.DD`, marked
pre-release and never Latest, so they stay immutable and out of the stable page. Nightly keeps the
newest 14 releases (`--prune --channel nightly --keep 14`); the stable body links the newest preview
and nightly releases. Each
publication also writes `release-manifest.json` with the commit, the lockfile hash, the artifact
digests and the signer identities, and attaches it to the draft before publication (D2.1). The workflow header records the known limits: the Flatpak
summary is re-signed while the OSTree commit stays fixed (the commit is what is attested), `preview`
still refreshes the rolling release, and `RELEASES.md` is regenerated in the runner rather than
committed.

## 1. Principles

**D1.1** Build once per **identity**. The same commit, lockfile and inputs produce one artifact for
that identity. A stable id and a pre-release id are different identities: they cannot share bytes
because the id is inside the artifact. Promotion never changes source or dependencies.

**D1.2** A channel is a promise about a build, not a branch. Moving a build up a channel changes its
channel identity and metadata; it does not rebuild it from a different commit.

**D1.3** Public distribution is deliberately small: Linux x86_64 Flatpak and Android arm64 APK. Every
other platform is a build/test target until its signing and support story exists. No app store is an
official channel in this version.

**D1.4** Signing keys are trust roots, not CI secrets of convenience. A key lives on the workstation
or in a protected release environment with required reviewers. A pull request never sees one.

**D1.5** A failed release is recoverable. Flatpak can repoint a branch; Android must forward-fix;
packs keep the previous version. No channel may silently erase the last good artifact.

## 2. Artifacts

| Artifact | Identity | Form | Signed by | Public |
| --- | --- | --- | --- | --- |
| Suite Shell stable | `run.suite.shell` | Flatpak OSTree commit on `master` | Store key (summary) | Yes, own remote |
| Suite Shell pre-release | `run.suite.slop.shell` | Flatpak commit on `slop`, `nightly` or `preview` | Store key | Yes, own remote |
| Suite Go stable | `run.suite.go` | APK, stable asset | Android release key | Yes, GitHub release |
| Suite Go pre-release | `run.suite.slop.go` | APK, channel asset | Android release key | Yes, GitHub release |
| Pack | `publisher/id` | `.suitepack` + manifest | Publisher key | Yes, file or catalogue |
| Pack index | catalogue | JSON index + signature | Catalogue operator key | Yes, signed URL |
| Windows/macOS/iOS test build | app id | zip/dmg/simulator app | None (unsigned) | Test only |
| SBOM/provenance | any | attestation | GitHub/Sigstore | Yes, alongside release |

**D2.1** Every artifact has a digest, a source commit, a lockfile hash and a signer identity in a
release manifest. The manifest is the promotion input; a channel points at a manifest entry, never at
a folder.

**D2.2** A pack is versioned, not channelled. A pack update is a new signed version; the host keeps
the previous version for rollback.

## 3. Channels

| Channel | Trigger | Gate | Audience | Publication |
| --- | --- | --- | --- | --- |
| `slop` | A branch or session build | Fast checks only; no e2e | The person and agents working on it | Local/session artifact; never a public channel |
| `nightly` | Schedule from `main` (02:00 UTC) | Full `--fresh` gate + e2e + package build | Dogfooders | Public pre-release branch; unreviewed |
| `preview` | Manual dispatch or `preview-v*` tag | Nightly gate + human review + smoke + install | Release candidates | Public pre-release branch; reviewed |
| `stable` | Manual dispatch or release tag | Preview gate + version/docs/support promise | Everyone | Default branch; versioned |

**D3.1** `slop` is not a CI publish. It is the build being worked on; it may be broken. The fast gate
must finish without e2e, so a session does not wait at the full suite.

**D3.2** `nightly` is automatic and unreviewed. It is the first public proof that `main` builds,
installs and runs.

**D3.3** `preview` is a decision, not a timer. A person reviews the diff, the docs and the smoke
result; the build has no irreversible step left.

**D3.4** `stable` is a promoted preview from the same commit. Version, changelog, release notes and
the support promise are part of the promotion, not a rebuild.

## 4. Promotion

**D4.1** Promotion moves a manifest entry, not a source tree:

1. `detect` records the commit, lockfile hash and affected identities.
2. `build` produces the identity artifact once and writes its digest to the manifest.
3. `attest` signs provenance and an SBOM for the artifact.
4. `promote` points the channel at the manifest entry. Within the pre-release identity,
   `slop` → `nightly` → `preview` may reuse the same commit; `preview` → `stable` builds the stable
   identity from the same commit and lockfile.
5. `verify` installs from the channel on a clean host and checks the signature, id and version.

**D4.2** Android promotion is identity-specific. `run.suite.slop.go` and `run.suite.go` are different
packages and versionCodes; stable is a separate build from the same commit, signed with the release
key. A pre-release APK cannot be promoted to stable by renaming it. A channel move that lowers the
versionCode is a forward fix, not an install; CI asserts monotonic growth.

**D4.3** Flatpak promotion within the pre-release id is a branch move on the signed OSTree repository.
The summary is signed once per publication; clients verify it and every object's content hash.

## 5. Signing and provenance

**D5.1** The Flatpak store key signs the OSTree summary. The public half is in the `.flatpakrepo`; a
client verifies the summary and every object. The private key stays on the workstation or in a
protected release environment.

**D5.2** The Android release key signs stable and pre-release APKs. Its certificate digest is pinned
in the tree. A debug-signed APK is never a release artifact.

**D5.3** The pack publisher key signs the manifest and every file hash. The pack index is signed by
the catalogue operator; a host verifies the index, the pack and the publisher pin.

**D5.4** GitHub artifact attestations and an SBOM are produced for every public artifact. They are
evidence, not a substitute for the store, APK or pack signature.

**D5.5** A release workflow has `contents: read`, `id-token: write` and `attestations: write` only
where needed. It never runs on a pull request, never checks out untrusted code, and never prints a
key.

## 6. Releases, tags and notes

**D6.1** One rolling `suite-YYYY.MM.DD` release is the Latest human mirror. Per-app releases are
`<app>-v<version>` and are not Latest. The signed Flatpak remote is the update path; GitHub Releases
are the mirror and the APK download.

**D6.2** Release notes carry the channel and product maturity separately, plus the artifact digest
and the verification command. A note without a digest is incomplete.

**D6.3** Immutable releases are enabled for published releases: the tag and assets are locked after
publication. Create the release as a draft, attach every asset, then publish.

**D6.4** A version has one home: the app's `package.json` (or the Android Gradle version). No page
restates it; link the file.

## 7. Rollback and recovery

**D7.1** Flatpak rollback is a branch repoint to the previous signed commit. The previous commit
stays in the repository; no client is forced to downgrade.

**D7.2** Android rollback is a forward fix. Android refuses a lower versionCode; cut a new version
that reverts the change and increments the code.

**D7.3** A pack rollback keeps the previous version directory; the host loader picks the highest valid
version. Removing a bad version is explicit.

**D7.4** A document written by a newer host is not a rollback target. It is refused by name with an
export path; the host never creates a fresh document in its place.

## 8. Distribution matrix

| Platform | Public channel | Artifact | Signing | Status |
| --- | --- | --- | --- | --- |
| Linux x86_64 | Flatpak remote | OSTree commit + summary | Store key | Target v1 |
| Android arm64 | GitHub release | APK + checksum | Android release key | Target v1 |
| Windows x64 | Test artifact only | Unsigned zip | None | Build/test now; signing later |
| macOS arm64 | Test artifact only | Unsigned zip/dmg | None | Build/test now; notarization later |
| iOS simulator | Test artifact only | Simulator app via Revyl | None | Build/test now; device later |
| Linux aarch64 | Test artifact only | Flatpak build | Store key if published | Build/test; publish later |
| Android x86_64 | Test only | Emulator APK | Test key | Revyl/emulator |
| Windows arm64 | Test only | Unsigned zip | None | Build-only |
| iOS device | None | — | Apple signing | Future |

**D8.1** "Public" means a person can install it and expect support. "Test artifact" means it exists
for verification and may break; it is never presented as a stable release.

**D8.2** No official store listing is promised. The Flatpak remote, GitHub release and signed pack
index are the distribution.

## 9. Signals

**D9.1** Measure artifact publication frequency, lead time from merge to nightly, time to a published
patch, change-fail rate and rework rate. Do not measure user update adoption as a delivery metric;
desktop and mobile users update on their own schedule.

**D9.2** A release note records the digest, so two channels can be compared by artifact rather than by
date. Do not optimize PR or commit count; the metric is a shipped, verified artifact.

## 10. Release checklist

1. Version bumped in the owning file; changelog section written.
2. Full gate green at `--fresh`; e2e green on the same commit.
3. Artifact built once for the identity; digest recorded.
4. Signature verified: Flatpak summary, APK certificate, pack manifest.
5. Attestation and SBOM attached; release manifest written.
6. Release notes name channel, maturity, digest and verification command.
7. Channel promoted; clean-host install verified.
8. Previous artifact retained; rollback path written.

## 11. Non-goals

- No official app store, no Play Store, no Flathub pre-release.
- No public Windows/macOS/iOS release until signing and notarization exist.
- No signing key in a pull-request workflow or a repository secret readable by writers.
- No silent update or remote kill switch; an advisory is signed and user-visible.
