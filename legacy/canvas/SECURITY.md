# Security policy

## Reporting a vulnerability

Open a private security advisory on the repository ("Security" → "Advisories" → "Report a
vulnerability"), or email the maintainer listed on the repository profile. Do not open a public issue
for anything that would let someone else read, write or destroy a workspace they were not given a
link to.

Include what you did, what happened and what you expected. A proof of concept against your own
instance is ideal; do not test against an instance you do not own.

There is no bug bounty. Acknowledgement within a few days, then a fix or an explanation as soon as the
maintainer can, is the commitment.

## Access model

Canvas ships one document in one file, and sync when the owner turns it on for that workspace.

A workspace is a `.canvas` file: a JSON envelope around a base64 Loro snapshot. Anyone who has the
file can read the workspace, so file permissions, disk encryption and where the file is kept are the
access control. The shell writes atomically, keeps a backup beside it, and refuses to replace a file it
could not parse.

Sync is opt-in and off by default. The device that turns it on creates the workspace's group; another
device joins with an invite that names a role, and a member's device adds it to the group. Group keys
live in the main process, never in the page, and document updates travel sealed. The host that carries
them stores frames it cannot read, plus signed records that name a device and a role. Removing a device
revokes it and moves the group to a new epoch, so the removed copy cannot read anything new.

There is no account layer and no hosted build. The account, billing and collab services this page once
described are not in the tree, and no sign-in path is reachable. A share is an invite into the
workspace a device runs, or a file, so there is no share token to mint or authenticate.
[Decisions](docs/reference/decisions.md#sharing) is the record of what replaced them.

## In scope

- An IPC message the shell accepts from a page it did not load, or a renderer reaching a capability
  the preload does not expose.
- A frame or an invite a device can use after it was removed, or a device reading an epoch it has left.
- A group key that leaves the main process, or a recovery file that opens without the passphrase set
  on it.
- Path traversal or arbitrary file write through an attachment, a recovery file or a store path.
- Signature or key-handling mistakes in a frame, an invite or a membership record.
- Cross-site scripting through card content, attachment types or the handbook renderer.
- A document truncated or replaced when a write fails, or a backup lost on the way.

## Known and accepted for Beta

- No encryption at rest. A `.canvas` file is readable by anyone who has it.
- TLS is pinned, not authority-issued. A reachable host serves `wss://` with a self-signed certificate,
  and the app pins its SHA-256 fingerprint; a different certificate is refused with no plaintext
  fallback. The host still sees device ids, roles and timing even though it cannot read the document.
- The host keeps a retention window of sealed frames. A device away longer asks a peer for a snapshot,
  because the host cannot hand out a document it cannot read.
- Roles belong to devices, not people: no per-person attribution and no audit log.
- Sync is opt-in, so a workspace with it off sends nothing.

## Deployment expectations

Canvas has no hosted deployment. The file, the machine and, when sync is on, the host you run are the
whole surface. TLS, disk encryption and backups belong to the person running it.
[Security model](docs/reference/security-model.md) covers the renderer, the binary and the file.

## Supported versions

Beta releases are tagged `v0.2.0-beta.N`. Only the newest tag gets fixes; an older beta is expected to
be replaced, not patched.
