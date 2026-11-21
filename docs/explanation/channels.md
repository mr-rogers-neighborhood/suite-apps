# Channels

A channel is a product promise. The build on a card is not only newer or older: its tier says what it
has survived and what a person may rely on. A tier with no check at its boundary is just a name, so
the checks are part of the definition.

Channels are per app. Canvas can be in `beta` while Planner is `stable`; a tier belongs to one app's
build, not to the suite.

## The four tiers

| Tier | The promise |
| --- | --- |
| `slop` | Today's work. It may be broken, incomplete or change shape without notice; it promises only that it is the build being worked on. |
| `canary` | It builds and runs. It is still unstable. |
| `beta` | It is shaped as it will ship: reviewed, documented, and with no irreversible step left in it. |
| `stable` | It is a release: versioned, supported, and the default a person is offered. |

## The three boundaries

A build enters a tier by passing the boundary below it. Passing is a decision someone makes; the
checks are the evidence, not an automatic promotion.

| Boundary | The question | What the check requires |
| --- | --- | --- |
| `slop` → `canary` | Does it work? | The gate is green at `--fresh`; the artifact installs; the app launches; an existing document opens without requiring a new document migration. |
| `canary` → `beta` | Is it shaped right? | A person reviews it; the docs and the decision record describe it; nothing the build writes is irreversible. |
| `beta` → `stable` | Is it a release? | The version is bumped in the file that owns it; the release criteria hold; the support promise is written. |

## What "unstable" does not mean

`unstable` is not a tier and not a colour between `slop` and `canary`. `slop` already is unstable. A
build does not move up by being called unstable, and no boundary checks for it.

Unstable does not mean unverified. A Flatpak tier verifies the signed OSTree summary with the store
key, and the relay's checksum list is signed with the update key. Unstable means the code may change
or break, not that the bytes are unaccounted for.

Unstable does not mean shared. A pre-release runs under one pre-release id and profile, in its own
pre-release data folder, and cannot write a stable document. [Distribution](#distribution) states the
mapping.

## Distribution

The tier is carried by the distribution. A build does not flip a switch inside the app; the id, the
branch and the data folder are what make a tier.

| Build | Flatpak id | Branch | Data folder |
| --- | --- | --- | --- |
| stable | `run.suite.<app>` | the remote's default branch | `Documents/Suite/<App>` |
| pre-release (`slop`, `canary`, `beta`) | `run.suite.slop.<app>` | the tier's branch | `Documents/Suite Slop/<App>` |

One pre-release id, three branches. A person has one pre-release install at a time; switching from
`slop` to `canary` keeps the install and keeps the same pre-release data folder. Stable and
pre-release are two ids, so they are two cards and can be installed side by side. A pre-release build
cannot resolve the stable profile.

Data is keyed by id, so the stable id and the pre-release id have separate trees. Every pre-release
tier writes the one `Documents/Suite Slop/<App>` folder; the tiers are not separated from each other,
only from stable. That is why one pre-release install at a time is the supported shape.

Documents are copy-on-open. A pre-release opens a copy in its own folder rather than editing the
stable file in place, and it does not migrate that file. Exporting back is explicit and refuses the
stable folder rather than overwriting it; it is not a merge.

A pre-release registers no stable MIME type and no `suite://` handler, so a double-clicked `.canvas`
or a `suite://` link still reaches the stable app. A tier is opened from its card.

Flathub hosts stable only. It builds a manifest a reviewer accepts and publishes the stable id; it is
not a host for nightly or tier builds, and it cannot carry slop. The tiers therefore live on the
self-hosted OSTree remote, where the branch names the tier. Flathub could later carry the stable id
as a second distribution; it is not the tier host.

## The signature

Flatpak is the only desktop distribution, so the OSTree summary is the app-side signature boundary.

| Form | What is signed | Key | How it is verified |
| --- | --- | --- | --- |
| Flatpak | the OSTree summary | the store key, public half in the `.flatpakrepo` | `flatpak install` and `flatpak update` verify the summary and every object's content hash. |

A Flatpak client verifies the summary with the store key, and every object is named by a content hash
inside that signed summary. [The signed
remote](../reference/packaging-channels.md#the-signed-remote) describes the transport and
its accepted limit.

A tier adds no third signature scheme. It is another branch under the same signed summary. The relay
is the same kind of artifact: `run.suite.sync` is a Flatpak on the same signed remote. The retired
tarball was the exception, and its `SHA256SUMS` was signed with the update key.

## What a tier cannot undo

Installing and uninstalling a tier is reversible, apart from the documents: remove the build and the
machine is where it was. These steps are not.

- **A newer document does not open in an older build.** A schema migration is one-way; a lower tier
  refuses the file rather than downgrading it. [File formats](../reference/file-formats.md#opening-a-file-another-version-wrote)
  owns the rule.
- **A copied document diverges once edited.** Copy-on-open makes the tier's copy its own document;
  export back refuses the stable folder rather than overwriting it, and is not a merge.
- **Removing the pre-release data deletes the pre-release documents.** Start removes the channel's
  data directory only after a confirmation; the stable folder is never in that path.
- **A store-key rotation does not reach an installed remote.** The remote carries the public half
  Flatpak verifies; a new store key needs the remote re-added with the new `.flatpakrepo` before a
  later update can verify.

## The badge

A tier badge is a promise, and it is persistent: a screenshot of the window shows which build is
running, and a restart does not remove it. It commits to four things:

- the build is that tier, not "newer than stable";
- it writes the pre-release data folder, separate from stable;
- an update moves within the tier and never across it;
- removing it leaves the stable documents alone.

A first run names the risk and the removal path in words, because a badge is not a warning. A stable
card has no badge: stable is the default and the baseline the others are compared to.

## Reading

- [Packaging channels](../reference/packaging-channels.md) for the delivery form, file ownership and
  the signed remote.
- [File formats](../reference/file-formats.md) for how a newer document is refused.
- [Status](../reference/status.md) for what the tree ships today.
- [Architecture](architecture.md) for why the desktop shell is separate apps.
