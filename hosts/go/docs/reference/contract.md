# The module contract

What a domain may do, what the container guarantees, and the two rules that keep the container from
becoming the monolith it exists to avoid.

`@suite/go` lives in `packages/go`. It is pure types and pure functions: no I/O, no React at runtime,
no dependency on any domain.

## One declaration, one mount

```ts
interface SuiteGoModule {
  readonly id: string; // lower kebab-case, same rule as a suite app id
  readonly name: string; // shown on a tile
  readonly icon: string; // an icon key the shell resolves; never a URL
  readonly capabilities: readonly SuiteGoCapability[]; // "capture" | "documents"
  readonly accepts: readonly CaptureKind[]; // "text" | "url" | "file"
  register(host: ModuleHost): SuiteGoModuleRegistration;
}
```

The declaration is what the container routes on. `register` runs only when a person opens the module,
and returns:

```ts
interface SuiteGoModuleRegistration {
  readonly view: ComponentType<{ host: ModuleHost }>;
  readonly capture?: CaptureHandler; // required when the module claims "capture"
  dispose(): void | Promise<void>; // must release listeners, timers and handles
}
```

### Why `accepts` is declared rather than discovered

Asking a module "could you take this link?" by mounting it would mean the container cannot route a
share until every domain has loaded — which is the laziness the whole design is for. So matching
happens on the declaration, and only the winner is mounted.

`resolveCapture` therefore has three answers, and the third is not an error:

| Answer              | Meaning                              | Who decides                            |
| ------------------- | ------------------------------------ | -------------------------------------- |
| `ok`                | Exactly one module claimed this kind | The container routes                   |
| `no-capable-module` | Nothing claimed it                   | The container says so, naming the kind |
| `ambiguous`         | More than one claimed it             | **The person**, from the candidates    |

Silently preferring the first registered module is how a share to the wrong domain becomes a bug
nobody can reproduce.

## What the host provides, and what it refuses to

`ModuleHost` gives a mounted module these services:

| Service         | Shape                                                                                     | The refusal                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `documents`     | list, create, open, save, remove                                                          | Never returns a parsed document. Bytes, a name, a title, a timestamp                                      |
| `files`         | list, stat, mkdir, read, write, rename, remove, backup, lock; pickOpen, exportFile, share | Relative paths only, inside the pack's own root; a link, a device, an absolute path or a climb is refused |
| `storage`       | get, set, delete, keys                                                                    | Already namespaced per module, so one module cannot read another's key                                    |
| `navigation`    | `setTitle`, `close`                                                                       | Not a general stack: leaving a module returns to home, always                                             |
| `theme`         | scheme, density, CSS variables                                                            | Names no colour and no spacing value                                                                      |
| `notifications` | permission, request, schedule, cancel                                                     | Carries a title and a time, stores nothing, and restarts nothing                                          |
| `sync`          | **Reserved, not implemented.** status, enable, disable, invite, join, sealed frames       | A future host moves sealed frames and readable membership only; keys and the document stay in the pack    |

`sync` is a reserved row, not a shipped service. No Go build implements it, no pack can call it
through `ModuleHost` today, and it is not a claim that sync works on mobile. It is named here so the
boundary can be reviewed before an implementation exists; [the sync capability](../../../../services/relay/docs/reference/sync-capability.md)
states the operations, states and failure shape a future host would have to honour.

Two consequences follow from the document refusal, and both are load-bearing:

1. **A recents entry's title comes from the module**, supplied when it saves. A base64 Loro snapshot has
   no human name in it, and a container that learned to read one would have learned a domain.
2. **The container cannot tell a `.planner` from a `.budget`**, which is exactly why adding the second
   domain will not require touching it.

### One ordering rule, and it is not the container's

`save` and `remove` take an id, and the only ids that exist are the ones `create` or `open` returned. So a
module's real sequence is `create|open → save*`, and it is the **module's** obligation, not a state machine
the host keeps. The host holds no session: any request may arrive at any time, and each is answered on its
own.

Two things make that safe rather than sloppy:

- **The bridge serialises requests** through one chain, in order, so a `save` cannot overtake the `create`
  it depends on. A module that issues them without awaiting still behaves correctly.
- **A request that is never answered is rejected** after ten seconds, not left hanging. That matters more
  than it sounds: because the chain is serial, one unanswered request used to stall every later one —
  including a debounced save — and a reply is dropped whenever the frame's window is already gone.

The sync protocol has a full session type of its own, with projections and the epoch rule stated once, in
[suite-sync's protocol note](../../../../services/relay/docs/protocol-sessions.md).

### Files belong to one pack

A pack's own files live under one host-owned root per `(publisher, pack)`, in the app's private
data directory. The pack sees relative, slash-separated paths; it never sees a root, and no request
carries one. The frame bridge resolves the sender's frame to the manifest the shell mounted it with,
so a message cannot name another pack's store.

The rule is shared with the desktop: `@suite/pack-host/files/core` owns the path check, the error
vocabulary, the in-process lock table and the byte cap. The desktop's `PackFileStore` is Node-backed
and cannot be bundled into a WebView, so Go enforces the same rules over Capacitor's Filesystem
plugin. Both refuse:

| Attempt                                          | Answer                                      |
| ------------------------------------------------ | ------------------------------------------- |
| `../other/secret.txt`, `/etc/passwd`, `a\b`      | `invalid path (invalid-path)`               |
| a symlink, a device, or any non-regular entry    | `path is not a regular file (symlink)`      |
| a second lock on a path this frame already holds | `file is locked (locked)`                   |
| a file larger than the shared cap                | `file is too large (too-large)`             |
| a write whose `expectedMtimeMs` is stale         | `file changed since it was read (conflict)` |
| another pack's file, by its own relative name    | `file not found (not-found)`                |

Writes are atomic by default: the bytes go to a temporary sibling and are renamed into place, so a
kill mid-write leaves the previous file intact. `backup` copies to a dated sibling and returns the
relative path; `lock` is one writer per path in this process, released by the frame's teardown.

The picker and the share sheet are the person-consented half of the same capability: `pickOpen`
returns bytes and a name, `exportFile` writes into the app's documents, and `share` hands the file to
Android. None of them hands a path to the pack, and a phone has no "reveal in folder" to offer.

## Registration is checked, loudly

`createModuleRegistry` refuses a declaration rather than accepting a broken one:

| Rejection                 | Cause                                               |
| ------------------------- | --------------------------------------------------- |
| `invalid-id`              | Not lower kebab-case, or longer than 32 characters  |
| `duplicate-id`            | Two modules claiming the same id                    |
| `capture-without-accepts` | Claims `capture` but can never be chosen            |
| `accepts-without-capture` | Accepts kinds the container would never route to it |

The id rule is deliberately identical to `suiteAppIdSchema` in `@suite/contracts`, so a suite app id is
always a legal module id. That is why `isSuiteGoModuleId("notes-")` is `true`: the suite's pattern
permits a trailing hyphen, and being stricter here would break the promise that an id can carry over.

## Teardown survives a bad module

`disposeAll` releases every mounted module and keeps going when one throws. A domain with a bug in its
`dispose` must not be able to keep the container from releasing the others — that would turn one bad
module into a leak across the whole app. The report names what was disposed and what failed.

## The two rules, as tests

- _Never read a document_: `DocumentStore` has no member that returns anything but bytes and metadata.
- _Never learn a domain_: `packages/go` contains no domain name. If a change needs one, it belongs in
  that domain's module instead.
