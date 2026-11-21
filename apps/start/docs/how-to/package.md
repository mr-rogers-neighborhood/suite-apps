# Packaging: Flatpak, and the relay tarball

Linux desktop apps in the suite ship as Flatpaks. The relay is a server tarball. Those are the only
two artifact forms, and they differ in who owns the installed files.

| Form          | Built for                                 | Who owns the files        | Updates arrive by            | Root needed                         |
| ------------- | ----------------------------------------- | ------------------------- | ---------------------------- | ----------------------------------- |
| **Flatpak**   | Canvas, Planner, Budget, Help and the hub | Flatpak, inside a sandbox | an OSTree remote             | no for `--user`, yes for `--system` |
| Relay tarball | `suite-sync`                              | the person, under `/opt`  | the person replaces the tree | yes                                 |

There is no AppImage, Arch package, `deb`, `rpm` or `snap`. Help is a Flatpak like the rest.

## The rule

**Start asks the writer that owns the deployment. It never replaces a Flatpak itself.**

A Flatpak deployment belongs to Flatpak, so Start lists it, launches it, reveals it, and asks Flatpak
to install, update or remove it. A folder copy a person placed is not Start's either: the card offers
Open, Reveal and Forget, and its updates are the person's to make.

The hub is a Flatpak too. Its own row says `Flatpak` and offers **Update Start** when the store
publishes a newer commit; Flatpak replaces the deployment and the new build starts next launch.

## Flatpak for the hub

`node scripts/flatpak.mjs --app start` builds `run.suite.start` from the unpacked `package:dir` tree
with the same zypak wrapper as the apps. Its exported desktop entry registers
`x-scheme-handler/suite`, and `run.suite.start` is both the application id and the window's WM class.

A sandboxed package manager needs a wider door. The manifest grants the host Flatpak service
(`org.freedesktop.Flatpak`, used with `flatpak-spawn --host`) and the folders Start owns: the
applications root, menu entries, icons, suite data and config, and the documents tree read-only. The
host service is effectively host command execution, and it is the trade that lets the hub manage
Flatpaks from a sandbox. The one-writer rule is unchanged: Flatpak writes the hub's own deployment,
and Start never writes into a Flatpak install tree.

## Flatpak for the apps

Each app has a manifest beside the others:

```
packaging/flatpak/run.suite.canvas.yml
packaging/flatpak/run.suite.planner.yml
packaging/flatpak/run.suite.budget.yml
packaging/flatpak/run.suite.help.yml
packaging/flatpak/run.suite.start.yml
```

`node scripts/flatpak.mjs --app planner` packages the unpacked build, exports it to
`~/suite-flatpak/repo`, adds that as the user remote `suite-local`, and installs from it. The script
signs the repository summary with the store key and adds the remote with the public half; with no key
it adds `--no-gpg-verify` for local testing and says so. [Packaging
channels](../../../../docs/reference/packaging-channels.md#flatpak) owns the remote, the permissions
and the pre-release branches.

Start treats an installed Flatpak as a first-class app: it reads `flatpak list`, starts it with
`flatpak run`, reveals the deployment, asks Flatpak to remove it, and — when the store offers a
different commit — asks Flatpak to update it. It reads the deployment's own `origin` and compares
that remote's commit, so a copy from `suite-local` is not measured against the public `suite` store.
Flatpak stays the writer.

## Building a Flatpak

```sh
node scripts/flatpak.mjs --app start              # the hub
node scripts/flatpak.mjs --app planner            # Planner
node scripts/flatpak.mjs --app help               # Help
node scripts/flatpak.mjs --app planner --no-build # reuse release/linux-unpacked
node scripts/flatpak.mjs --app planner --channel slop  # pre-release branch
```

Run the owning app's gate first. The script builds the unpacked tree when needed, exports the
repository, and installs or updates the local deployment. `--no-install` publishes without touching
the client.

## Publishing

`node scripts/flatpak-remote.mjs` is the publish path. It is a dry run by default: it prints the
branch, refs and bytes it would copy, and refuses a dirty tree or a HEAD the gate has not proven. With
`--publish` it signs the repository summary, verifies it in a throwaway Flatpak installation and
copies the repository to `suite-dev`. It publishes the repository the local flow built; it never
builds a second one.

The relay is separate: `node scripts/release.mjs sync --publish` builds, signs and uploads its
tarball. See [Leave a relay running](../../../sync/docs/how-to/relay.md#building-and-publishing-a-release).
