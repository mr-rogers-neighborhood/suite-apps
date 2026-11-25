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

`.github/workflows/ocr-review.yml` runs the official OCR Action on same-repo pull requests. It is
**advisory**: it is not in the `ci` aggregator and does not run on the merge queue, `main`, nightly,
`platforms` or the release workflow. The approval, the fresh gate and the merge queue remain the
gates.

- Trigger: `pull_request` to `main`, excluding drafts and docs-only changes. A fork PR has no secret
  and is skipped.
- Secret: `DEEPRELAY_API_KEY` (repository secret, Settings → Secrets and variables → Actions).
- Budget: `effort: low`, 200000 total tokens, concurrency 4, 10-minute subtask timeout.
- `checkpoint_range` reviews only the commits since the previous run; `sticky_summary` and
  `incremental` keep the comments in place.
- Pinned twice: the Action by full SHA and `ocr_version` in the workflow. The Action installs the CLI
  at run time, so the SHA alone does not freeze behavior.

`release.yml` adds an `ocr-review-<channel>` job before `approval`:

- It runs only when `publish` is true, reviews `last channel tag..HEAD`, and uses `effort: medium`
  with a 400000 token budget.
- It has `contents: read` and the model secret only, never the `release` environment or the signing
  keys. It uploads `release.json` as the `ocr-release-<channel>-<run_id>` workflow artifact.
- `continue-on-error` makes it advisory: a DeepRelay outage never blocks a signed release. The
  approver reads the artifact; the gate and the approval remain the decision.
- `preview` and `stable` are the boundaries that use it. `nightly` may run it through
  `workflow_call`, but its boundary question is answered by the gate, install and launch, not by a
  code review.
