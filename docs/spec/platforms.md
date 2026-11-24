# Platform support specification

Status: draft 0.1. Target matrix. Today Linux Flatpak and Android APK are the only public forms; the
other platforms are build/test targets until signing exists. `.github/workflows/platforms.yml`
builds unsigned Windows x64 and macOS arm64 zips of the Suite Desk at 03:30 UTC and on dispatch,
attests an SBOM and provenance for each, and keeps them as 14-day test artifacts — never a release,
never a download a person is asked to install. The same run builds the iOS simulator app from the
committed `apps/go/ios` project with Swift Package Manager and no signing identity; an iOS device
build needs Apple signing and stays out of the matrix. The delivery contract is
[delivery.md](delivery.md); the pipeline is [ci.md](ci.md).

## 1. What a tier means

- **Tier 1 — shipped.** Built, tested, published and supported. A regression blocks a release.
- **Tier 2 — built and smoke-tested.** Artifact exists for testing or pre-release review; not a
  public support promise. A regression blocks the platform job, not the whole release.
- **Tier 3 — build-only.** Compiles, may be untested; no artifact promise. A failure is reported, not
  release-blocking.

A platform is not “supported” because a build exists. It is supported when the tier says it is
published and tested.

## 2. Matrix

| Platform | Form | Tier | Build runner | Test | Distribution |
| --- | --- | --- | --- | --- | --- |
| Linux x86_64 | Flatpak | 1 | `ubuntu-latest` | Full gate, e2e, clean install | Own Flatpak remote |
| Android arm64 | APK | 1 | `ubuntu-latest` | Unit, Revyl emulator smoke, install | GitHub release |
| Linux aarch64 | Flatpak | 2 | `ubuntu-24.04-arm` | Build, install smoke | Test remote; publish when the remote carries it |
| Android x86_64 | APK | 2 | `ubuntu-latest` | Revyl emulator | Test only |
| Windows x64 | Unsigned zip | 2 | `windows-latest` | Build, Electron/Playwright smoke | Test artifact only |
| macOS arm64 | Unsigned zip/dmg | 2 | `macos-latest` | Build, Electron smoke | Test artifact only |
| iOS simulator | Simulator app | 2 | `macos-latest` + Revyl | Build, simulator smoke | Test artifact only |
| Windows arm64 | Unsigned zip | 3 | `windows-11-arm` | Build-only | None |
| macOS Intel | Unsigned zip | 3 | `macos-15-intel` | Build-only | None |
| iOS device | — | 3 | Future | Future | Apple signing/TestFlight later |

**P2.1** The current public surface is exactly two rows: Linux x86_64 Flatpak and Android arm64 APK.
The rest are verification targets. A test artifact is never presented as a stable download.

**P2.2** The Android APK is universal until ABI splits are proven. Tier 1 means arm64-v8a devices;
x86_64 is the emulator; 32-bit ARM is best-effort and may be dropped.

**P2.3** A platform matrix job is informative when its tier is 2 or 3. A Tier 1 failure fails the
release. A Tier 2 failure opens an issue and blocks that platform's artifact, not the Linux release.

## 3. Lifecycle

| Component | Current line | Policy |
| --- | --- | --- |
| Electron | [The apps' `package.json`](../../apps/shell/package.json) | Latest three stable majors; 8-week cadence; upgrade within two majors of current |
| Node.js | [`engines` in the root `package.json`](../../package.json) | Active/Maintenance LTS; plan the next LTS before the current one leaves maintenance |
| Flatpak runtime | [The shell manifest](../../packaging/flatpak/run.suite.shell.yml) | Two-year lifecycle; review annually and upgrade before security-only |
| Android SDK | [`variables.gradle`](../../apps/go/android/variables.gradle) | Target the current API; revisit minSdk when device data supports a higher floor |
| macOS | Electron's current minimum | Unsigned builds; notarization later |
| Windows | Electron's current minimum | Unsigned builds; Authenticode later |
| iOS | Revyl's simulator runtime | Simulator only; device support later |

**P3.1** A version is never restated in prose as a promise; the table names the current line and the
policy. The exact version lives in `package.json`, the Gradle files or the manifest.

**P3.2** A runtime upgrade is a normal PR with a gate run. A platform EOL is an issue, not a surprise.

**P3.3** Electron and Node upgrades are separate changes. Do not combine a runtime bump with a feature.

## 4. Build and deploy

**Linux.** `ubuntu-latest` builds the Electron app and the Flatpak. The Flatpak identity is stable or
pre-release, and the channel is the branch. Publish to the signed OSTree remote; verify with a clean
`flatpak install`.

**Android.** `ubuntu-latest` runs the Gradle release build. The release key signs stable and
pre-release; the certificate digest is pinned. Publish the APK and checksum to GitHub Releases.
Revyl runs the emulator smoke.

**Windows.** `windows-latest` runs the Electron build unsigned. The artifact is a zip with a README
that says it is unsigned; SmartScreen will warn. No auto-update, no installer signing, no public
stable.

**macOS.** `macos-latest` (arm64) builds unsigned. The artifact is a zip or dmg with a README that
says Gatekeeper will block it until the person allows it. No notarization, no auto-update, no public
stable. Use `macos-15-intel` only when a build needs more than 3 CPU/7 GB.

**iOS.** `macos-latest` builds the simulator app; Revyl runs it on a simulator. No device build, no
TestFlight, no App Store. A device target is a future Apple-signing decision.

**Revyl.** Use the free plan for iOS simulator and Android emulator sessions. Run it on nightly,
preview and release candidates, not every pull request. A session leaves screenshots and a verdict;
link it from the release check.

**P4.1** Revyl Proof of Changes is a GitHub App check on the pull request, not a workflow job. It
builds and runs the app on a cloud device; its check is evidence, not a required check in v1.

**P4.2** A Windows, macOS or iOS test artifact attaches to a draft or pre-release with its checksum.
It is never presented as a stable download. Unsigned means Gatekeeper or SmartScreen will warn; the
artifact README says so.

## 5. Test coverage

| Tier | Required evidence |
| --- | --- |
| 1 | Unit, typecheck, build, e2e on the affected app, clean install, signature check |
| 2 | Build, unit/smoke, launch and one happy path; Revyl for mobile |
| 3 | Build only; failure reported with the exact error |

**P5.1** A Tier 1 platform with no install test is not Tier 1. A Tier 2 platform with no launch test
is not Tier 2.

**P5.2** Accessibility, reduced motion and keyboard paths are host properties, not per-platform
afterthoughts. A platform that cannot meet them is Tier 3 until it can.

## 6. Upgrade cadence

- Monthly: review Electron/Node/Flatpak/Android support lines; open an issue for anything within one
  major of EOL.
- Quarterly: run the full matrix including Tier 2/3; update this table.
- Per release: verify the Tier 1 install paths and the APK certificate.
- Per year: review Flatpak runtime and Android target; plan the upgrade.

## 7. Non-goals

- No Apple Developer ID, notarization, App Store or TestFlight in v1.
- No Windows Authenticode, MSIX or Store listing in v1.
- No public unsigned Windows/macOS download presented as stable.
- No iOS device build without an Apple signing decision.
- No Flathub pre-release or Play Store listing.
