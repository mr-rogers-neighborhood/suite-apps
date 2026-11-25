# `@suite/pack-runtime`

The pack-side view of the Suite host, and the runtime every pack shares.

The package has two halves:

- **Services.** `PackHost` in `src/services.ts` describes the host a pack sees: `files` (scoped files
  plus user-consented external handles), `documents` (the id-and-bytes store), `storage`, `relay`,
  `commands`, `notifications`, `theme`, `lifecycle` and the launch context. These are types only.
- **Bridge.** `src/bridge.ts` owns the half every pack adapter repeated: the save debounce, the
  boundary flush, the write serialization and failure policy, notices, the shared sentences, the
  picker/import/export handle lifecycle, and disposal. A pack supplies only its app hooks: how to
  snapshot its document, its file codec, and anything app-specific such as a projection or an
  attachment store. It is exported as `@suite/pack-runtime/bridge` and from the package root.

`createPackBridge` is parameterized by app hooks rather than by a second host. It is not a second
copy of an app: Canvas keeps its `.canvas` envelope and attachment store, Planner keeps its
`WorkspaceDocument` and reminder projection, and Budget keeps its library and snapshot policy.

`src/testing/fakeHost.ts` is the one in-memory host the three pack suites share. It is exported as
`@suite/pack-runtime/testing` and from the package root so a pack's `test/fakeHost.ts` can re-export
it instead of keeping a fourth copy.

`PackHost` is the target shape of `window.suite`, not what the desktop host implements today. The
v1 host (`hosts/desk`) implements `documents`, `files`, and the small `info`/`setTitle`/`openExternal`
surface; `openExternal` itself requires the `network` capability. The other services are refused at
discovery: a manifest that declares `storage`, `relay`, `notifications` or `commands` is not loaded,
and external file handles are not built. Treat these interfaces as the contract to grow into, not as
a promise about the current build.

A pack imports the types and the bridge; it never imports Electron, Node or a host implementation.
The bridge touches the DOM only through the page's own `visibilitychange` and `pagehide` events when
a host asks for those boundaries.
