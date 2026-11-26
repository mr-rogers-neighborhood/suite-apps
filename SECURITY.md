# Security policy

## Supported state

Suite is pre-1.0: Suite Desk is alpha and Suite Go is v0. There is no long-term support window; the
newest published build, and the branch it was cut from, is what gets fixes. An older build is
expected to be replaced, not patched.

A pack is signed data, and the host treats it as untrusted even after verification. The host checks
the manifest signature and every listed file hash against the pinned key before a pack is installed
and run; the pack's renderer gets no Node, no `nodeIntegration` and its own session. An unsigned
directory pack requires `SUITE_DESK_DEV_PACKS=1` in an unpackaged checkout; a packaged build ignores
the switch.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose
**Report a vulnerability**, or use
[the private advisory form](https://github.com/mrrnbhd/suite-apps/security/advisories/new). The
advisory is visible to the maintainers, not the public. Do not open a public issue with a working
exploit.

Include the build and platform, what you did, what happened, and what you expected, with the
smallest reproduction you can. A proof of concept against your own instance is ideal; do not test
against an instance you do not own.

There is no bug bounty. We aim to acknowledge a report within three working days, and publish a fix,
mitigation or advisory when one exists. GitHub's form is the only private channel today; once mail
on the project domain is live, an email address will replace the form and this page will name it.

## Scope: the host is the boundary, a pack is untrusted

The host is the trust boundary. The main process maps a sender's `webContents` to a pack and scopes
every document call by that mapping; a pack id in a request is ignored. A pack declares capabilities
and the host refuses one it does not implement, denies permissions wholesale, and keeps documents and
files as scoped bytes inside the pack's own roots.

- A pack that exceeds its declared capabilities, reads another pack's documents or files, reaches
  another origin, survives a failed verification, or reaches the network without `network` is a
  vulnerability.
- A pack that does what its declared capabilities allow is the capability model working, not a
  break.

## Where the detail lives

This page owns the reporting channel and the supported state. The threat models are per surface:

| Surface | Owner |
| --- | --- |
| Desktop host: pack isolation, files, network, install | [hosts/desk/SECURITY.md](hosts/desk/SECURITY.md) |
| Relay: ciphertext, membership, transport, accepted risk | [services/relay/SECURITY.md](services/relay/SECURITY.md) |
| Canvas: file access model, known and accepted | [legacy/canvas/SECURITY.md](legacy/canvas/SECURITY.md) |

Go, Planner and Budget keep their app-specific facts in [hosts/go/SECURITY.md](hosts/go/SECURITY.md),
[legacy/planner/SECURITY.md](legacy/planner/SECURITY.md) and
[legacy/budget/SECURITY.md](legacy/budget/SECURITY.md).

## Out of scope

- A pack doing what its declared capabilities allow.
- A compromised host, or a Chromium escape. Pack isolation is capability-level inside one OS
  sandbox, not a separate OS sandbox per pack; a compromised host can read everything it brokers.
- A local actor who can already write the data directory, including a symlink race between a check
  and a read. A pack cannot create a symlink, so that actor is outside the boundary.
- A build you modified, a debug-signed artifact, or an unsigned development pack.
- Traffic dropping against a relay you run; the relay's page records it as accepted.

## Coordinated disclosure

Report privately and leave the details out of public issues until a fix, mitigation or advisory
exists. A host advisory is a release note, never a silent update. A pack advisory follows the
revocation rule in [Governance](docs/spec/governance.md): it blocks new installs and leaves the
person to disable or remove what is already installed.
