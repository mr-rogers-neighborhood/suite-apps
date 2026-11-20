# Install, update and remove apps

Suite Start manages the apps it installed. It never edits a document, and removing an app does not
remove documents.

## Install

1. Open Suite Start.
2. On an app card, choose **Install**.
3. When it finishes, choose **Open**.

Start installs through the channel the card names. When the local Flatpak store offers the app, the
card says `Not installed yet · from the store` and Install asks Flatpak to install it. Otherwise Start
downloads the artifact named by the verified feed manifest, checks its sha512, places it under
`~/Applications/Suite/<App>/<version>/`, and writes an install record. Nothing is unpacked into a
shared location.

## Add a copy you built

Choose **Add app…**, then select the executable. Start reads the `suite.app.json` beside it and writes
the install record. A copy you placed this way is first-class: it manages its own updates, and the
card offers Open, Reveal and Forget rather than Update and Uninstall.

## Update

Choose **Update** on a managed card, or **Check for updates** to ask every feed again. If the app is
running, Start asks before closing and replacing it.

A Flatpak card says `update available` when the store publishes a different commit from the one
deployed on this machine. **Update** asks Flatpak to replace it. A running app keeps the old commit
until it restarts: Flatpak swaps the deployment underneath it, and Start does not close an app it did
not start.

A copy you placed yourself updates itself; Start only launches it, whatever the feed says.

## Remove

- **Uninstall** on a managed card removes the versions, menu entry, icon and install record. Documents
  are untouched.
- **Forget** on a placed copy removes the record only.
- A Flatpak card offers **Uninstall**, which asks Flatpak to remove the app.

One copy per app is the rule. Two copies share a profile and its single-instance lock, so only one can
run. An AppImage that Start placed wins over a Flatpak when both exist, because the AppImage is the
copy Start may replace.

## Update the hub

Suite Start does not update itself. Download the newer package or AppImage from its release page and
install it the same way as the first time. The hub's own row links to the release.

## A build from before the update-key rotation

The update key was replaced on 2026-11-20. An installed build verifies a feed with the key it was built
with, so a copy of Suite Start from before that date refuses every feed signed after it. The cards say
`no release found` and offer no Update, and the hub's own row has no release link to follow. It reads
like a server problem; it is the key the build carries.
[Packaging channels](../reference/packaging-channels.md#the-update-key) has the rule.

The way out is one manual download. Open the
[Suite releases page](https://github.com/mr-rogers-neighborhood/suite-apps/releases), download the
current Suite Start, and install it as described under [Update the hub](#update-the-hub). That build
pins the current key, and the apps it manages can update again from there.

## Flatpak visibility

Start reads the Flatpak installation selected by `XDG_DATA_HOME`. If a tool points that at a
per-session directory, run Start or the app with `XDG_DATA_HOME=$HOME/.local/share` to see the real
user installation.

See [Packaging channels](../reference/packaging-channels.md) for why the hub is packaged while the
apps are AppImages.
