# Cutting a release

One command, run from this repository, on the machine that holds the signing key.

```sh
node scripts/release.mjs planner
```

That is the whole release. It runs the app's own gate, builds what `package.json` says, packages a
Linux AppImage, signs the feed manifest, and tells you what it would upload. Adding `--publish` uploads
it; adding `--feed-dir` writes the same three files into a folder instead, which is how an install can
be proven without a network.

```sh
node scripts/release.mjs planner --feed-dir /tmp/feed          # a local feed, nothing published
node scripts/release.mjs planner --publish --notes-file notes.md
node scripts/release.mjs start --tag start-v0.3.0 --publish    # the hub, off the package tag line
```

## What it refuses

| Refusal                                      | Why                                                                                                                         |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| The app's tree is dirty                      | The artifact would carry work nobody reviewed. Commit or stash first.                                                       |
| `package.json` and `suite.app.json` disagree | The version, the manifest and the tag describe one commit. Two of them saying different things is the failure this catches. |
| The gate fails                               | `check:full`, the same command a push runs, is run first. "The gate passed" is seen, not remembered.                        |

The version always comes from `package.json`, never from `git describe`. Suite Canvas carries
`v1.0.0`–`v1.1.0` tags from an older layout above its current `v0.1.0`, so tags cannot be trusted to
name a version.

## The tag

The default is `v<version>`. That is right for Canvas, Planner and Budget, whose tags are their own
releases. In `suite-start` it is wrong: `v0.1.0`–`v0.7.0` are the shared-package line the apps pin, and
the hub app is `0.3.0`, so the default collides with a tag about something else. The hub releases under
`start-v<version>` — `--tag start-v0.3.0`.

`releases/latest/download` resolves to the newest release whatever it is called, so the feed URLs do
not care.

## What it produces

In the app's `release/` directory:

- `Suite <App>-<version>.AppImage` — the artifact;
- `latest-linux.yml` — the feed: version, file name, sha512, size;
- `latest-linux.yml.sig` — the publisher's signature over those exact bytes.

The artifact name is set in each app's `electron-builder.yml` and has **no spaces**: GitHub rewrites a
space in an asset name to a dot, so a file built as `Suite Start-0.3.0.AppImage` is served as
`Suite.Start-0.3.0.AppImage` while the signed feed still names the file it built — a 404 for every
install. `suite-canvas-${version}-${arch}.${ext}` is the shape to follow.

All three are uploaded together. A feed without its signature is a feed every install refuses, and an
artifact without its feed is a version nothing can find.

## Publishing

`--publish` runs `gh release create v<version>` with the three files. Notes come from
`--notes-file`, or from GitHub's generated notes.

Nothing here runs in the pipeline, and `.woodpecker.yaml` does not call it. The pipeline answers "is
this repository healthy"; a release is a deliberate act on one machine, because that is where the key
is. See [ADR-0002](../adr/0002-the-gate-runs-here.md) and the signing section of an app's own
`docs/how-to/release.md`.

## Before you run it: the readiness list

Every item here has refused a release at least once, which is why it is a list rather than a habit. Do
them in order; each one is cheap and the later ones assume the earlier ones.

| #   | Check                                            | Command                                      | Why it is here                                                                                                                                                                                               |
| --- | ------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Every app's tree is clean**                    | `git status --short` in each                 | The script refuses a dirty tree, and the reason is that the artifact would carry work nobody reviewed. A tree with somebody else's feature in it is not a release candidate                                  |
| 2   | **The commit passes, not just the working tree** | `node scripts/ci.mjs --fresh`                | `--fresh` exports `HEAD` and runs the gate on that. The default run proves a working tree, which is not what gets published                                                                                  |
| 3   | **Versions agree**                               | `node scripts/release.mjs <app>` will say so | `package.json` and `suite.app.json` describe one commit. A mismatch produces a tag naming a version the artifact does not contain, and every install is then told there is no update                         |
| 4   | **Committed `dist` matches source**              | the repository's own gate                    | Three repositories ship built output for git consumers. Two verify it (`check-dist.mjs`); if the third's gate does not, a release can package a contract that disagrees with the types its consumers resolve |
| 5   | **The release has one sentence**                 | —                                            | A version with no story a person can repeat is a build, not a release. Write the sentence first; if it is hard, the release is not ready                                                                     |
| 6   | **Notes exist**                                  | `--notes-file`                               | Empty notes make the feed's version the only explanation of what changed                                                                                                                                     |
| 7   | **The key is the one you think**                 | the fingerprint `sign-release.mjs` prints    | Signing with a development key succeeds and produces something every install refuses. The fingerprint is the only visible difference                                                                         |

Steps 1–4 are also why a release is a **whole-suite** decision even when it ships one app: a version
bump in one repository is a claim about compatibility with the others.

## The key

`~/.config/suite/update-key.pem`, or wherever `SUITE_UPDATE_KEY` points. It is not in any repository
and must not be. Back it up somewhere you control: anyone holding it can push an update to every
install, and losing it means no further updates for anyone running the pinned public key.

`scripts/sign-release.mjs` prints the public half's fingerprint after signing, which is how you check
that what you signed with is what the apps pin (`SUITE_UPDATE_PUBLIC_KEY` in `@suite/desktop`).
