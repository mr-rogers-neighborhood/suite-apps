# Decisions

The rules that shape Go.

- The container never reads a document. It carries bytes and a name; `.canvas`, `.planner` and
  `.budget` belong to their apps.
- The container never learns a domain. It routes on what a module declares. There is no
  `if (module.id === "planner")` in the shell.
- A pack declares its capabilities; the host enforces them.
- Isolation is a document boundary, not a browser origin. Capacitor serves every pack from one origin.
- Each pack carries its own React and Loro. There is no shared runtime.
- A module registers once per mount and disposes on leave. `disposeAll` survives a module that throws.
- Sync is an event, not a background service. The seam is designed; no transport ships.
- Waking a sleeping device is reserved, not built. Collaboration is a session.
- A reference is data. A schema bump is a migration.
- One app hosts the three domains, with the domain boundaries as hard as they are on the desktop.
