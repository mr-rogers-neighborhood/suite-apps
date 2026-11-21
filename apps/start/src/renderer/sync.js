import { el } from "./format.js";

/**
 * The Sync pane: the Suite Sync deployment, and nothing it owns.
 *
 * Suite Sync is a Flatpak like the other apps. Start installs it from the store and
 * opens it; the tray app that starts keeps the relay and shows its own address, relay
 * code and fingerprint. This pane therefore describes a deployment rather than a
 * process, and never repeats a value the app is already showing.
 */

/** The Suite Sync glyph, drawn in the theme's ink like every other pane mark. */
const SYNC_PATHS = [
  "M4 4h4V2H4c-1.1 0-2 .9-2 2v4h2zm0 12H2v4c0 1.1.9 2 2 2h4v-2H4zm16 4h-4v2h4c1.1 0 2-.9 2-2v-4h-2zm0-18h-4v2h4v4h2V4c0-1.1-.9-2-2-2",
  "M9.5 5h-3C5.67 5 5 5.67 5 6.5v3c0 .83.67 1.5 1.5 1.5h3c.83 0 1.5-.67 1.5-1.5v-3c0-.83-.67-1.5-1.5-1.5M9 9H7V7h2zm.5 4h-3c-.83 0-1.5.67-1.5 1.5v3c0 .83.67 1.5 1.5 1.5h3c.83 0 1.5-.67 1.5-1.5v-3c0-.83-.67-1.5-1.5-1.5M9 17H7v-2h2zm5.5-6h3c.83 0 1.5-.67 1.5-1.5v-3c0-.83-.67-1.5-1.5-1.5h-3c-.83 0-1.5.67-1.5 1.5v3c0 .83.67 1.5 1.5 1.5m.5-4h2v2h-2zm-2 6h2v2h-2zm2 2h2v2h-2zm2 2h2v2h-2zm0-4h2v2h-2z",
];

/** What the pane says above everything else, which is a consequence rather than a heading. */
const STATE_WORDS = {
  "not-installed": "Not installed. Start can install Suite Sync from the store.",
  installed: "Installed. Open Suite Sync to run the relay.",
  problem: "Suite Sync is not ready on this machine.",
};

export function renderSync(state, actions) {
  const panel = document.getElementById("panel-sync");
  if (!panel) return;
  const sync = state.sync;
  panel.replaceChildren();

  const head = el("header", "pane-head");
  const mark = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  mark.setAttribute("viewBox", "0 0 24 24");
  mark.setAttribute("aria-hidden", "true");
  mark.setAttribute("class", "pane-mark");
  for (const d of SYNC_PATHS) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("d", d);
    mark.append(path);
  }
  const title = el("div", "pane-title");
  title.append(mark, el("h2", null, "Sync"));
  head.append(title);
  head.append(el("p", "pane-note", STATE_WORDS[sync.state] ?? STATE_WORDS.problem));
  panel.append(head);

  panel.append(deploymentBlock(sync, actions));

  panel.append(
    el(
      "p",
      "pane-note",
      "Suite Sync keeps the relay in its own process. It shows the address, relay code " +
        "and fingerprint; Start neither reads frames nor holds the relay's keys.",
    ),
  );
}

function deploymentBlock(sync, actions) {
  const block = el("div", "switch-block");
  block.append(el("h3", null, "The deployment"));

  if (sync.state === "installed") {
    block.append(versionLine(sync));
    const open = el("button", "button primary", "Open Suite Sync");
    open.type = "button";
    open.id = "sync-open";
    open.addEventListener("click", async () => {
      open.disabled = true;
      try {
        await actions.openSync();
      } finally {
        open.disabled = false;
      }
    });
    block.append(open);
    block.append(
      el(
        "p",
        "pane-note",
        "Flatpak owns this deployment. Start installs and opens it; it never writes " +
          "into the app's files or manages the relay for it.",
      ),
    );
    if (sync.problem) block.append(el("p", "pane-note", sync.problem));
    return block;
  }

  if (sync.state === "not-installed") {
    block.append(
      el(
        "p",
        "pane-note",
        "Suite Sync is not installed. It is a Flatpak from the same store as the apps; " +
          "install it once and open it whenever this machine should carry relay traffic.",
      ),
    );
    const install = el("button", "button primary", "Install Suite Sync");
    install.type = "button";
    install.id = "sync-install";
    install.addEventListener("click", async () => {
      install.disabled = true;
      try {
        await actions.installSync();
      } finally {
        install.disabled = false;
      }
    });
    block.append(install);
    return block;
  }

  // A problem carries the sentence that explains it. There is no dead control to press.
  block.append(
    el(
      "p",
      "pane-note",
      sync.problem ?? "Suite Sync cannot be installed or opened from this machine.",
    ),
  );
  return block;
}

/** The version and commit Flatpak reports, said as the deployment's own facts. */
function versionLine(sync) {
  const line = el("p", "card-meta");
  if (sync.version === null) {
    line.append("Version not reported");
  } else {
    const version = el("code", null, sync.version);
    version.id = "sync-version";
    line.append("Version ", version);
  }
  if (sync.commit !== null) {
    const commit = el("code", null, `${sync.commit.slice(0, 12)}\u2026`);
    commit.id = "sync-commit";
    commit.title = sync.commit;
    line.append(" \u00b7 commit ", commit);
  }
  return line;
}
