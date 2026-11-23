# CI specification

Status: draft 0.1. Phases 1 and 2 are live: Actions is enabled, `.github/workflows/ci.yml` maps a
pull request's diff to gate rows with `scripts/affected.mjs` and requires the `ci` aggregator,
`.github/workflows/main.yml` runs the full fresh gate on every push to `main`, and Start's e2e runs on
the merge queue and on a pull request whose affected set includes Start or Shell. `.github/workflows/nightly.yml`
runs the full fresh gate with e2e at 02:00 UTC, then builds the host Flatpak and the Go debug APK,
attests each with provenance and an SPDX SBOM, and keeps them as artifacts. Once the repository
variable `NIGHTLY_PUBLISH` is `true` and the `release` environment holds its keys, the nightly instead
runs `.github/workflows/release.yml` for the nightly channel: the release-signed APK and the signed
Flatpak are published automatically (D3.2). The `main` ruleset requires the `ci` check and a merge
queue (HEADGREEN grouping, merge commits), and `ci.yml` triggers on `merge_group`. The VM gate is
retired; GitHub Actions is the full proof. The Windows/macOS/iOS matrix is live, and the iOS row is a
simulator test build. The delivery contract is [delivery.md](delivery.md); the platform matrix is
[platforms.md](platforms.md); the product contract is [superapp.md](superapp.md).

## 1. Principles

**C1.1** Trunk-based development: short-lived branches, one reviewable change per branch, and a merge
queue on `main`. No long-lived `slop`/`nightly`/`preview` branches; those are artifact channels.

**C1.2** Fast on the change, full on the trunk. A pull request gets affected checks only. A merge queue
gets affected checks plus affected e2e. `main` gets the full fresh gate. Nightly gets the full matrix.

**C1.3** The pipeline is the same commands a person runs. CI calls `node scripts/gate.mjs`, not a
second build path. A workflow that cannot be reproduced locally is a bug.

**C1.4** Checks and builds need no secrets. Only publication needs a protected environment, OIDC or a
signing key.

**C1.5** No pull-request workflow runs untrusted code with repository write access, secrets or a
self-hosted runner. `pull_request_target` is not used to check out a fork.

## 2. Triggers and required checks

| Event | Workflow | Required |
| --- | --- | --- |
| `pull_request` (opened, synchronize, reopened) | `ci` | Yes: the `ci` aggregator |
| `merge_group` | `ci` | Yes: the `ci` aggregator |
| `push` to `main` | `main` | Yes: `main-gate` |
| `schedule` 02:00 UTC | `nightly` | No; publishes nightly |
| `workflow_dispatch` | `preview`, `stable`, `matrix` | Environment approval |
| `push` tag `v*` / `<app>-v*` | `release` | Environment approval |

**C2.1** A merge queue is enabled on `main`; the `ci` workflow includes `merge_group`. A required check
that does not run on `merge_group` blocks every merge.

**C2.2** The only required check for a pull request is the `ci` aggregator. It reports success only
when every needed job succeeded or was skipped with a reason. A matrix job's failure fails the
aggregator.

**C2.3** `main` is protected: no direct pushes, one approving review, the `ci` check, and no force
push. A direct push is an explicit owner checkpoint, not the normal path.

**C2.4** A pull request from a fork runs fast checks only. E2E, packaging and device jobs need a
maintainer label or an environment approval; a public fork does not get free heavy compute.

**C2.5** The owner may keep a ruleset bypass for an explicit emergency checkpoint. A bypass is a
recorded decision, not the normal path.

**C2.6** Enable the merge queue in the repository UI when the plan offers it; the `merge_group`
trigger is required. If the plan or API cannot enable it, the pull-request rule plus the required
`ci` check is the fallback, and the limitation is recorded rather than pretended.

## 3. Jobs

| Job | Runs on | What it does | Cache |
| --- | --- | --- | --- |
| `detect` | ubuntu-latest | Diff base…head, map files to projects, write the job matrix | none |
| `fast` | ubuntu-latest | Lint, typecheck, unit, scripts/spec/docs checks for affected | pnpm store |
| `build` | ubuntu-latest | Build affected apps/packages; no packaging | pnpm store, build cache |
| `e2e` | ubuntu-latest + xvfb | Start’s suite, only when affected or on `main`/nightly | Playwright cache |
| `main-gate` | ubuntu-latest | `node scripts/gate.mjs --fresh --no-e2e` | pnpm store |
| `nightly-gate` | ubuntu-latest | Full `node scripts/gate.mjs --fresh` with e2e | pnpm store, Playwright |
| `package-linux` | ubuntu-latest | Flatpak build; no publish | flatpak-builder cache |
| `package-android` | ubuntu-latest | APK build; no publish | Gradle cache |
| `build-windows` | windows-latest | Electron build, unsigned zip | pnpm store |
| `build-macos` | macos-latest | Electron build, unsigned zip/dmg | pnpm store |
| `build-ios` | macos-latest | Simulator app for Revyl | pnpm store, Xcode cache |
| `device` | Revyl GitHub App | iOS simulator/Android emulator smoke | none |
| `publish` | ubuntu-latest | Sign, attest, publish, verify | none |

**C3.1** `fast` and `build` are matrices over the affected projects. An empty matrix is success with
a “nothing affected” note; it is not a skipped required check.

**C3.2** `e2e` runs on a pull request only when the changed set includes Start, Shell, contracts or a
shared package they consume. Otherwise it runs on `main` and nightly.

**C3.3** Packaging jobs build artifacts but never publish. Publication is a separate job with an
environment and a key.

## 4. Affected selection

**C4.1** `detect` compares `base...head` and selects changed projects with pnpm's native filter:
`pnpm --filter "...[<base>]"`. The filter includes a package's dependents, so a shared-package change
reaches every consumer. The checkout uses `fetch-depth: 0` or fetches the base ref; a shallow clone
cannot resolve it.

**C4.2** A small affected helper handles the cases the filter cannot: a docs-only change, a
spec-only change, a workflow change, and a root config change. It reads the workspace graph, not a
hand-maintained app list. A missing edge is a test failure, not a silent skip.

**C4.3** A docs-only change runs `docs-check` and `docs:index:check`; a spec change runs `spec:check`;
a workflow change runs the workflow linter. It does not build every app.

**C4.4** `main` and nightly always run the full gate. Affected selection is a pull-request
optimization, never a release proof.

## 5. Gates by channel

| Channel | Checks |
| --- | --- |
| `slop` | Fast affected checks only; no e2e; local/session artifact |
| `nightly` | Full fresh gate + e2e + package builds + install smoke |
| `preview` | Nightly gate + human review + docs + smoke + clean install |
| `stable` | Preview gate + version/changelog/support promise + promoted artifact |

**C5.1** No e2e on `slop`. A session build that waits at the full suite is a failed channel design.

**C5.2** `preview` and `stable` require a human approval environment. The approval is the decision;
the checks are the evidence.

**C5.3** Budgets: a pull request’s fast checks target under 5 minutes; a merge-queue run under 10;
nightly under 45. A run that exceeds its budget is a bug, not a new normal.

**C5.4** Flaky tests are quarantined, not retried forever. CI uses one retry for a known transient
timeout; a test tagged `@quarantine` runs in the nightly report and does not block an agent PR.

## 6. Caching

**C6.1** Cache the pnpm store keyed by `pnpm-lock.yaml`; do not cache `node_modules` as the primary
artifact. Use `setup-node`/`pnpm` caching where it is enough.

**C6.2** Cache build outputs and Playwright browsers by lockfile and tool version. A cache miss must
produce a correct build, never a skipped step.

**C6.3** Pull-request jobs get read-only cache access (`cache-mode: read`). Only trusted `push` or
`workflow_dispatch` runs write the default-branch cache. No secret enters a cache path.

**C6.4** The repository cache is capped at 10 GB by default. A larger cap is a deliberate cost
decision, not a default.

## 7. Concurrency

**C7.1** Pull-request runs use `ci-<workflow>-<ref>` and `cancel-in-progress: true`; a new push cancels
the old run. Merge-queue runs are never cancelled by a pull-request run.

**C7.2** `main` uses a queue, not cancellation: the latest commit is the one that matters, but a
running release is not killed by a merge.

**C7.3** Publication uses a per-channel group (`publish-preview`, `publish-stable`) with no
cancellation. Two publications of the same channel never overlap.

## 8. Runners

**C8.1** Public checks and builds run on GitHub-hosted standard runners: `ubuntu-latest` (4 CPU/16 GB),
`windows-latest` (4 CPU/16 GB), `macos-latest` (3 CPU M1/7 GB), `ubuntu-24.04-arm` for Linux arm64.
Standard runners are free for public repositories.

**C8.2** Self-hosted runners are not used for pull requests on this public repository. A dedicated
publisher or a protected environment holds signing keys; it runs only on a tag/manual event.

**C8.3** Revyl Proof of Changes runs as a GitHub App from `.revyl/config.yaml`, not as a workflow job.
It builds the app on a pull request, runs it on a cloud device, and posts its own checks; those checks
are evidence, not a required check in Phase 1. It uses the Revyl free plan for iOS simulator and
Android emulator sessions on nightly, preview and release candidates, not every pull request.

**C8.4** macOS runners are scarce and 3-core/7 GB on arm64. A build that needs more uses
`macos-15-intel` (4 CPU/14 GB) and records why.

## 9. Secrets and OIDC

**C9.1** Default `GITHUB_TOKEN` is read-only. A job that needs more declares the minimum
(`contents: write` for a release, `id-token: write` for OIDC, `attestations: write` for attestations).

**C9.2** AWS access uses GitHub OIDC with a role trust policy scoped to this repository, branch or
environment. No long-lived AWS key is stored.

**C9.3** Signing keys live in the `release` environment with required reviewers, or on the local
publisher. The environment is restricted to `main` and release tags. A pull request cannot reach it.

**C9.4** Actions and reusable workflows are pinned by full commit SHA or a workflow dependency lockfile.
Dependabot updates them. A third-party action is reviewed before it is added.

**C9.5** No secret is printed, cached, uploaded as an artifact or passed to a fork. If a key is
exposed, rotate it and delete the log.

## 10. Schedules

| When | What |
| --- | --- |
| Every pull request | Affected fast checks; affected e2e only when needed |
| Every merge queue entry | Affected fast + affected e2e + `ci` aggregator |
| Every push to `main` | `main-gate --fresh --no-e2e`, affected build, packaging build |
| Nightly 02:00 UTC | Full fresh gate + e2e + Linux/Android/macOS/Windows/iOS builds + Revyl smoke + publish nightly |
| Weekly | Full matrix, dependency review, action pin audit, cache cleanup |
| Manual | Preview/stable publication, platform matrix run, VM comparison |

**C10.1** A nightly failure opens or updates one issue; it does not spam a new issue per night.

**C10.2** A red `main` blocks the merge queue; the fix is a forward PR, not a direct push.

## 11. Concurrent agents

**C11.1** One task per branch/worktree. A branch names the spec clause or issue it serves; a pull
request carries its clause IDs in the body.

**C11.2** A worker runs the owning app’s `--only` gate before pushing. It does not run the full e2e
unless the task needs it; the merge queue and nightly own the full proof.

**C11.3** Shared files are hotspots: `package.json`, `pnpm-lock.yaml`, `scripts/gate.mjs`, the root
workflows, `docs/spec/README.md`. A change that touches one is small and calls it out in the PR.

**C11.4** A review-only agent comments or requests changes; it never merges. The coordinator runs the
merge queue and the VM gate until the VM is retired.

**C11.5** The merge queue replaces “update your branch and rerun” races. A lockfile-only conflict is
resolved by the queue’s merge commit, not by every agent rebasing.

## 12. Migration

1. **Enable**: turn on Actions, add branch protection/ruleset and the merge queue, land `ci` with the
   fast affected checks. Keep the VM gate as required.
2. **Select**: add `detect` and the affected map; cache pnpm and Playwright. Measure PR time.
3. **Trunk**: add `main-gate` and `nightly`; compare the VM result with Actions on the same commits.
4. **Package**: add Linux/Android packaging and attestations; preview/stable environments.
5. **Matrix**: add Windows, macOS, iOS simulator and Revyl smoke.
6. **Retire**: remove the VM dependency only after a month of matching results and a documented
   fallback.

## 13. Cost and limits

**C13.1** Standard GitHub-hosted runners are free and unlimited for public repositories. macOS is the
scarce resource; the matrix stays small. Revyl free plan has session limits; use it on nightly and
release candidates.

**C13.2** Artifacts are retained 14 days for checks and 90 days for releases. Logs are retained 30
days. A release artifact is retained as long as the release exists.

**C13.3** The pipeline does not use larger runners or paid concurrency in v1. A paid runner is a
separate decision with a monthly cap.

**C13.4** The free plan allows about 20 concurrent jobs. Keep the pull-request matrix small; the
nightly matrix can use the width. A larger matrix queues rather than fails.

## 14. Non-goals

- No pull-request self-hosted runner, no `pull_request_target` checkout.
- No signing key in a check, build or pull-request job.
- No e2e on every slop build.
- No second build path that differs from the local gate.
- No store listing or paid CI runner in v1.
