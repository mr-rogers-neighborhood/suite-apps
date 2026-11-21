# Changelog

Written for people, not commits: what you can do now that you could not before, and what changed
underneath enough to matter.

Versions here are Suite Start's own, tagged `start-v<version>`. The historical `v0.1.x` tags are
Canvas's releases from before the monorepo, not the launcher's. The rules are in
[Version ownership](../../docs/how-to/package-and-release.md#version-ownership).

## [Unreleased]

No changes yet.

## [0.3.15] - 2026-11-20

### Added

- **Pre-release apps sit beside stable ones.** A stable app and its one pre-release now appear as
  two cards: the pre-release carries a text badge naming its tier (slop, canary or beta) and a
  notice naming the risk and how to remove it. Removing a pre-release asks before deleting its
  separate documents; stable data is never touched.
- **One pre-release install at a time.** Choosing another tier switches the existing install's
  branch instead of adding a second copy, and the card says the data folder changes with it.
- **Sync is a service you can run anywhere.** The Sync pane starts and stops a `suite-sync` relay it
  finds through `SUITE_SYNC_BIN` or `PATH`, shows its address and store, and explains how to install
  the relay when it is missing. The relay itself now ships as a checksummed, signed release.

## [0.3.14] - 2026-11-20

### Changed

- **Feeds come from one folder per app, served from the repository.** The hub reads
  `feeds/<app>/latest-linux.yml` at `main` instead of reaching into each app's own repository, so
  four apps can publish from this one repository without sharing a single `releases/latest` URL. The
  manifest is signed and names the release asset it offers. A raw file host rather than GitHub
  Pages, because a Pages build needs Actions and Actions is unavailable on this account.
- **The update key is rotated.** An installed build verifies a feed with the key it was built with,
  and this build pins the new key. Start does not update itself, so download this release once; it
  becomes the root of trust for every feed signed afterwards.

### Added

- **Start installs and updates from the local Flatpak store.** A card whose app the store offers says
  `Not installed yet · from the store`, and Install asks Flatpak to install it even when no AppImage
  feed answered. A deployment whose commit is behind the store's says `update available`, and Update
  asks Flatpak to replace it. Start reads the published commit and the deployed one; it never swaps a
  deployment itself, and a running Flatpak keeps running the old commit until it restarts.
- **A copy you placed yourself is described by who owns it.** The card says
  `from a folder · updates itself` whatever the hub's feed says, instead of borrowing the feed's
  version and offering an Update that would install a second copy in another format.

- **Start sees Flatpak installs.** An app installed with Flatpak appears on its card with its own
  version, opens through `flatpak run`, can be shown in the file manager, and can be removed by
  asking Flatpak to remove it. The card says `Flatpak` instead of borrowing the AppImage feed's
  version, because the remote is that install's update path. When the same app is also installed as
  an AppImage, the AppImage is the one shown: two copies cannot run at once, and the AppImage is the
  one Start may replace.

## [0.3.12] - 2026-11-08

### Added

- A density axis on the shared primitives, in the three names the mobile container already
  publishes. `comfortable` reaches a 44px control, which is what touch accessibility asks for, and
  the default reproduces today's 36px exactly.
- Named type sizes, keeping the five values that were actually in use.

### Changed

- `Launch` draws one centred card for all four apps. It used to offer three frames so each app could
  keep its own launcher; that was the wrong shape for the goal, because three screens a person
  moves between should not ask them to relearn the front door.
- Faint text meets 4.5:1 in every preset. It was 3.42:1 on white at 11px, and the palette gate never
  checked the role because it was listed among the marks.
## [0.3.11] - 2026-11-07

### Added

- **The hub wears the suite's own mark**, beside its name in the sidebar. It is drawn in the
  theme's ink, so it belongs in Solarized and Warm instead of being a fixed black or white.

## [0.3.10] - 2026-11-07

### Changed

- **Settings says what a person can act on.** The Updates and Network rows described how the rule
  is implemented rather than what happens on this machine. A sync notice now says what the state
  means instead of repeating its own heading.

## [0.3.9] - 2026-11-07

### Fixed

- **The sidebar follows the theme.** It was a hardcoded near-white that no theme ever set, so
  it stayed light in every dark preset.
- **The page, the cards and the sidebar are three different surfaces.** The page was painted
  the same role as a card, so in light mode cards were two near-whites with a faint border.
- **The select controls are fields.** They drew the browser's own grey control beside rounded,
  themed inputs.
- **The attention badge uses the ink its theme defines** for a filled danger surface, instead
  of assuming white.
- The settings labels no longer shift when a long path appears in a value, and the sidebar's
  first item is named for the pane it opens.

## [0.3.8] - 2026-11-07

### Added

- **Three colour themes, each in light and dark.** Suite (unchanged), Solarized in its two
  official variants, and Warm: charcoal and amber, in the spirit of Logseq. Settings offers a
  Theme list and a Brightness toggle, because those are two questions.
- **Every colour is now a named role** with a companion ink, so a filled button can never end
  up with text the theme did not check. The values are measured against WCAG 2.2 AA in the
  build gate: 4.5:1 for text, 3:1 for focus rings and component edges.

### Fixed

- A text field's border is a component boundary, so it now clears 3:1 rather than using the
  decorative hairline. The focus ring uses its own role.

## [0.3.7] - 2026-11-07

### Fixed

- **A menu entry repairs itself when the hub opens.** An entry is only written when its app is
  installed or updated, so an app that is already current kept the icon an older build gave it —
  forever. Startup now rewrites the entry and icon of every app this hub installed, which is how
  the icon fix reaches a machine that was already up to date.

### Changed

- The Apps, Files and Settings panes describe themselves in one sentence each, and the apps pane
  is titled Start rather than Apps.

## [0.3.6] - 2026-11-07

### Fixed

- **Each app's menu entry shows its own icon.** Every entry was given the hub's own mark, so all
  three apps looked identical in the menu — and an update overwrote a correct icon installed by a
  package with it. The artwork now comes from the app, at the size the icon folder claims.
- The app's mark lines up with the app's name on its card. It sat about eight pixels high.

### Added

- **Go back one version.** After an update, a card offers the version it replaced. The replaced
  binary is kept rather than deleted, and going back needs no download. Pressing it again returns
  you, so the button is not a one-way door.
- **Settings says where everything is.** Per installed app: the binary, the documents folder and
  the data directory — the same paths the app itself resolves, so they cannot drift.
- **A theme switch.** The window follows the desktop until you say otherwise; Settings offers
  Follow the desktop, Light and Dark, and the choice is remembered across restarts.

## [0.3.5] - 2026-11-07

### Added

- Each app's card carries that app's own mark, so a card and the window it opens look like the
  same thing.
- A card says when an app is on a channel other than stable, rather than leaving it to whoever
  reads the release notes.

### Fixed

- The window is drawn before the local relay starts, so a slow or conflicting port no longer
  delays the first paint.
- An app installed under the hub's own root is never described as "from a folder". Before the
  release feed answers, the card said the opposite of the truth about an app Start had installed.

## [0.3.4] - 2026-11-07

### Fixed

- The menu entry matches the class the window actually reports, and the package no longer ships a
  dangling link.

## [0.3.3] - 2026-11-07

### Added

- A managed install earns a menu entry, so it can be opened without the hub. This is the release
  where the launcher stopped being the only door to the apps it installed.

## [0.3.2] - 2026-11-07

### Fixed

- The Arch package installs a tree you can enter. 0.3.1 installed and then reported
  `Could not find the program '/opt/suite-start/suite-start'`, because a root-owned directory the
  user cannot traverse makes every file inside it look missing.
- The package ships the icon at every size rather than one, so panels stop scaling a single image.

## [0.3.1] - 2026-11-07

### Added

- A launch that fails says why, instead of a card that still offers Open.
- An Arch package, so the hub needs neither FUSE nor a manual `chmod`.

### Fixed

- Artifact names carry no spaces. GitHub rewrites a space to a dot in an asset name, which made the
  signed feed name a file the release did not have — a 404 for every install.

## [0.3.0] - 2026-11-06

### Added

- The first launcher that can install and update the other apps from their signed feeds: one
  window, one card per app, one place to press.
