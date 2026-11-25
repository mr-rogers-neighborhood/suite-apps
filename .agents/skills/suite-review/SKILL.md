---
name: suite-review
description: Review a Suite diff. Use before opening a pull request, when asked to review a branch or PR, or when checking whether a change is safe. Runs Open Code Review natively on DeepRelay's DeepSeek model with a fixed token budget, then applies Suite's invariants.
argument-hint: "[--from <ref>] [--to <ref>] [-c <commit>] [--workspace] [--effort low|medium|high]"
---

# Review a Suite diff

Review-only. Comment or request changes; never merge, and do not fix unless the owner asks for
"review and fix". This complements the gate; it does not replace it.

## Default: native OCR on DeepRelay

Run the wrapper. It previews for free, enforces the budget, runs OCR's native pipeline, writes
JSON under `.dev/ocr/`, and prints a severity summary:

```sh
node .agents/skills/suite-review/scripts/review.mjs --from main          # branch vs main
node .agents/skills/suite-review/scripts/review.mjs --workspace          # uncommitted
node .agents/skills/suite-review/scripts/review.mjs --commit <sha>
node .agents/skills/suite-review/scripts/review.mjs --from main --effort medium --budget 400000
node .agents/skills/suite-review/scripts/review.mjs --workspace --print-preview   # free, no LLM
```

Provider: `deeprelay` at `https://api.deeprelay.ai/v1`, model `deeprelay/deepseek-v4.1-flash`
(1M context, tool calls). The key is read at runtime by `api_key_cmd`; it is not in this repo or in
the OCR config file. Verify the path with `ocr llm test`; it must print
`Source: provider:deeprelay` and `✓ Tool-call round trip verified`.

## Token budget

The wrapper defaults are deliberate; do not raise them without a reason.

| Knob | Default | Note |
|---|---|---|
| `--effort low` | 1 review round | `medium` is 2 rounds, roughly double |
| `--max-tokens-budget` | 200000 | total input+output; one final round may exceed it |
| `--max-tokens` | 120000 | prompt ceiling per subtask |
| `--concurrency` | 4 | default 8 bursts the provider |
| `--timeout` | 10 min | per-subtask |
| `--analysis` | off | extra investigation pass; only on request |
| `ocr scan` | never | whole-repo audit, not a pre-PR check |
| preview | always first | zero LLM tokens |

Escalate to `--effort medium --budget 400000` for a pre-PR or a risky change. `high` only when the
owner asks. Never retry a quota or auth failure in a loop; that is how a budget disappears.

Markdown, skills, and docs are not in OCR's extension allowlist. Read those directly; do not add a
broad `include` rule, which would pull every page into the review.

## Fallback: delegation (host model)

Use only when `ocr llm test` or the native review fails on quota, credit, auth, or provider. It
spends this agent's model and tokens instead of DeepRelay's.

```sh
EXCLUDES='apps/start/**,.dev/**,.artifacts/**,node_modules/**,dist/**,.opencode/**,.agents/**,.commandcode/**'
ocr delegate preview --format json --exclude "$EXCLUDES" --from main
ocr delegate rule --from main --format json <path> [<path> ...]
git --no-pager diff --no-ext-diff --no-textconv --no-color <merge_base>..<to> -- "<path>"
```

Cover every previewed file: reviewed, or skipped with a reason. Report coverage. Do not silently
fall back after a partial native run; say which mode produced the findings.

Command Code and Antigravity have no compatible endpoint for OCR native mode; delegation is their
only path. OpenCode Go can become a second provider once its key is readable outside Orca's store.

## Report

Comment fields: `path`, `content`, optional `start_line`, `end_line`, `category`
(`bug|security|performance|maintainability|test|style|documentation|other`), `severity`
(`critical|high|medium|low`). Group by severity, critical/high first. Discard likely false
positives silently. Report a material behaviour change even when it is intentional. State the mode,
model, files reviewed, and tokens used.

## Suite add-ons

The generic rules cannot know these; check them after OCR's pass:

- Document truth is not in Zustand, React state, or `localStorage`; no raw Loro outside the
  document package; schema changes are additive and migrated; one observe site.
- Renderer stays sandboxed: `contextIsolation`, `sandbox`, no `nodeIntegration`; no Node or `fs` in
  a renderer.
- Host boundary: a pack capability is checked per call by the resolved sender; no absolute path or
  unparsed document bytes cross to a pack; the host never parses a document.
- Local-first: no account, telemetry, hosted dependency, or network client where the app forbids it
  (Budget has none; Go's container never parses a document).
- No secret, key, or token in the tree or in a generated `.dev/` directory.
- Release changes follow `docs/reference/decisions.md`: tags do not move, published releases are
  immutable, release secrets stay in the environment.
- Docs that own a changed fact are updated in the same change.

Read `docs/reference/decisions.md` and the owning app's `AGENTS.md` when a finding depends on a rule;
link the rule rather than restating it. [Code review](../../../docs/reference/code-review.md)
owns the provider and budget details.
