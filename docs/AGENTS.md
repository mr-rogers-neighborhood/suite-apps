# Docs

This lane owns the cross-app pages in `docs/` and the Help reader in `apps/help`. An app's own
`docs/` stays with that app's lane until its pull request merges.

- A docs change lands with the code that changes the fact, in the same change.
- One fact has one home. Fix the owning page and link from the rest; never copy a paragraph.
- Never restate a version; link to `package.json` or the changelog. `RELEASES.md` is generated.
- The owner's planning page, `docs/reference/ideas.md`, is the owner-approved exception, not a new reference fact.
- Run `mise exec -- node scripts/docs-check.mjs` and `pnpm docs:index:check` before a pull request.
- Do not run `docs:dev` here: the check is headless, and a docs server steals focus.
