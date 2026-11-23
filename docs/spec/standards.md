# Engineering standards

This page is the boundary between the product/pack contract and how this tree is built. The
[specification](superapp.md) says what a host, pack, relay or catalogue must do. This page says how
code in this repository is written and checked; app `AGENTS.md` files own their local detail.

## The short version

- Run the owning gate: `mise exec -- node scripts/gate.mjs --only <app>`. The root gate is
  `mise exec -- node scripts/gate.mjs`; `--fresh` proves a commit. `docs/reference/commands.md` owns
  the commands.
- Formatting and linting are per repo. Biome and Vitest versions are intentionally not hoisted; use
  the version in the owning `package.json`.
- TypeScript is strict. A package that is pure stays pure (no Electron, Node or DOM in `@suite/pack`).
- Tests live beside the code. A conformance test carries `// spec: S4.2`; the fixture's `clause` field
  is the other form.
- Conventional commits. A change that alters behavior, ownership or a document shape updates the
  owning page and the ledger in the same change.
- A review-only agent may comment or request changes; it never merges. The coordinator runs the
  owning gate and the VM gate.

## What does not belong in the spec

Formatter, linter, TypeScript strictness, file naming, test runner, coverage threshold, mocking
policy, commit convention, PR template, logging format, CI provider, and per-app backup filenames.
Those change without changing the host–pack contract.

## What does belong in the spec

Observable behavior at a host/pack/relay boundary, security and privacy invariants, manifest and
document formats, lifecycle and consent, refusal semantics, conformance profiles and required tests,
and export/import guarantees. If a rule can be broken by a conforming implementation on another
platform, it is a spec rule; if it is about this repository's tooling, it is a standard.
