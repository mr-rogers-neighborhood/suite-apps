# The mini-app model

Suite's host model — one container that opens packaged apps — follows the W3C MiniApp model that
WeChat popularised. The standard describes the model directly; a product documents whatever it
happened to ship.

The source reading is in the [archive](../archive/research/README.md).

## What the standard defines

The [W3C MiniApp Standardization White Paper](https://www.w3.org/TR/mini-app-white-paper/) describes a
mobile application format that is packaged rather than installed, and hosted by a super app or an
operating system. Four mechanisms matter here:

- **A packaged app.** A MiniApp is a ZIP archive with a configuration document at the root, page
  scripts and styles, media, and optional signature. Nothing is fetched on launch after the first
  download.
- **A manifest.** The MiniApp manifest extends the Web App Manifest with `app_id`, `version`,
  `platform_version`, `device_type`, `pages`, `req_permissions`, `widgets`, `color_scheme` and
  `window`. `req_permissions` is the capability declaration.
- **A logic/view split.** The view layer renders; the logic layer runs in a JavaScript worker. The
  paper's own summary is that "the rendering can be considered stateless, and all the states will be
  stored in the worker."
- **Single-instance, multi-entry.** One instance per app, reachable from a store, a search result, a
  QR code, a message or the host's own surfaces, with its state kept across entries.

WeChat adds product behaviour around that model: a host capsule that always offers a way out, a
mini-app header the app may take over without breaking host controls, a lifecycle that distinguishes
*suspended* from *destroyed*, and a three-tier capability model (platform review, per-scope user
authorisation, and domain allowlisting at the bridge). Some of those are WeChat policy rather than
standard.

## What Suite borrows

| Mechanism | In Suite |
| --- | --- |
| Host plus downloaded apps | Suite Start on the desktop; Suite Go on mobile |
| A manifest beside the executable | `suite.app.json` for desktop discovery; a pack manifest for Go |
| Declared capabilities | Pack `capabilities`, enforced by the host; see [Go decisions](../../apps/go/docs/reference/decisions.md) |
| One instance per app | Start installs one copy per app; a second copy cannot run because the profile lock is shared |
| Addressable app entry | `suite://<app>/workspace/<file name>` routing through Start |
| A document boundary | The container never reads a document; `.canvas`, `.planner` and `.budget` belong to their apps |

## Where Suite differs

- **No platform review tier.** A hosted catalogue and human review cannot exist without operating a
  platform, which the product does not do. Declared capabilities are enforced by the host; the
  user-authorisation tier is still missing.
- **No hosted identity.** There is no account and no social graph. Collaboration is scoped to a
  document, not to a contact list.
- **No shared runtime.** Each Loro-using pack carries its own React and Loro. A host-side document
  engine would force a second copy of the document, or a round trip per keystroke, because the editor
  binds to the DOM.
- **No per-pack origin on mobile.** The Go container serves packs from one origin, so isolation is a
  document boundary rather than a browser origin boundary.
- **Suspend and destroy are not separated yet.** Leaving a module disposes it. WeChat keeps a
  suspended module mounted and releases it later.
- **No background delivery.** A sleeping device is not woken.

## Reading

- [What Suite is](why-suite-exists.md) for the product overview.
- [Architecture](architecture.md) for how the host and the apps relate today.
- [Archive](../archive/research/README.md) for the sources and open questions.
