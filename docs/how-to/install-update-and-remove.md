# Install, update and remove apps

Suite Start manages the apps it installed. It never edits a document, and removing an app does not
remove documents. Linux desktop apps are Flatpaks, so Start asks Flatpak to change every deployment.

## Install

1. Open Suite Start.
2. On an app card, choose **Install**.
3. When it finishes, choose **Open**.

Start reads the Flatpak remote `suite` first and then `suite-local`. When either offers the app, the
card says `Not installed yet · from the store` and Install asks Flatpak to install it. There is no
download, manifest feed or second copy to place.

## Add a copy you built

Choose **Add app…**, then select the executable. Start reads the `suite.app.json` beside it and writes
the install record. A copy you placed this way is first-class, but Start does not update it: the card
offers Open, Reveal and Forget rather than Update and Uninstall, and its updates are yours to make.

## Update

Choose **Update** on a Flatpak card, or **Check for updates** to ask the store again.

Start reads the deployment's own `origin` remote and compares that remote's commit, so a copy
installed from `suite-local` is not measured against the public `suite` store. When the origin offers a
different commit, the card says `update available` and **Update** asks Flatpak to replace the
deployment. A running app keeps the old commit until it restarts: Flatpak swaps the deployment
underneath it, and Start does not close an app it did not start.

Start does not update a folder copy; it only launches it.

## Remove

- **Uninstall** on a Flatpak card asks Flatpak to remove the deployment.
- **Forget** on a placed copy removes the record only.
- Start never deletes a document.

One copy per app is the rule. A Flatpak deployment and a folder copy share a profile and its
single-instance lock, so only one can run; when both exist, Start shows the Flatpak and lists the
folder copy as a duplicate to remove.

## Update the hub

The hub is a Flatpak. Its row says `Flatpak` and offers **Update Start** only when the installed
`run.suite.start` commit differs from the newest commit on that deployment's own origin. A placed
copy, a current build and a failed check offer no button. Flatpak replaces the deployment, and the
new build starts on the next launch. `flatpak update --user run.suite.start` does the same thing
without the button. A hub cannot replace its own running binary, and Start no longer keeps a second
version to roll back to.

## Flatpak visibility

Start reads the Flatpak installation selected by `XDG_DATA_HOME`. If a tool points that at a
per-session directory, run Start or the app with `XDG_DATA_HOME=$HOME/.local/share` to see the real
user installation.

See [Packaging channels](../reference/packaging-channels.md) for the form, the signed remote and who
updates it.
