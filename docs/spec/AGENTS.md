# Spec lane

This folder is an explicit exception to "docs describe the tree as it is." `superapp.md` is a
normative target; [ledger.md](ledger.md) is the evidence of what exists. Do not "fix" the spec to
match the code, and do not mark a clause implemented without a test or a named gap.

## Reading order

1. [README.md](README.md) — one page of orientation.
2. [superapp.md](superapp.md) — the clause you are touching, not the whole file. Clause IDs are
   `S<major>.<minor>` (`S4.2`).
3. [ledger.md](ledger.md) — the status and evidence for that clause.
4. [manifest.schema.json](manifest.schema.json) and [fixtures.json](fixtures.json) for a manifest
   change.
5. The owning app's `AGENTS.md` and gate for implementation.

## Rules

- A clause ID is stable. Never renumber or reuse one. If a rule is withdrawn, leave the ID in the
  ledger as `withdrawn` and explain why.
- A `MUST` needs an owner, an enforcement point and a test. If it has none, it belongs in
  `docs/reference/ideas.md` or §17, not in §§1–16.
- A test that covers a clause carries `// spec: S4.2`. The fixture's `clause` field is the other form.
- The schema is the machine-readable half. Add a field and a valid/invalid fixture together.
- Do not copy a rule into another page. Link the clause ID.
- Keep the normative file one file. It is deliberately small enough to read in one sitting; split only
  if it passes ~700 lines or one profile dominates.
- Engineering style, naming, test layout and gate commands live in [standards.md](standards.md).
  Governance, licensing and disclosure live in [governance.md](governance.md).

## Do not load for a spec task

`.generated/`, `apps/help/public/data`, changelogs, every app's full docs, or the whole help index.
Load the clause and the owning file.

## Checks

```sh
mise exec -- pnpm spec:check
mise exec -- node scripts/docs-check.mjs
mise exec -- pnpm docs:index:check
```
