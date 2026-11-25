# `@suite/pack-runtime`

The pack-side types for the Suite host.

This package is deliberately type-only. It describes the services a pack may see, without
implementing any host policy:

- `files` — scoped files inside the pack root, plus user-consented external file handles.
- `documents` — the simple id-and-bytes store.
- `storage` — small namespaced key-value values.
- `relay` — opaque sealed frames over a host-pinned socket.
- `commands` — command contributions and invocation.
- `notifications`, `theme`, `lifecycle`, and the launch context.

`PackHost` in `src/services.ts` is the target shape of `window.suite`, not what the desktop host
implements today. The v1 host (`apps/desk`) implements `documents`, `files`, and the small
`info`/`setTitle`/`openExternal` surface; `openExternal` itself requires the `network` capability.
The other services are refused at discovery: a manifest that declares `storage`, `relay`,
`notifications` or `commands` is not loaded, and external file handles are not built. Treat these
interfaces as the contract to grow into, not as a promise about the current build.

A pack imports the types; it never imports Electron, Node or a host implementation.
