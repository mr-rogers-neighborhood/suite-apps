# Code review

Open Code Review (`ocr`) is the default review engine. It runs **native** OCR — deterministic file
selection, semantic bundling, rule resolution, line-level comments, coverage and resume — against
DeepRelay's `deepseek-v4.1-flash`. The review is not the gate and never merges a change.

## Setup

`ocr` and Git >= 2.41 are required. The `ocr` CLI is installed globally; the repository does not add
it to `package.json` and does not run it in the gate.

The provider config is machine-local at `~/.opencodereview/config.json`:

| Key | Value |
| --- | --- |
| `provider` | `deeprelay` |
| `custom_providers.deeprelay.url` | `https://api.deeprelay.ai/v1` |
| `custom_providers.deeprelay.protocol` | `openai` |
| `custom_providers.deeprelay.model` | `deeprelay/deepseek-v4.1-flash` |
| `custom_providers.deeprelay.api_key_cmd` | reads the 0600 key file at runtime |
| `effort` | `low` |
| `max_tokens` | `120000` |

The key is never stored in the repository or in the OCR config. `api_key_cmd` reads
`~/.config/deeprelay/opencode-key`, the credential OpenCode already uses. Verify with:

```sh
ocr llm test
```

It must print `Source: provider:deeprelay`, the URL, the model, and
`✓ Tool-call round trip verified`. A failure here stops the review; check `deeprelay quota -o json`
and the credit balance rather than retrying.

## Run a review

The wrapper lives beside the skill and previews for free before spending:

```sh
node .agents/skills/suite-review/scripts/review.mjs --from main
node .agents/skills/suite-review/scripts/review.mjs --workspace
node .agents/skills/suite-review/scripts/review.mjs --commit <sha>
node .agents/skills/suite-review/scripts/review.mjs --workspace --print-preview
```

Rules and excludes live in `.opencodereview/rule.json`. Project rules apply per path and merge with
the built-in language rules; `exclude` keeps generated and agent paths out of the diff. Inspect a
resolution with:

```sh
ocr rules check apps/shell/src/main.ts
```

## Token budget

| Knob | Default | Why |
| --- | --- | --- |
| `--effort` | `low` | one review round instead of two |
| `--max-tokens-budget` | 200000 | total input+output for the run; one final round may exceed it |
| `--max-tokens` | 120000 | prompt ceiling per subtask |
| `--concurrency` | 4 | avoids bursting the provider |
| `--timeout` | 10 min | per-subtask deadline |
| `--analysis` | off | extra investigation pass |
| `ocr scan` | not used | whole-repo audit, not a pre-PR check |

Use `--effort medium --budget 400000` for a pre-PR or a risky change; `high` only when asked.
A quota or auth failure is reported once and is never retried in a loop.

## Fallback

1. **Native OCR on DeepRelay** — default.
2. **Delegation mode** — `ocr delegate preview` and `ocr delegate rule`, with this agent reviewing
   the diffs. Uses the host agent's model and tokens. Use it when DeepRelay quota, credit, auth, or
   provider is unavailable.
3. No review — report the failure; do not claim a review happened.

Command Code and Antigravity have no OpenAI- or Anthropic-compatible endpoint for native mode;
delegation is their path. OpenCode Go can be added as a second provider once its key is readable
outside Orca's encrypted store.

## Output and privacy

- JSON results: `.dev/ocr/<timestamp>.json` (gitignored).
- OCR sessions and the viewer: `~/.opencodereview/sessions/`; `ocr viewer` serves them locally.
- Both contain source excerpts. Do not publish either.
- Markdown, skills, and docs are outside OCR's extension allowlist; review those by reading them.

## CI

OCR runs at the three channel boundaries, **not on pull requests**. The review-only agent and the
gate own PR review. Fewer runs are what make a high-effort review affordable: frequency is the main
cost control, not the token cap. The shared workflow is `.github/workflows/ocr-boundary.yml`.

- `nightly.yml` calls it after a green gate when `NIGHTLY_PUBLISH` is not `true`.
- `release.yml` calls it before `approval` when `publish` is true, for `preview`, `stable`, and a
  publishing `nightly`.
- `continue-on-error` at the caller makes it advisory: a DeepRelay outage never blocks a release.
  The gate, approval and merge queue remain the decisions.
- Effort `high` (three review rounds), 3,000,000 total token cap, 200,000 prompt ceiling. The cap is
  a ceiling, not a target; OCR's file selection, bundling, plan-skip and prompt caching keep a run
  proportional to the diff.
- Range: the channel's last version tag. A non-publishing nightly creates no tag, so it uses the
  commit 24 hours before `HEAD`. If that tag is `HEAD`, or there is no base, the job skips.
- Secret: `DEEPRELAY_API_KEY` (repository secret). No PR-triggered workflow uses it, so the secret is
  never exposed to a head-branch workflow.
- Output: `review.json` as the `ocr-<channel>-<run_id>` workflow artifact.
- Manual test or spot check: dispatch `ocr-boundary.yml` with `channel`, `effort`, `budget`, and an
  optional `from` ref.
- Local pre-PR review stays available: `node .agents/skills/suite-review/scripts/review.mjs --from main`.
