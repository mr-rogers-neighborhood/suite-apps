# Start

Suite Start is the hub window: what is installed, which documents exist, whether sync is configured,
and where the hub keeps its own state. It ships from the `suite-apps` monorepo and is installed
separately from the apps it launches, so Canvas, Planner and Budget all work with Start uninstalled.

## The rail

Four sections, fixed. Anything else is a row inside one of them.

| Section | What it shows |
| --- | --- |
| Apps | One card per install, and one per install that cannot be used |
| Files | Recently opened files, then every app's documents |
| Sync | Whether this machine runs the sync host, what it is holding, and who is connected |
| Settings | The data directory, the documents root, the install roots, update and network notes, the theme and the version |

The rail is a tab set. Arrow keys move the selection and the pane together, Home and End reach the ends,
and only the selected tab sits in the tab order. A count beside Apps appears when at least one install
needs attention.

## The card

| Field | Where it comes from |
| --- | --- |
| Name and version | The app's own manifest beside its executable |
| Channel | `update.channel` in that manifest, `stable` when it says nothing |
| Update state | The signed release feed the catalogue entry names |
| File count | The index of that app's documents folder |
| Health | The manifest parsed, and the executable the install record names still exists |

An install that fails the health checks appears as a card with the reason and no Open button, because a
button that cannot work is worse than a sentence.

## What it reads

| Read | Where |
| --- | --- |
| App manifests | One `suite.app.json` per install, under each install root |
| Install records | `installs.json` under `~/.config/suite/start` |
| Recent files | `recents.json` in the data directory |
| Documents | `~/Documents/Suite/<App>`, one level deep |
| Release feeds | The signed `latest-linux.yml` each app's catalogue entry names |

The documents root is the convention every app writes to, so the hub lists a planner's files without
importing a line of planner. A file whose app is not installed is still listed, and the row says so.

## What it never does

It writes `installs.json`, `recents.json`, its theme choice and nothing else. It does not rename, move
or edit a document, and it keeps no second library: no names, no pins, no last board. A row opens a
file, and that is everything a row offers.

It reads each feed when the window opens and when **Check for updates** is pressed. It downloads an
artifact only when a person presses **Install** or **Update**. A card whose feed did not answer says
the update state is unknown rather than up to date.

## Environment

The hub's variables are [Environment](../../../../docs/reference/environment.md#hub)'s. The path
variables exist for a test and a portable install; none is read from a document, so no file can steer
where Start looks or writes.

Start refuses a manifest that needs a newer contract than the build implements, and names the contract it
asked for.
