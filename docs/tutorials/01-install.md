# 1. Install Suite Start

Suite Start is the hub: one window that installs, updates and opens the other apps. It is the only
piece you fetch by hand.

**You need:** a Linux desktop. The published builds are x86_64.

## On Arch

Download the current `suite-start-bin-<version>-1-x86_64.pkg.tar.zst` from the
[latest release](https://github.com/mr-rogers-neighborhood/suite-start/releases/latest), then:

```sh
sudo pacman -U suite-start-bin-<version>-1-x86_64.pkg.tar.zst
```

The package installs the hub under `/opt`, adds a menu entry and needs no FUSE. The hub does not
update itself; a new version arrives the same way.

## Everywhere else

Download `suite-start-<version>-x86_64.AppImage` from the same release, then:

```sh
chmod +x suite-start-<version>-x86_64.AppImage
./suite-start-<version>-x86_64.AppImage
```

An AppImage needs FUSE 2. If the file will not start, install `fuse2` (Arch), `libfuse2` (Debian,
Ubuntu) or `fuse` (Fedora), or run `./suite-start-<version>-x86_64.AppImage
--appimage-extract-and-run`.

## Verify the download

The release publishes `latest-linux.yml`, which names the file and its SHA-512. Compare it before you
run the file:

```sh
sha512sum suite-start-<version>-x86_64.AppImage
```

This is the same check Start makes on every app it installs. The full procedure, including the error
messages worth recognising, is in
[Installing Suite Start](../../apps/start/docs/how-to/install.md).

## Next

Open **Suite Start**. The window lists the apps in the suite. Continue with
[2. Make a first workspace](02-first-workspace.md).
