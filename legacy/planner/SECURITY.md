# Suite Planner security

Suite Planner is a local desktop app. It makes no network calls, holds no account, and sends no
telemetry. The reporting channel and supported state are in the root
[security policy](../../SECURITY.md); the threat model is mostly about the file and the machine:

- A `.planner` file is JSON containing a base64 Loro snapshot. It is not encrypted. Anyone with the file
  can read the plan; use OS disk encryption and protect the file like a calendar.
- The renderer is sandboxed (`contextIsolation`, `sandbox`, no `nodeIntegration`), served from
  `app://planner` rather than `file://`, and every IPC channel checks the sender.
- The packaged binary sets the Electron fuses: no `runAsNode`, no `NODE_OPTIONS`, no CLI inspect
  arguments, ASAR integrity on, and app code loadable only from the ASAR.
- The app never overwrites a damaged workspace. It tries the backup, then keeps a copy and refuses to
  replace the live file.

## Reporting a vulnerability

Report privately through the root [security policy](../../SECURITY.md). Do not open a public issue
for a damaged plan file or an IPC channel that accepts a page it did not load.
