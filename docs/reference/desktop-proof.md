# Desktop Proof of Changes

Every desktop Electron app owns one Playwright proof scenario tagged `@proof` that opens a real
document, performs a user action, and asserts the visible result. The runner produces a short
markdown **Proof of Changes** block alongside step screenshots and a Playwright trace, the desktop
counterpart to the evidence `.revyl/config.yaml` provided for Suite Go on mobile before that harness
was parked (2026-11-24).

## The `@proof` tag

Each desktop row in `scripts/lib/pipeline.mjs` (`desktop: true`) has one `proof.spec.ts` tagged
`@proof`:

| App | Spec | What it proves |
| --- | --- | --- |
| `shell` | `apps/shell/e2e/proof.spec.ts` | Opens the Home Screen, creates a `Focus` Screen document, and switches to it |
| `help` | `apps/help/e2e/proof.spec.ts` | Opens the indexed code explorer, searches the handbook, and renders an article |
| `canvas` | `apps/canvas/e2e/tests/desktop/proof.spec.ts` | Creates a `.canvas` workspace document, adds a card, and renders it on the board |
| `planner` | `apps/planner/e2e/proof.spec.ts` | Opens a `.planner` document, captures a task, and shows it on the day plan |
| `budget` | `apps/budget/e2e/proof.spec.ts` | Creates a `.budget` document, assigns `$100` to `Rent / Mortgage`, and updates the sheet |

`apps/canvas/e2e/tests/desktop/proof.spec.ts` serves `apps/canvas/dist` over loopback HTTP via
`SUITE_DESKTOP_DEV_URL` because `apps/canvas/desktop/src/main/index.ts` resolves its unpackaged
renderer path relative to the pre-flattening `../canvas/dist` layout.

## Command

```sh
mise exec -- node scripts/proof-of-changes.mjs --only budget
mise exec -- node scripts/proof-of-changes.mjs --affected --base origin/main
mise exec -- pnpm proof
```

Options:

- `--only <app>`: run one desktop app (`shell`, `help`, `canvas`, `planner`, `budget`).
- `--affected`: select only the desktop rows whose diff can break them via `scripts/affected.mjs`.
- `--base <ref>`: base ref for `--affected` (defaults to `origin/main`).
- `--out <dir>`: output directory for the summary and artifacts (defaults to `.dev/proof`).
- `--no-build`: reuse the existing build instead of rebuilding workspace libraries and the app.
- `--json`: print the structured run summary to stdout.

The runner never launches a window on a user's desktop. When `xvfb-run` is on `PATH`, it runs
Playwright under `xvfb-run -a` with `WAYLAND_DISPLAY` cleared; when `xvfb-run` is absent, it clears
`DISPLAY` and `WAYLAND_DISPLAY` and sets `SUITE_ELECTRON_HEADLESS=1` so each proof launches
Electron with `--ozone-platform=headless`.

## Where artifacts land

- **Local markdown block:** `.dev/proof/index.md` (overridden by `--out`), containing what ran,
  the named `test.step` outcomes, and links to screenshots and traces.
- **Local per-app artifacts:** `.dev/proof/<app>/` (`01-*.png`, `02-*.png`, `trace.zip`, and
  `report.json`). The directory is wiped at the start of each app run and ignored by git under
  `.dev/`.
- **Pull requests (CI):** `.github/workflows/ci.yml` runs the `proof` job as non-blocking evidence
  over `needs.detect.outputs.proof_matrix` (only the affected desktop rows). It appends
  `.dev/proof/index.md` to `$GITHUB_STEP_SUMMARY` and uploads `.dev/proof/` as the
  `desktop-proof-<app>` artifact with 14-day retention.
