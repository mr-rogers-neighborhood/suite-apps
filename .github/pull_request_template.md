## What and why

<!-- What changes, and the problem it solves. -->

## Scope

- App or package:
- Not touched:

## Checks

<!-- The exact commands you ran, and what they printed. A claim without a command is not evidence. -->

```sh

```

## Risk

<!-- What could break, who is affected, and how to undo it. -->

## Docs

- [ ] The page that owns this fact is updated, or the change does not affect one.
- [ ] No version is restated outside its `package.json`.

## Local-first and security

- [ ] No account, telemetry or hosted dependency is added.
- [ ] Data still lives in a file the person owns.
- [ ] The renderer stays sandboxed (`contextIsolation`, `sandbox`, no `nodeIntegration`).
- [ ] No secret, key or private path is committed.

## Review

The `ci` workflow (once enabled) and the owning gate are the evidence. A review worker may comment
or request changes but never merges; the coordinator runs the gate and the merge queue.
