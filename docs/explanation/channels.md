# Channels

A channel is a product promise. The build on a card is not only newer or older: its channel says what
it has survived and what a person may rely on. A channel with no check at its boundary is just a name,
so the checks are part of the definition.

Channels belong to the **superapp**: Suite Desk on the desktop and Suite Go on mobile. A mini-app is
not on a channel. When it ships as a pack it carries a signed version, and the host updates it version
by version.

## The four channels

| Channel | The promise |
| --- | --- |
| `slop` | The intentionally silly session channel. It is today's work: it may be broken, incomplete, or change shape without notice, and it promises only that it is the build being worked on. |
| `nightly` | It builds and runs from the current main line. It is still unstable. |
| `preview` | It is shaped as it will ship: reviewed, documented, and with no irreversible step left in it. |
| `stable` | It is a release: versioned, supported, and the default a person is offered. |

`canary` and `beta` were the old channel names. They are not aliases: the scripts refuse them, so a
stale command fails where it is typed instead of publishing under a name the model no longer has.

## Product maturity is separate

A channel says what a build has survived. Product maturity says what the product is ready for. They
are different questions, and a stable-channel build can still be labeled `alpha`.

| Maturity | What it means |
| --- | --- |
| `pre-alpha` | The core loop exists and still changes shape between releases. |
| `alpha` | The core loop works and its envelope is fixed; surfaces are still being built. |
| `beta` | It is shaped as it will ship, with room left for polish and the manual passes. |
| `1.0` | The support promise is written and the product is expected to stay compatible. |

Maturity is a label on the product, not a gate the build passes. A person reads both labels: the
channel answers "how much has this build been through?" and the maturity answers "how finished is the
thing this build is a version of?"

## The three boundaries

A build enters a channel by passing the boundary below it. Passing is a decision someone makes; the
checks are the evidence, not an automatic promotion.

| Boundary | The question | What the check requires |
| --- | --- | --- |
| `slop` → `nightly` | Does it work? | The gate is green at `--fresh`; the artifact installs; the app launches; an existing document opens without requiring a new document migration. |
| `nightly` → `preview` | Is it shaped right? | A person reviews it; the docs and the decision record describe it; nothing the build writes is irreversible. |
| `preview` → `stable` | Is it a release? | The version is bumped in the file that owns it; the release criteria hold; the support promise is written. |

`slop` is deliberately the odd one out. It is the session channel, named for the kind of work it
carries, and it is allowed to be smaller and sillier than the rest. That is a promise about scope, not
an excuse to skip a check at the next boundary.

## Slop publication

Slop is the one channel that publishes itself. Every code push to `main` publishes a slop build, so
the channel is always today's work rather than a build someone remembered to promote. The pipeline is
[`.github/workflows/slop.yml`](../../.github/workflows/slop.yml).

The page is one build, tagged `suite-slop-<YYYY.MM.DD>-<sha7>` and marked *pre-release*. Its title,
body and Suite Go asset name the commit: the APK is
`suite-go-slop-<version>-<sha7>.apk`. A second run for the same commit is a no-op, not a moved tag.
A burst of pushes builds only the tip.

The proof boundary is written on the page, because it is narrower than the next boundary up:

- **Merge-queue-proven, not full-gate-proven.** The merge queue already ran the checks the change
  could break. Slop does not run the fresh gate, e2e, a clean install, an SBOM or attestations.
- **No pack index.** The signed catalogue is a stable and nightly fact; a slop build publishes only
  its own Flatpak refs and its page.
- **Never Latest, never stable.** Slop publishes `run.suite.slop.desk` on branch `slop` and
  `run.suite.slop.go`; it does not move the stable refs, GitHub's Latest release or another channel's
  page.
- **Kept for seven.** The seven newest slop pages and their tags stay; older ones are pruned. Slop is
  a session channel, not history, and stable remains the artifact a person keeps.

That is why a slop build is not a release candidate. It promises only that it is the build being
worked on; `nightly` is where "it builds and runs from `main`" is proven.

## What "unstable" does not mean

`unstable` is not a channel and not a colour between `slop` and `nightly`. `slop` already is unstable.
A build does not move up by being called unstable, and no boundary checks for it.

Unstable does not mean unverified. A Flatpak channel verifies the signed OSTree summary with the store
key, and the relay's checksum list is signed with the update key. Unstable means the code may change
or break, not that the bytes are unaccounted for.

Unstable does not mean shared. A pre-release runs under its channel's own id and profile, in that
channel's data root, and cannot write a stable document. [Distribution](#distribution) states the
mapping.

## The superapp is the unit

Suite Desk and Suite Go each carry one channel for the whole product. Canvas, Planner, Budget and Help
are mini-apps: they do not get a channel of their own, because their installed form is a pack with a
signed version. A pack update is a version update, not a channel move.

- **Suite Desk** is the desktop superapp and the host that opens packs.
- **Suite Go** is the mobile superapp and the container that opens domains as packs.
- **Packs** carry a signed version, a contract version and a hash-pinned file set. They do not carry a
  channel.
- **Legacy apps are frozen.** Canvas, Planner, Budget and Help remain the separate Flatpaks at their
  last artifacts. Their code stays in the tree, but they get no new release and no new pre-release
  channel until they become packs.
- **Sync is retired as a shipped app.** `run.suite.sync` is not a superapp and carries no channel; it
  gets no new build, and the signed remote keeps the last published ref for anyone who already has it.
  The host is the surface that carries sync state as the relay becomes a host capability
  ([#315](https://github.com/mrrnbhd/suite-apps/issues/315)).

Freezing is about releases, not deletion: a person can still install the last stable artifact, and the
history stays. It also means no new `slop`, `nightly` or `preview` build is published for a legacy
mini-app; the builder refuses one unless `--session` names a factory session build, which stays local.

## Distribution

The channel is carried by the distribution. A build does not flip a switch inside the app; the id, the
branch and the data folder are what make a channel.

| Build | Form | What carries the channel | Data |
| --- | --- | --- | --- |
| Suite Desk, stable | Flatpak | `run.suite.desk` on the remote's default branch | the host's own data root |
| Suite Desk, pre-release | Flatpak | `run.suite.<channel>.desk` on the `<channel>` branch | that channel's data root |
| Suite Go, stable | Release APK | the package id `run.suite.go` | the app's own data |
| Suite Go, pre-release | Release APK | the package id `run.suite.<channel>.go` | that app's own data |
| Legacy mini-app (frozen) | Flatpak | the last stable ref; no new channel is published | `Documents/Suite/<App>` |

Each channel is its own id, branch and data root. Stable is `run.suite.desk` on Desk and
`run.suite.go` on Go; slop, nightly and preview are `run.suite.<channel>.desk` and
`run.suite.<channel>.go`. Four ids mean four installs, so stable, slop, nightly and preview can be
installed and updated side by side. The ids were not always separate: slop had already carried its
own id, while nightly and preview moved from a shared `run.suite.slop` id (#380), so an install made
before that change reinstalls once under the new id. No pre-release data is migrated: the new id
starts with an empty data root, and the old one is not copied or renamed.

The Desk rename is a second fresh start. `run.suite.desk` and its slop, nightly and preview ids are a
new application identity, not an update of `run.suite.shell`: an existing install does not update into
them. The new id opens an empty data root, `~/.var/app/run.suite.shell` is ignored, and the owner may
remove it. The old refs stay on the signed remote as history and are not rebuilt.

Data is keyed by id, so every channel has a separate tree. On Desk that tree is the Flatpak sandbox
under `~/.var/app/<id>`; Go has its own app data. A frozen mini-app's pre-release build is the
exception: it is a local factory session build, not a shipped channel, and it still uses the one
`Documents/Suite Slop/<App>` folder the frozen apps already know.

Documents are copy-on-open. A pre-release opens a copy in its own folder rather than editing the
stable file in place, and it does not migrate that file. Exporting back is explicit and refuses the
stable folder rather than overwriting it; it is not a merge.

A pre-release registers no stable MIME type and no `suite://` handler, so a double-clicked `.canvas`
or a `suite://` link still reaches the stable app. A channel is opened from its card.

Flathub hosts stable only. It builds a manifest a reviewer accepts and publishes the stable id; it is
not a host for pre-release builds, and it cannot carry slop. The pre-release channels therefore live
on the self-hosted OSTree remote, where the branch names the channel. Flathub could later carry the
stable id as a second distribution; it is not the pre-release host.

## The signature

Flatpak is the only desktop distribution, so the OSTree summary is the app-side signature boundary.

| Form | What is signed | Key | How it is verified |
| --- | --- | --- | --- |
| Flatpak | the OSTree summary | the store key, public half in the `.flatpakrepo` | `flatpak install` and `flatpak update` verify the summary and every object's content hash. |

A Flatpak client verifies the summary with the store key, and every object is named by a content hash
inside that signed summary. [The signed
remote](../reference/packaging-channels.md#the-signed-remote) describes the transport and
its accepted limit.

A pre-release channel adds no third signature scheme. It is another branch under the same signed
summary. A pack adds a different boundary: it signs its manifest and hashes every file when it is
built ([Build a pack](../reference/commands.md#build-a-pack)), while the Flatpak summary still covers
the host that verifies it. The retired relay was the same kind of artifact as the other Flatpaks:
`run.suite.sync` is still on the same signed remote, and it gets no new build. The retired tarball was
the exception, and its `SHA256SUMS` was signed with the update key.

## What a channel cannot undo

Installing and uninstalling a channel is reversible, apart from the documents: remove the build and the
machine is where it was. These steps are not.

- **A newer document does not open in an older build.** A schema migration is one-way; a lower channel
  refuses the file rather than downgrading it. [File formats](../reference/file-formats.md#opening-a-file-another-version-wrote)
  owns the rule.
- **A copied document diverges once edited.** Copy-on-open makes the channel's copy its own document;
  export back refuses the stable folder rather than overwriting it, and is not a merge.
- **Removing the pre-release data deletes the pre-release documents.** The host removes the channel's
  data directory only after a confirmation; the stable folder is never in that path.
- **A store-key rotation does not reach an installed remote.** The remote carries the public half
  Flatpak verifies; a new store key needs the remote re-added with the new `.flatpakrepo` before a
  later update can verify.

## The badge

A channel badge is a promise, and it is persistent: a screenshot of the window shows which build is
running, and a restart does not remove it. It commits to four things:

- the build is that channel, not "newer than stable";
- it writes that channel's data root, separate from stable and from every other channel;
- an update moves within the channel and never across it;
- removing it leaves the stable documents alone.

A first run names the risk and the removal path in words, because a badge is not a warning. A stable
card has no badge: stable is the default and the baseline the others are compared to.

## Reading

- [Packaging channels](../reference/packaging-channels.md) for the delivery form, file ownership and
  the signed remote.
- [File formats](../reference/file-formats.md) for how a newer document is refused.
- [Status](../reference/status.md) for what the tree ships today and which apps are frozen.
- [Mini-app model](mini-app-model.md) for packs and the signed version a mini-app carries instead of
  a channel.
- [Budget's beta bar](../../apps/budget/docs/reference/beta-bar.md) for a boundary written as checks,
  with the evidence and the boxes a person still has to tick. It stays with the frozen app as the bar
  a future pack has to clear.
- [Architecture](architecture.md) for why the desktop superapp is separate from the legacy apps.
