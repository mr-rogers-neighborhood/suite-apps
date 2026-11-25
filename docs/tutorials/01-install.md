# 1. Install the desktop apps

Suite Desk is the desktop host and the way in: install it once, then install packs from its
catalogue. [The root README](../../README.md#the-hosts) owns the install line.

This tutorial's Canvas workspace still runs as a frozen Flatpak, so step 2 installs it with the one
`flatpak install` line the release page prints. Start no longer exists (#314); the host is the only
desktop install path.

**You need:** a Linux desktop. The published builds are x86_64.

## Next

Install Canvas for step 2 with `flatpak install --user suite run.suite.canvas`. As apps ship as packs,
the host's catalogue becomes the same path.
