/**
 * The gate's app order, shared with affected selection.
 *
 * One list owns both "what a full gate runs" and "how a changed app maps to a
 * row", so a new app cannot join the gate and be invisible to CI. `e2e` marks
 * the rows whose browser/desktop suite the gate can run; `desktop` marks the
 * Electron apps that produce a Playwright Proof of Changes block.
 *
 * spec: C4.2
 */
export const PIPELINE = [
  { repo: "sync", package: "@suite/sync-server" },
  // The host. It depends on the shared Electron policy and theme, not on any app.
  { repo: "desk", package: "@suite/desk", desktop: true },
  { repo: "help", package: "@suite/help", desktop: true },
  { repo: "canvas", package: "@suite/canvas", desktop: true },
  { repo: "planner", package: "@suite/planner", desktop: true },
  { repo: "budget", package: "@suite/budget", desktop: true },
  { repo: "go", package: "@suite/go-app" },
];
