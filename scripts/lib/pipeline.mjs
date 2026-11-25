/**
 * The gate's project order, shared with affected selection.
 *
 * One list owns both "what a full gate runs" and "how a changed project maps to
 * a row", so a new project cannot join the gate and be invisible to CI. `dir` is the
 * workspace project's directory; `repo` stays the short name every command and
 * workflow uses. `pack` is the pack build package a frozen app also runs;
 * `e2e` marks the rows whose browser/desktop suite the gate can run; `desktop`
 * marks the Electron apps that produce a Playwright Proof of Changes block.
 *
 * spec: C4.2
 */
export const PIPELINE = [
  // The shared component base is not an app, but it owns a check the gate must run: its
  // stories are the accessibility contract, and they only prove anything when axe fails them.
  { repo: "ui", package: "@suite/ui", dir: "packages/ui" },
  { repo: "sync", package: "@suite/sync-server", dir: "services/relay" },
  // The host. It depends on the shared Electron policy and theme, not on any app.
  { repo: "desk", package: "@suite/desk", dir: "hosts/desk", desktop: true },
  {
    repo: "help",
    package: "@suite/help",
    pack: "@suite/help-pack",
    dir: "legacy/help",
    desktop: true,
  },
  {
    repo: "canvas",
    package: "@suite/canvas",
    pack: "@suite/canvas-pack",
    dir: "legacy/canvas",
    desktop: true,
  },
  {
    repo: "planner",
    package: "@suite/planner",
    pack: "@suite/planner-pack",
    dir: "legacy/planner",
    desktop: true,
  },
  {
    repo: "budget",
    package: "@suite/budget",
    pack: "@suite/budget-pack",
    dir: "legacy/budget",
    desktop: true,
  },
  { repo: "go", package: "@suite/go-app", dir: "hosts/go" },
];
