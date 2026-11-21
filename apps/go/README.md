# Suite Go

**One mobile app for the Suite domains.** A container that opens one domain at a time, hands it a
document, and stays out of its way.

> **v0: the shell, two modules and an install path.** Scratch is the reference module that proves the
> contract; Canvas is a placeholder that says its tablet layout is not built. A signed pack installs
> and appears on the home surface through the same declaration path.
> [Planner's state](docs/reference/planner.md) is where the first real domain stands.

## Why one app

The suite is three domains and a hub, and on a desktop that separation is worth paying for: separate
windows, separate files, separate update feeds. On a phone it is not. Three app store listings, three
signing pipelines, three onboarding flows and three ways to be confused about which app holds what is
a tax paid three times for a separation a phone does not need.

The thing to guard against is not the single binary, it is the single _screen_: one dashboard showing
tasks and budget envelopes together because they happen to live in the same process. So the container
keeps the domain boundaries exactly as hard as they are on the desktop. It knows how to launch a
module, hand it a document handle, and nothing else.

## Two rules

1. **The container never reads a document.** It carries bytes and a name. `.planner`, `.budget` and
   `.canvas` are shapes their own apps own.
2. **The container never learns a domain.** It routes on what a module _declares_. There is no
   `if (module.id === "planner")` anywhere in the shell, and there should never be one.

## What exists

| Area                 | State                                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `@suite/go` contract | Module declarations, capability routing, capture intents, host services, teardown isolation                                         |
| Shell                | Home surface: capture bar, pinned domains, recents; honest empty states                                                             |
| Domain modules       | Scratch proves mount, document handoff, capture and teardown; Canvas is a placeholder                                               |
| Packs                | A signed pack installs and appears on home; [Planner's state](docs/reference/planner.md) records where the first real domain stands |
| Android              | Debug APK installs and launches on a physical device over USB                                                                       |
| iOS                  | Wired by convention, unbuilt — Xcode needs macOS                                                                                    |
| Sync                 | Seam designed, no transport. `ModuleHost` is where it will arrive                                                                   |

## Run it

```sh
pnpm install
pnpm run doctor          # what is present, what is missing, what to run
pnpm android:install     # build, install and launch on the attached phone
pnpm android:watch       # the same, again, on every save
pnpm android:emulator --start suite-go-atd
pnpm android:eval "document.body.innerText"   # ask the running app a question
pnpm android:ax --assert                      # fail on an unnamed control
pnpm check               # lint, types, tests
```

`pnpm android:eval` is how a device gets asserted on. WebView content is invisible to
`uiautomator` and screenshot diffing only guesses, so the container's own state is read back over
DevTools: `pnpm android:eval "localStorage.getItem('suite-go:shell:list')"`.

`pnpm run doctor` exists because the failure modes here are unhelpful: a phone that is attached but
unauthorised looks exactly like one that is not attached, and Gradle reports a missing SDK component
in a stack trace whose useful sentence is twenty lines in.

## Install the APK

Suite Go ships as a **debug-signed APK** attached to the rolling Suite release. It is what you
sideload and what the owner tests; there is no Play Store build and no release signing key yet.

```sh
mise exec -- node scripts/android-release.mjs            # build, name and checksum it
mise exec -- node scripts/android-release.mjs --publish  # attach it to the rolling release
adb install -r -t apps/go/.dev/release/suite-go-<version>.apk
```

"Debug-signed" means the build uses this machine's `~/.android/debug.keystore`. That signature is
specific to the machine that built it, so an APK from another machine cannot update this one: run
`adb uninstall run.suite.go` once, then install. The build is debuggable, which is why it is a
sideload artifact and not a store one.

`pnpm android:install` stays the dev loop; `scripts/android-release.mjs` is the release copy that
names and checksums the artifact for download. [Android notes](docs/reference/android.md) cover the
device and the toolchain.

## Packages

| Path          | Owns                                                       | Does not own                                     |
| ------------- | ---------------------------------------------------------- | ------------------------------------------------ |
| `packages/go` | Module declarations, routing, host interfaces, teardown    | Any domain schema, any I/O, any React at runtime |
| `src`         | The shell: home, capture resolution, document store, theme | What any document means                          |

See [the contract](docs/reference/contract.md) for what a module may do, and
[adding a domain](docs/how-to/add-a-domain.md) for how little the container needs to change.

---

For the product story and the influences behind it, read
[What Suite is](../../docs/explanation/why-suite-exists.md).
