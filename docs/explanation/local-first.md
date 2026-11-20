# Local-first

Local-first software treats the copy on your device as the primary copy. Servers may exist, but they
hold secondary copies that help with access from other devices. The term and its seven ideals come
from Ink & Switch's 2019 essay, [Local-first software: you own your data, in spite of the
cloud](https://www.inkandswitch.com/essay/local-first/).

The seven ideals are a useful yardstick because they separate claims that are often bundled together.
Suite meets some fully, some partially, and the difference is recorded here rather than implied by a
slogan.

| Ideal | Where Suite stands |
| --- | --- |
| **1. No spinners** | Met. Documents are local CRDTs; an edit does not wait for a server. |
| **2. Not trapped on one device** | Partial. Canvas syncs through a server the user runs. Planner and Budget have no sync transport yet. |
| **3. The network is optional** | Met. The apps open and edit offline. Budget has no network client at all. |
| **4. Seamless collaboration** | Partial. Canvas has live presence and collaborative editing. Collaboration is a foreground session; a sleeping device is not woken. |
| **5. The Long Now** | Met in shape. Files are plain and exportable, the licence is MIT, and the project operates no service that can be shut down. Schema upgrades between app versions are not yet guaranteed. |
| **6. Security and privacy by default** | Partial. There is no account, no telemetry and no project-operated server. Document files are not encrypted, and the current sync room is plaintext without TLS. |
| **7. Ownership and control** | Met. A document is a file the user owns and can copy, back up or export. Apps install and uninstall without an account. |

## What "partial" means in practice

The limits are deliberate and recorded, not marketing gaps:

- **Sync is one app deep.** The protocol and server exist, and two Canvas clients can converge through
  them. Planner and Budget still open one file on one machine. See [Status](../reference/status.md).
- **No background delivery.** A sleeping device is not woken. See
  `apps/go/docs/reference/decisions.md`.
- **The sync room is not the shipped security model.** It is plaintext and loopback-only while the
  transport is being proven. The target is a blind relay that stores ciphertext it cannot read. See
  `apps/sync/docs/reference/decisions.md`.
- **Files rely on disk encryption.** A `.canvas`, `.planner` or `.budget` file is readable by anyone
  who has it. The apps do not add a passphrase.
- **Longevity is a property of the format, not a promise about migrations.** Each file carries a
  format and schema version. Opening a newer file in an older app is not supported.

The product rule that follows: when a feature would make a document depend on a service, the
explanation has to say so. A local-first claim that is only true in the demo is not a claim the docs
may make.

## Reading

- [Status](../reference/status.md) for the subsystem-by-subsystem picture.
- [The mini-app model](mini-app-model.md) for the host model and what it borrows from MiniApps.
- [Architecture](architecture.md) for where documents live and which process may write them.
