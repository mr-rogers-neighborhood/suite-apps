# Security

Suite Go is the mobile host. It installs a signed pack from the catalogue and renders it inside its
own window; it holds no document parser and proxies no document bytes. The surface is the host
itself:

- A pack is verified before it is installed and its files are re-verified on load. A changed file is
  a refusal, not a running module.
- A manifest is data. It declares capabilities, documents and contributions, and the host refuses a
  capability it does not implement rather than skipping it.
- A deep link arrives from another app and is untrusted. The parser refuses credentials, a port, a
  fragment, an encoded `..`, control characters and a pack it does not know.
- Modules receive a document handle; the container does not know the format and never reads one.

## Reporting a vulnerability

Use GitHub's private security advisory for
[mrrnbhd/suite-apps](https://github.com/mrrnbhd/suite-apps/security/advisories/new).
Do not open a public issue for a vulnerability. Include the version, the platform, and the smallest
reproduction you can.
