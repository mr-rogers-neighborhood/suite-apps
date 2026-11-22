# `@suite/pack-runtime`

The pack-side types for the Suite host.

This package is deliberately type-only. It describes what `window.suite` is, without implementing any host policy:

- `files` — scoped files inside the pack root, plus user-consented external file handles.
- `documents` — the simple id-and-bytes store.
- `storage` — small namespaced key-value values.
- `relay` — opaque sealed frames over a host-pinned socket.
- `commands` — command contributions and invocation.
- `notifications`, `theme`, `lifecycle`, and the launch context.

The host implements these interfaces. A pack imports the types; it never imports Electron, Node or a host implementation.

The live host object is `window.suite`; its shape is `PackHost` in `src/services.ts`.
