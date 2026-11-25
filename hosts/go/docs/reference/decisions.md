# Decisions

The rules that shape Go.

- The container never reads a document. It carries bytes and a name; `.canvas`, `.planner` and
  `.budget` belong to their apps.
- The container never learns a domain. It routes on what a module declares. There is no
  `if (module.id === "planner")` in the shell.
- A pack declares its capabilities; the host enforces them. A capability Go does not serve is a
  refusal at install and at load, named in the sentence, not a pack that half-works.
- The catalogue is the desktop's operator-signed index, verified by the shared `@suite/pack`
  verifier against a pinned operator key. Go does not have a second catalogue format or a second
  install source.
- Isolation is a document boundary, not a browser origin. Capacitor serves every pack from one origin.
- A pack's files are host-owned, one root per `(publisher, pack)`, with relative paths only. The rules
  are the desktop's, imported from `@suite/pack-host/files/core`; the WebView enforces them over
  Capacitor's Filesystem plugin because the Node-backed `PackFileStore` cannot be bundled. The frame
  bridge maps the frame to its own manifest, and no request carries a root.
- Each pack carries its own React and Loro. There is no shared runtime.
- A module registers once per mount and disposes on leave. `disposeAll` survives a module that throws.
- Sync is an event, not a background service. The seam is designed; no transport ships.
- Waking a sleeping device is reserved, not built. Collaboration is a session.
- A reference is data. A schema bump is a migration.
- One app hosts the three domains, with the domain boundaries as hard as they are on the desktop.
