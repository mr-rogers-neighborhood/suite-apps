# Research: is anyone else building this, and what did they get wrong?

A survey of the prior art behind "local-first super-app", prompted by an outside summary of eight projects
and four libraries that claimed to be directly relevant to this stack. Marks per [README.md](README.md).

The summary was useful and partly wrong, which is the most informative thing about it. Everything below was
checked against a primary source — the project's own README, its npm metadata, or the specification — and
the two claims that did not survive are recorded rather than dropped.

**Not a decision.** Nothing here pre-empts an ADR. §5 says what each finding _would_ touch.

## What was under test

Two claims, one about novelty and one about fit:

1. **"The prior art lives in three overlapping niches, and none of them is called local-first super-app."**
2. **"Loro + Electron + Capacitor is well-suited for this."**

The first is **Documented, and true**: the three niches are real, and the projects are in them. The second
is **Unverified** as stated — it is a judgement, not a fact — but the survey surfaced one place where the
stack's fit is worse than assumed (§4.2) and one where a design we deferred is cheaper than we thought
(§5.1).

## Method

For each project: read the repository's own README through `gh repo view`, or the specification page, or
`npm view` for a library. No claim below rests on a summary of a summary. Where a claim could not be
checked, it says **Unverified** and what was tried.

---

## 1. Local-first mini-app specifications

| Project                                                                                                  | What it actually is                                                                                                                                                                                                                                                                                                                                                                                | Mark                                                                                                 |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **WebXDC** (Delta Chat)                                                                                  | A specification with three parts: the `.xdc` container (a zip with a manifest and an icon), a **minimal stable JavaScript API**, and how messengers run mini apps in isolated web views. Mini apps are "network-isolated but can share state via `sendUpdate()` and `setUpdateListener()`".                                                                                                        | **Documented** — [spec](https://webxdc.org/docs/spec/), [api](https://webxdc.org/docs/spec/api.html) |
| **local-first-auth / Antler**                                                                            | A real library (`local-first-auth`) providing WeChat-style identity: a `did:key` profile, a signed JWT the app passes with requests, and a `window.localFirstAuth` global when running inside the Antler browser. Explicitly _"highly inspired by how WeChat works"_ and aimed at people physically together — meetups, game nights, installations.                                                | **Documented** — [README](https://github.com/antler-browser/local-first-auth)                        |
| **OpenYoghurt**                                                                                          | An Electron desktop platform for local data-analysis mini apps. Mini apps are folders with an `index.html`, run in **sandboxed iframes via a custom `miniapp://` protocol**, with the iframe sandbox enforcing `connect-src 'none'` so _"app code physically cannot make outbound requests"_. Mini apps declare MCP-style tools in `manifest.json` which a host-level Claude agent calls over IPC. | **Documented** — [README](https://github.com/SinishaDjukic/openyoghurt)                              |
| **"Slop"** — _"every mini-app and its local SQLite database live together as one portable `.slop` file"_ | **This project could not be found.** `longtail-labs/hitSlop-canvas`, the repository the summary's name points at, is an **image-generation playground built on React Flow** — unrelated to desktop environments, mini apps, or SQLite.                                                                                                                                                             | **Wrong** — [README](https://github.com/longtail-labs/hitSlop-canvas)                                |

### 1.1 The WebXDC rule we break

The WebXDC API is exposed by a `webxdc.js` module that the app references but **must not include**:

> `webxdc.js` must not be added to your `.xdc` file as they are provided by the messenger.

**Documented.** That is a stronger statement than "the host injects a bridge": it makes the bridge
**unversioned by the app and repairable by the host**. A messenger can fix a bug in the API without
republishing every mini app in existence, and a mini app cannot pin a stale shim.

We do the opposite. `createFrameHost` is compiled into every pack through `@suite/go`, so a bridge fix
requires rebuilding and re-signing each pack. `contractVersion` and `minimumHostVersion` in our manifest are
a _negotiation_ ("this pack needs a host at least this new"), not an update path.

### 1.2 The identity claim worth reading carefully

`local-first-auth` is real, and it is **not the same problem as our pairing**. It issues a signed JWT that a
**backend verifies**; the interesting property is that the person never types a password because the
identity travels by QR. There is no key release, no document keys, and no device acting as custodian.

The overlap is the interaction, not the mechanism: _"scan a QR and be signed in"_ is the WeChat affordance we
also want, and their `did:key` is one credible spelling of an identity that needs no account server. Reading
it is worth an hour; adopting it would answer a question we have not asked, because our pairing has to move
**key material**, not prove **who someone is**.

---

## 2. Malleable software, and where it gets hard

Ink & Switch's work is real, and two of the four projects are directly about problems we have.

| Project       | What it actually is                                                                                                                                                                                                                                                                                                                                                                                                                            | Mark                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **PushPin**   | _"A collaborative corkboard app"_ — Electron plus CRDT, multiple card types. The closest shipped-shaped analogue to "several tools over one local-first substrate".                                                                                                                                                                                                                                                                            | **Documented** — [repo](https://github.com/inkandswitch/pushpin)         |
| **Patchwork** | Described by its own repository only as _"Patchwork system"_. The summary's claim that it "explores dynamic, composable environments where small tools plug into shared local-first data" is plausible and **not verified** here.                                                                                                                                                                                                              | **Unverified** — [repo](https://github.com/inkandswitch/patchwork)       |
| **Keyhive**   | A Rust workspace that is **more specific than "capabilities for local-first"**: `beekem` is _"a concurrent TreeKEM variant for continuous group key agreement"_; `keyline` is _"the authority graph: delegation and revocation certificates"_; `keyhive_content` holds _"causal envelopes and ciphertext store"_. Ships a `keyhive_wasm` wrapper. Its own notice: _"DO NOT use this release in production"_, _"has not had a security audit"_. | **Documented** — [README](https://github.com/inkandswitch/keyhive)       |
| **Cambria**   | _"Schema evolution with bi-directional lenses"_ — translating data between schema versions for local-first software.                                                                                                                                                                                                                                                                                                                           | **Documented** — [repo](https://github.com/inkandswitch/cambria-project) |

### 2.1 Keyhive and our role records are the same two-layer split, at different maturity

This is the most useful finding in the survey, because it is a **convergence**: two teams independently
arrived at "group key agreement" plus "a separate authority structure", and they named the second one.

| Layer               | Keyhive                                                                | Us                                                                         |
| ------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Group key agreement | BeeKEM, a concurrent TreeKEM                                           | MLS via `ts-mls`, `MLS_128_DHKEMX25519_…`                                  |
| Authorization       | `keyline` authority graph — delegation and revocation **certificates** | Flat role records: one signed `{deviceId, role, seq, signerId}` per device |
| Content encryption  | causal envelopes + ciphertext store                                    | frames sealed to the MLS group                                             |
| Status              | Pre-alpha, unaudited                                                   | Shipped, tested, in production use by one person                           |

**Documented** (their side) and **Code** (ours — `roleRecord.ts`). The difference that matters is
**delegation**: their authority is a graph, ours is a flat table in which only an owner may write a record.
The practical consequence is that in our model a second owner cannot be delegated a device — the code says so
outright ("Ownership transfer is out of scope until there is a two-owner story").

That is not an argument to adopt a pre-alpha unaudited Rust workspace. It is an argument for not _closing_
the door: `roleRecord` already carries `signerId`, which is the one field a delegation chain would need.

### 2.2 Cambria and a gap we already admit

`docs/ALPHA.md` lists _"Documents carry no upgrade guarantee between app versions."_ Cambria is the research
answer to exactly that, and it is a **lens** library: bidirectional schema translation.

Two facts bound its relevance to us:

- **It is research-grade** — the repository is `cambria-project`, a prototype, not a package with a release
  cadence.
- **Our unit is different.** Cambria translates _operations between versions of a shared document_. Our
  documents are not shared between apps; a `.planner` file is read by one domain. Our version problem is a
  **file** opened by a newer app, which is a migration with one writer, not a lens across two.

**Documented** (the project), **Unverified** (that lenses are the right tool for our case).

---

## 3. Libraries the summary recommended for this stack

| Claim                                                                                                  | Verdict                                                                                                                                                                                                                                                                         | Mark                                                                                        |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `loro-mirror` gives bidirectional sync with strict runtime schema validation                           | Real. `loro-mirror@2.3.3`, _"type-safe state management synchronized with Loro CRDT via a declarative schema and bidirectional mirroring"_, with React and Jotai bindings.                                                                                                      | **Documented** — `npm view` / [repo](https://github.com/loro-dev/loro-mirror)               |
| It is "crucial for ensuring third-party or modular mini-apps don't corrupt shared document structures" | **Overstated.** A schema validates _shape_, not _semantics_: a validator that accepts `{title: string}` cannot tell a good title from a hostile one. And each of our domains already validates every mutation through Zod before committing.                                    | **Documented** (feature) + our own **Code**                                                 |
| `@capawesome/capacitor-electron` exposes `services.bundles` to switch local web bundles at runtime     | Real. `@capawesome/capacitor-electron@0.2.2`; the README states `services.bundles` will _"switch the served web-bundle directory and reload the app windows"_, and that plugin `load()` runs _before the first window loads_ so a repointed bundle takes effect on first paint. | **Documented** — `npm view` / [repo](https://github.com/capawesome-team/capacitor-electron) |
| Module Federation 2.0's `loaded-first` and `errorLoadRemote`                                           | **Unverified.** Not checked. Also not obviously applicable: we ship an HTML page per pack, not a remote module, and `packs.md` already records why shared React was withdrawn.                                                                                                  | **Unverified**                                                                              |
| Loro's WASM binary is "~970 KB gzipped"                                                                | **Wrong for our version.** Measured from our own build: `loro_wasm_bg-…wasm` is **3,596.98 kB raw / 1,214.42 kB gzip**. A signed Planner pack is 1.43 MB.                                                                                                                       | **Measured** — `pnpm --filter @suite/planner-pack build`                                    |

### 3.1 The recommendation that would undo a decision we made on purpose

The summary's headline architectural advice:

> Instead of letting every mini-app bundle its own copy of `loro-crdt`, keep a single `LoroDoc` engine in the
> **Host Shell** and pass state diffs or projections across your iframe/WebView bridge.

This is the W3C worker model, and we rejected it for a reason that is not about size: **`loro-prosemirror`
and Excalidraw need a `LoroDoc` in the same realm as the DOM.** `@tiptap/*` and `@excalidraw/excalidraw` are
direct dependencies of the Canvas app, and `loro-prosemirror` binds a ProseMirror view to a Loro text
container. A host-side engine would force either a document mirror in the view (two CRDT copies, two truths)
or a round trip per keystroke.

The corrected size number (1,214 kB, not 970 kB) makes the trade **more** expensive, not less — which is
exactly why it belongs in the record rather than in a comment. We pay ~1.2 MB gzip per Loro-using pack
because the alternative costs correctness.

A real mitigation the advice does not mention: a pack that does not need Loro does not carry it. `scratch`
ships without it.

---

## 4. Where the survey was wrong, and what that implies

### 4.1 Two claims did not survive

| Claim                                                                                                                                  | Why it is wrong                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| "Slop (`hitslop`): a desktop environment where every mini-app and its SQLite database live together as a single portable `.slop` file" | The named repository is an image-generation playground. There is no such system under that name that this pass could find. |
| "Loro's WASM binary is ~970KB gzipped"                                                                                                 | 1,214 kB gzip in the version we ship. A 25% understatement.                                                                |

Both errors are in the direction of _more_ confidence than the evidence supports, which is the failure mode
this directory's marking rule exists to catch. A future reader should not re-import either.

### 4.2 A footgun the summary raised that we had already found

The "dynamic map keys" warning — concurrent creation of nested containers under the same `LoroMap` key hides
one of them — is **[F1 in the register](findings.md)**, with the mitigation verified across Planner, Budget
and Canvas (`ensureMergeableMap` / `ensureMergeableList`). The summary presents it as an open hazard; for us
it is a documented one with a known gap (no test fails on a plain `set`).

Our architecture also avoids the _cross-app_ form structurally: **one document per domain**, so no two packs
write to the same document at all. The summary's remedy (namespace per mini app, `miniapp:com.example.notes`)
is the correct answer to a question we do not have.

---

## 5. What each finding would touch

Pointers, not proposals.

| Finding                                                          | Would touch                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-pack origins are ordinary Electron work (§1, OpenYoghurt)    | **ADR-0002's amendment over-corrects.** It says per-pack origins are "native work" — true for Capacitor (one `server.hostname`, path-based `UriMatcher`), **false for Electron**, where a custom scheme gives each pack a real origin. The record should distinguish the two platforms |
| The WebXDC shim is host-provided and never in the archive (§1.1) | `docs/reference/packs.md` (why `frameClient` is compiled in), and what `contractVersion` does and does not promise                                                                                                                                                                     |
| Keyhive separates authority (a graph) from key agreement (§2.1)  | `roleRecord.ts`'s flat model; ADR-0008; the invite/join design — specifically whether a second owner is a v1 question                                                                                                                                                                  |
| Cambria is a lens library for shared documents (§2.2)            | `ALPHA.md`'s "no upgrade guarantee" line; any document schema-version policy                                                                                                                                                                                                           |
| `loro-mirror` validates shape, not semantics (§3)                | Nothing today. Recorded so the next reader does not re-open it as a shortcut                                                                                                                                                                                                           |
| `services.bundles` switches a served bundle at runtime (§3)      | The pack loader, if serving an _installed directory_ as an origin ever becomes the goal                                                                                                                                                                                                |
| The wasm is 1,214 kB gzip, not 970 kB (§3)                       | `packs.md`'s measured figures; the "each pack carries its own Loro" trade-off, which should be stated with the real number                                                                                                                                                             |

## 6. What this pass did not establish

| Gap                                                           | Why it is open                                                                                                                                                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Whether Patchwork does what the summary claims**            | Its repository describes itself only as "Patchwork system". Reading the project site would settle it                                                                                                         |
| **Whether a local-first mini-app _standard_ exists anywhere** | WebXDC is a spec for packaging and an API; nothing found specifies host capabilities, documents, or keys. The W3C MiniApps work remains the only standard with a host model, and it assumes a cloud platform |
| **The economics of per-pack wasm at scale**                   | Three packs at ~1.2 MB is 3.6 MB. Ten is 12 MB. Nobody has measured whether that matters on the target phone, because there are not ten packs                                                                |
| **Module Federation**                                         | Not checked, and probably not applicable (§3)                                                                                                                                                                |

## 7. What was deliberately not researched

- **WeChat as a product.** Covered in [wechat-architecture.md](wechat-architecture.md); this pass added
  nothing and needed nothing.
- **Whether to adopt any of these projects.** That is a decision, and this directory does not make them.
- **Our own performance under the pack model.** A measurement task, not a reading task. The one number used
  above is from a build we ran, and it says so.
