# What Suite is

Suite is a host that installs and runs local-first apps as packs, and sync you run yourself.

- **Canvas** is for visual thinking and research: cards, boards, writing and links in one document.
- **Planner** is a daily planner: inbox, estimates, capacity and a local calendar.
- **Budget** is an envelope budget: accounts, register, month grid and backups.
- **Start** installs, updates, opens and removes the apps. It never holds a document.
- **Sync** is the protocol and the server a person runs on a device they control.
- **Go** is the mobile container. Its home surface hosts a reference module and a Canvas placeholder,
  and a domain arrives as an installed pack; [Planner's state](../../apps/go/docs/reference/planner.md)
  records where the first one stands.

Each app owns one domain and one document. The suite shares manifests, packages, a gate and a release
process; it does not share a process or a database.

Documents are files under `~/Documents/Suite/<App>`. There is no account, no telemetry and no server
operated by the project. [Local-first](local-first.md) records which ideals are met and which are
partial; [Architecture](architecture.md) describes the boundaries.
