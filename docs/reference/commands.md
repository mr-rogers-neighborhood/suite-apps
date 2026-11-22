# Commands

The toolchain is pinned in `package.json`: the Node engine and the pnpm version. `mise exec --` makes
both resolve without relying on the shell's defaults.

```sh
mise exec -- pnpm install
mise exec -- node scripts/gate.mjs
```

## The root gate

```sh
mise exec -- node scripts/gate.mjs                 # this working tree
mise exec -- node scripts/gate.mjs --only canvas
mise exec -- node scripts/gate.mjs --fresh         # this commit, clean install
mise exec -- node scripts/gate.mjs --no-e2e        # skip Start's e2e suite
```

The gate builds the workspace libraries (`packages/*` and `apps/*/packages/*`) once, runs
`node --test scripts/pack.test.mjs` for the pack build script that no app's gate covers, then runs
each app's own `check:full` in dependency order. It writes `.dev/gate-status.json`. `--fresh` exports
`HEAD` with `git archive`, installs from the lockfile, and runs the same order in that clean tree. The
cross-app Playwright suite runs after the checks, under `xvfb-run` when there is no display.

Run heavy checks under a cap so a fan-out cannot take the desktop with it:

```sh
systemd-run --user --scope -p MemoryHigh=10G -p MemoryMax=15G \
  --setenv=NODE_OPTIONS=--max-old-space-size=3072 \
  mise exec -- node scripts/gate.mjs
```

## Per-app checks

Each app owns its gate. Read `apps/<app>/AGENTS.md` before changing code; the README repeats the
short version.

| App | Command |
| --- | --- |
| Canvas | `pnpm check` (edit loop), `pnpm verify` (full local gate) |
| Planner | `pnpm check`, `pnpm verify` |
| Budget | `pnpm check`, `pnpm verify` |
| Start | `pnpm check` |
| Help | `pnpm check` |
| Sync | `pnpm check` |
| Go | `pnpm check` |

Canvas additionally checks docs, cross-references and file shape:

```sh
pnpm docs:check     # links, fences, prose, generated indexes
pnpm docs:symbols   # backticked paths, scripts, ADR references
pnpm shape          # file length, observe sites, raw Loro writes
```

The per-app gates do not run Playwright. The root gate runs Start's e2e suite after the checks, under
`xvfb-run` when there is no display; `--no-e2e` skips it. Other Playwright suites run when the owner
asks for a run or names a milestone.

## The factory profile

`slopmaster.profile.json` at the root is the app set the Slopmaster factory and studio read. It
mirrors `FactoryProfileSchema` in `slopmaster9000/packages/factory/src/profile.ts`: `v: 1`, the guest
checkout, the apps, the toolchain enum, the gate, build and display argv objects, the release prefix
and tier, and the environment allowlist.

```sh
mise exec -- node scripts/profile-check.mjs
```

`{app}` is the only placeholder. The gate is `node scripts/gate.mjs --only {app}` with `fresh: true`;
the slop build is `node scripts/flatpak.mjs --app {app} --channel slop`; the display is
`flatpak run run.suite.slop.{app}`. Each app's `slop_build_path` is `apps/<app>/slop`. A working
change lands on `slop/<name>`; the `slop → canary → beta → stable` ladder stays with the app set and
the profile carries only the slop tier.

Only Canvas, Planner, Budget and Help can be queued: they are the apps with a Flatpak manifest and a
`slop` identity. Start ships no `suite.app.json` and refuses a pre-release build, Go builds for
Android, and Sync ships as the relay's Flatpak. Their gates still run at the root.

The toolchain names what the factory image must provide: the pinned Node and pnpm, `git`, Docker for
Canvas's gitleaks scan, Xvfb and the Electron GTK libraries for Start's e2e suite, the Flatpak
builder, and Orca. `scripts/profile-check.mjs` enforces the schema and the Suite invariants and
rejects a host path or a secret. It validates against a local JSON Schema only when one is supplied
(`--schema` or `SLOPMASTER_PROFILE_SCHEMA`); no schema file is committed here.

## Signing keys

```sh
pnpm keys status            # presence, fingerprint, and whether each pin accepts the key
pnpm keys status --strict   # also fail when a key is absent
pnpm keys generate pack     # a new pack signing keypair
pnpm keys generate update   # a new update signing keypair
```

The private halves live outside the repository, and each public half is pinned in the source that
verifies it. [Manage signing keys](../how-to/keys.md) has the directory, the rotation order and what
a backup has to preserve.

## Build a pack

```sh
mise exec -- node scripts/pack.mjs --dir <pack-dir> [--out <file.suitepack>] \
  [--key <base64>] [--contract <n>] [--min-host <n>]
```

`--dir` holds the development `manifest.json`, the HTML entry and its assets. The script hashes every
other file into the manifest, signs the canonical core with the pack key, and writes
`<id>-<version>.suitepack` (or `--out`) with a sibling `.sha256` holding the digest and file name.
The key comes from `--key`, `$SUITE_PACK_KEY`, or `pack-key` in the Suite keys directory. A clean
checkout has none, and an absent, unreadable or non-matching key is refused before anything is
signed; `pnpm keys status` compares the key with the pin. Rotation is in [Manage signing
keys](../how-to/keys.md).

The script imports `@suite/pack` and `@suite/pack-host` through their `dist/`, so a clean checkout
must build those two libraries first:

```sh
mise exec -- pnpm --filter @suite/pack build
mise exec -- pnpm --filter @suite/pack-host build
```

The gate's libraries step does the same build before anything else runs.

### Build an app pack

```sh
mise exec -- pnpm budget:pack [--key <base64>] [--out <file.suitepack>] [--version <semver>]
```

`scripts/budget-pack.mjs` builds Budget's own renderer and its prelude into `apps/budget/pack/dist`,
puts the prelude in front of the app script, and signs the directory with the pinned key. The default
output is `apps/budget/.dev/budget-<version>.suitepack`. The gate runs the signed round-trip with an
ephemeral key, so a clean checkout with no owner key still proves the build and verification path.

## Releases

```sh
mise exec -- node scripts/release-suite.mjs [--publish] [--target s3|lan] [--skip-gate] [--skip-apk]
```

Packages Suite, the host, publishes the signed Flatpak remote, refreshes the rolling release, attaches
Suite Go's APK and relinks it. Without `--publish` it prints every step and changes nothing. The
individual commands and the gate-proof rule are in [Package and
release](../how-to/package-and-release.md#release-suite-the-host).

## Docs

```sh
mise exec -- node scripts/docs-check.mjs
```

Checks relative links, that each `docs/` section index lists its pages, and a short list of retired
phrases. It is not part of the gate yet; run it with any documentation change.

Suite Help (`apps/help`) is the shipped documentation app: one Vite + React renderer in an Electron
shell. It shows Browser, Modules and Tours over the code index, and renders the `docs/` pages as the
**Handbook**. It is offline; Flatpak owns updates.

```sh
mise exec -- pnpm docs:index     # index every file and declaration into apps/help/public/data
mise exec -- pnpm docs:index:check # resolve notes, tours and generated data
mise exec -- pnpm docs:coverage  # report authored vs generated prose; never fails on a gap
mise exec -- pnpm docs:explain <node-id> # scaffold one note section in its module MDX
mise exec -- pnpm docs:dev       # index, sync docs/ and start Vite + Electron (foreground)
mise exec -- pnpm docs:build     # index, sync and build the app
mise exec -- pnpm docs:clean     # remove out, release, .generated and public/data
```

`docs:index` runs `apps/help/scripts/index-code.mjs`: every file and declaration becomes a node,
modules are package roots plus `src/` children, and config files become `config:*` modules. It writes
`apps/help/public/data/` and is not committed. `docs:index:check` resolves every note heading, tour
step and composed-tour target and compares the generated files with the ones on disk; it exits
nonzero on an unknown ID or stale data. It also checks that prose tours have an intro and that
interludes and overlays have content. `docs:dev` and `docs:build` also run
`apps/help/scripts/sync-docs.mjs`, which mirrors `docs/` into `apps/help/.generated/docs/` with the
frontmatter and sidebar Fumadocs expects, and writes the offline handbook search index.
`docs:coverage` reports how many modules and tours a person has reviewed (`reviewed: human`) against
the generated prose, file and symbol counts, and the largest modules with no prose.
`docs:explain <node-id>` appends a TODO section with the generated signature to the owning module
MDX; it refuses to overwrite an existing note.

`docs:dev` launches the Electron app, so do not run it in a headless check or on someone else's
desktop; use `docs:index`, `docs:index:check`, `docs:coverage` and `docs:build` instead. Suite Help
opens to the three-mode explorer, and the Handbook is the `/handbook` route; its source paths stay
under `docs/`. Production is served from `suite-help://app/`, with SPA fallback to `index.html`;
there is no `next start` and no loopback HTTP server.

## The independent gate

`git push vm main` queues the same `--fresh` gate on the `suite-dev` machine, in a memory-capped
unit. The result is in `~/ci/status.json` there:

```sh
ssh suite-dev cat ~/ci/status.json
ssh suite-dev tail -f ~/ci/logs/<sha>.log
```

See `scripts/ci/` and [Run the gate](../how-to/run-the-gate.md).
