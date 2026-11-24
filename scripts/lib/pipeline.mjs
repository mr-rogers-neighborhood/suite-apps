/**
 * The gate's app order, shared with affected selection.
 *
 * One list owns both "what a full gate runs" and "how a changed app maps to a
 * row", so a new app cannot join the gate and be invisible to CI. `e2e` marks
 * the rows whose browser/desktop suite the gate can run.
 *
 * spec: C4.2
 */
export const PIPELINE = [
  { repo: "sync", package: "@suite/sync-server" },
  // The host. It depends on the shared Electron policy and theme, not on any app.
  { repo: "shell", package: "@suite/shell" },
  { repo: "help", package: "@suite/help" },
  { repo: "canvas", package: "@suite/canvas" },
  { repo: "planner", package: "@suite/planner" },
  { repo: "budget", package: "@suite/budget" },
  { repo: "go", package: "@suite/go-app" },
];
