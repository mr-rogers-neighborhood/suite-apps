---
audience: developer
---

# Agent skills

Agent skills are the repository's authored procedures for coding agents: short playbooks that load
only when a task matches them. They are not always-on rules and not a documentation mirror. This
page owns the convention; the skills themselves live in `.agents/skills/`.

## What belongs where

| Content | Home |
| --- | --- |
| An invariant that applies to every change | the owning `AGENTS.md` |
| Stable narrative, rationale, or a fact to look up | `docs/` |
| A deterministic check that must pass | `scripts/`, run by the gate |
| A procedure that applies only to some tasks | a skill |
| A live external tool with state | an MCP server |

The test is whether the content should be in context every turn. If yes, it is not a skill. A skill
that restates `AGENTS.md`, a gate script, or a docs page has two homes for one fact and will drift.

## Placement

- User-level, cross-project: `~/.agents/skills/<name>/SKILL.md`.
- Repository: `.agents/skills/<name>/SKILL.md`, committed.
- `.opencode/skills` is a symlink to `.agents/skills` so OpenCode and Command Code read one copy.

`.commandcode/skills/` also works, but this repository uses the `.agents/` convention for both
agents. Do not keep a second copy under `.opencode/` or `.commandcode/`.

## Authoring

- The directory name matches `name`: lowercase letters, numbers, hyphens.
- `description` says **what it does and when to use it**, with the words a person would actually
  say (verify, release, review, document layer). Keep it under ~500 characters. It is the only part
  loaded before the skill is invoked, so it is the trigger.
- Keep `SKILL.md` under 500 lines; aim for under 150. Move depth to `references/` and link it from
  the body. Put executable helpers in `scripts/` and tell the agent to run them, not read them.
- State the command, the refusal, and the reporting rule. Prefer "run X, expect Y, stop on Z" over
  prose about why.
- Link the owning page instead of restating a fact. `docs/reference/commands.md` owns commands;
  `docs/reference/decisions.md` owns rules; each app's `AGENTS.md` owns its local gate.
- Use `disable-model-invocation: true` for side-effecting workflows (publish, release, fix). Use
  `user-invocable: false` for background knowledge that is not a command.
- Require an explicit owner instruction before anything signs, publishes, deletes, or rewrites
  history.

## Cost and pruning

Every installed skill's name and description loads on every turn. A catalog of twenty plausible
skills is a recurring tax and a mis-trigger risk: "deploy", "storage", or "security" will match the
wrong playbook before the repository context does.

- Keep the active catalog small. This repository targets roughly fifteen active skills total.
- Before adding one, ask whether the task has failed twice without it.
- Remove or archive a skill that has not been invoked in a month. Archive outside the skills
  directory so it is reversible but not scanned.
- Do not install a broad vendor pack "just in case". Install the one skill the current work needs.

## Evaluate

Triggering is not success. For a new or changed skill:

1. Write two or three realistic prompts.
2. Run each in a fresh session with the skill on and with it off.
3. Compare whether it triggered when it should, and whether the output changed for the better.
4. Check `cmd skills list --debug` for skipped skills and duplicate names, and `/skills` for
   shadowing. A skill that collides with a built-in runs as `/skill:<name>`.

## Security

Install only from a trusted source. Read the bundled scripts and references before use. A skill can
instruct the agent to run commands, so treat it like code: no secrets, no unreviewed install script,
minimal `allowed-tools`, and no instruction to fetch and execute a remote payload.

## Current set

Repository skills:

| Skill | Use |
| --- | --- |
| `suite-gate` | Run and interpret the gate; `--only`, `--fresh`, what a status proves |
| `suite-document-change` | Change a document layer safely |
| `suite-pack` | Change the pack contract or host |
| `suite-release` | Publish a channel (explicit invocation only) |
| `suite-docs` | Author or review module notes and tours |
| `suite-review` | Review a diff with native OCR on DeepRelay, then Suite's invariants |

User-level skills are machine-local and not listed here. The review rules for open-code-review live
in `.opencodereview/rule.json`; the generic delegation skill is
`~/.agents/skills/open-code-review-delegate/`.
