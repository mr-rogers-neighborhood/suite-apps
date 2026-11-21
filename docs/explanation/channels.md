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

Unstable does not mean unverified. A stable AppImage verifies its signed manifest with the update
key; a Flatpak tier verifies the signed OSTree summary with the store key; a pre-release AppImage tag
carries its artifact and checksum. Unstable means the code may change or break, not that the bytes
are unaccounted for.

Unstable does not mean shared. A pre-release runs under one pre-release id and profile, in its own
tier's data folder, and cannot write a stable document. [Distribution](#distribution) states the
mapping.

## Distribution

The tier is carried by the distribution. A build does not flip a switch inside the app; the id, the
branch and the data folder are what make a tier.

| Build | Flatpak id | Branch | Data folder |
| --- | --- | --- | --- |
| stable | `run.suite.<app>` | the remote's default branch | `Documents/Suite/<App>` |
| slop | `run.suite.slop.<app>` | `slop` | the pre-release tree, under `slop` |
| canary | `run.suite.slop.<app>` | `canary` | the pre-release tree, under `canary` |
| beta | `run.suite.slop.<app>` | `beta` | the pre-release tree, under `beta` |

One pre-release id, three branches. A person has one pre-release install at a time; switching from
`slop` to `canary` keeps the install and switches the data folder. Stable and pre-release are two
ids, so they are two cards and can be installed side by side. A pre-release build cannot resolve the
stable profile.

Data is keyed by id, so the stable id and the pre-release id have separate trees; the tier is a
subdirectory inside the pre-release tree, chosen by the build. A `slop` build cannot write the `beta`
folder.

Documents are copy-on-open. A pre-release opens a copy in its own folder rather than editing the
stable file in place, and it does not migrate that file. Exporting back is explicit and overwrites
the stable document; it is not a merge.

A pre-release registers no stable MIME type and no `suite://` handler, so a double-clicked `.canvas`
or a `suite://` link still reaches the stable app. A tier is opened from its card.

AppImage is the alternate form, with its own feed. A stable AppImage lives under `~/Applications` and
updates from `feeds/<app>/`, as [Packaging channels](../reference/packaging-channels.md) describes.
Only stable writes that feed: a pre-release tag carries its artifact and checksum, but never writes
`feeds/<app>/`. A tier's update path is its Flatpak branch.

Flathub hosts stable only. It builds a manifest a reviewer accepts and publishes the stable id; it is
not a host for nightly or tier builds, and it cannot carry slop. The tiers therefore live on the
self-hosted OSTree remote, where the branch names the tier. Flathub could later carry the stable id
as a second distribution; it is not the tier host.

## Two signatures

Both distributions are signed, with different keys and different scopes.

| Form | What is signed | Key | How it is verified |
| --- | --- | --- | --- |
| AppImage feed | `latest-linux.yml` | the update key, compiled into the build | Start checks the manifest signature, then the artifact's sha512. |
| Flatpak | the OSTree summary | the store key, public half in the `.flatpakrepo` | `flatpak install` and `flatpak update` verify the summary and every object's content hash. |

An AppImage build verifies the manifest with the update key compiled into it; [the update
key](../reference/packaging-channels.md#the-update-key) states what a rotation does to an installed
copy. A Flatpak client verifies the summary with the store key, and every object is named by a
content hash inside that signed summary. [The signed
remote](../reference/packaging-channels.md#the-signed-remote-on-suite-dev) describes the transport
and its accepted limit.

A tier adds no third signature scheme. It is another branch under the same signed summary. A
pre-release AppImage has no feed manifest: its tag carries the artifact and checksum, and the
AppImage is a manual download rather than an auto-updating install.

## What a tier cannot undo

Installing and uninstalling a tier is reversible, apart from the documents: remove the build and the
machine is where it was. These steps are not.

- **A newer document does not open in an older build.** A schema migration is one-way; a lower tier
  refuses the file rather than downgrading it. [File formats](../reference/file-formats.md#opening-a-file-another-version-wrote)
  owns the rule.
- **A copied document diverges once edited.** Copy-on-open makes the tier's copy its own document;
  export back is an overwrite, not a merge.
- **Removing a tier's data deletes that tier's documents.** Start removes the channel's data
  directory only after a confirmation; another tier's folder is never in that path.
- **A key rotation does not reach an installed copy.** A build keeps verifying with the key it was
  built with, so a feed signed with a new key is invisible to it until a build carrying the new key
  is installed.

## The badge

A tier badge is a promise, and it is persistent: a screenshot of the window shows which build is
running, and a restart does not remove it. It commits to four things:

- the build is that tier, not "newer than stable";
- it writes that tier's data folder, separate from stable and from every other tier;
- an update moves within the tier and never across it;
- removing it leaves every other tier's documents alone.

A first run names the risk and the removal path in words, because a badge is not a warning. A stable
card has no badge: stable is the default and the baseline the others are compared to.

## Reading

- [Packaging channels](../reference/packaging-channels.md) for the delivery forms, file ownership and
  the update key.
- [File formats](../reference/file-formats.md) for how a newer document is refused.
- [Status](../reference/status.md) for what the tree ships today.
- [Architecture](architecture.md) for why the desktop shell is separate apps.
