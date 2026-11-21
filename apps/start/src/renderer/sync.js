import { el } from "./format.js";

/**
 * The Sync pane: what this machine is holding, and who is connected to it.
 *
 * The relay is its own program now. This pane tells a person whether Start found it,
 * whether it is running, and where it keeps its store; it does not pretend to be the
 * relay and it does not offer a control that cannot work when the binary is missing.
 */

/** What to say about a way back in, in a person's words. */
const RECOVERY_WORDS = {
  made: "A way back in has been saved for this workspace.",
  declined: "No way back in was saved. Every device would have to be recovered by hand.",
  none: "No way back in has been saved on this machine.",
};

const ROLE_WORDS = {
  owner: "owner",
  editor: "editor",
  viewer: "viewer",
  null: "no role yet",
};

const MISSING_WORDS =
  "Suite Sync is not installed. Install the suite-sync relay and put it on PATH, or set " +
  "SUITE_SYNC_BIN to its path.";

/** The Suite Sync glyph, drawn in the theme's ink like every other pane mark. */
const SYNC_PATHS = [
  "M4 4h4V2H4c-1.1 0-2 .9-2 2v4h2zm0 12H2v4c0 1.1.9 2 2 2h4v-2H4zm16 4h-4v2h4c1.1 0 2-.9 2-2v-4h-2zm0-18h-4v2h4v4h2V4c0-1.1-.9-2-2-2",
  "M9.5 5h-3C5.67 5 5 5.67 5 6.5v3c0 .83.67 1.5 1.5 1.5h3c.83 0 1.5-.67 1.5-1.5v-3c0-.83-.67-1.5-1.5-1.5M9 9H7V7h2zm.5 4h-3c-.83 0-1.5.67-1.5 1.5v3c0 .83.67 1.5 1.5 1.5h3c.83 0 1.5-.67 1.5-1.5v-3c0-.83-.67-1.5-1.5-1.5M9 17H7v-2h2zm5.5-6h3c.83 0 1.5-.67 1.5-1.5v-3c0-.83-.67-1.5-1.5-1.5h-3c-.83 0-1.5.67-1.5 1.5v3c0 .83.67 1.5 1.5 1.5m.5-4h2v2h-2zm-2 6h2v2h-2zm2 2h2v2h-2zm2 2h2v2h-2zm0-4h2v2h-2z",
];

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
  // A consequence, not a restatement of the heading above it.
  head.append(
    el(
      "p",
      "pane-note",
      !sync.installed
        ? "Relay not installed. Sync stays off until Suite Sync is installed."
        : sync.running
          ? "On. Other devices can reach this machine."
          : "Off. Nothing can reach this machine.",
    ),
  );
  panel.append(head);

  panel.append(addressBlock(sync, actions));
  panel.append(scopeBlock(sync, actions));
  panel.append(workspaceBlock(sync));
  panel.append(
    el(
      "p",
      "pane-note",
      "Documents stay encrypted on their way through this machine. It carries them; it cannot read them.",
    ),
  );
}

function addressBlock(sync, actions) {
  const block = el("div", "switch-block");
  block.append(el("h3", null, "This machine\u2019s address"));

  if (!sync.installed) {
    block.append(el("p", "pane-note", MISSING_WORDS));
    if (sync.problem) block.append(el("p", "pane-note", sync.problem));
    block.append(storeNote(sync));
    return block;
  }

  const value = el("code", null, sync.address ?? "not listening");
  value.id = "sync-address";

  const toggle = el("button", "button", sync.running ? "Turn sync off" : "Turn sync on");
  toggle.type = "button";
  toggle.id = "sync-toggle";
  toggle.addEventListener("click", async () => {
    toggle.disabled = true;
    await (sync.running ? actions.stopSync() : actions.startSync());
  });

  block.append(value, toggle);
  if (sync.problem) block.append(el("p", "pane-note", sync.problem));
  if (sync.fingerprint) {
    block.append(
      el(
        "p",
        "pane-note",
        sync.scope === "network"
          ? "Other devices pin this certificate. It stays the same until the pair is replaced."
          : "Other devices pin this certificate when you let them through the network switch.",
      ),
    );
    const fingerprint = el("code", null, sync.fingerprint);
    fingerprint.id = "sync-fingerprint";
    block.append(fingerprint);
  }
  if (sync.consoleUrl) {
    const consoleButton = el("button", "button", "Open the relay console");
    consoleButton.type = "button";
    consoleButton.id = "sync-console";
    consoleButton.addEventListener("click", async () => {
      consoleButton.disabled = true;
      await actions.openSyncConsole();
      consoleButton.disabled = false;
    });
    block.append(consoleButton);
    block.append(
      el(
        "p",
        "pane-note",
        "The console opens in your browser, on this machine only, with a token the relay printed when it started.",
      ),
    );
  }
  if (sync.qr) block.append(qrBlock(sync.qr));
  block.append(storeNote(sync));
  return block;
}

/**
 * Draw the relay code the main process made.
 *
 * A canvas rather than an `<img>` or injected SVG: the renderer already owns its
 * DOM, the matrix is the only thing that crosses, and no markup from main is
 * parsed as HTML.
 */
function qrBlock(qr) {
  const block = el("div", "sync-qr");
  block.append(
    el(
      "p",
      "pane-note",
      "A phone can scan this relay. It carries the address and the certificate fingerprint, so a scanning client pins the same relay this machine does.",
    ),
  );

  const quiet = 4;
  const scale = 4;
  const dimension = qr.size + quiet * 2;
  const canvas = document.createElement("canvas");
  canvas.width = dimension * scale;
  canvas.height = dimension * scale;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Suite relay code");
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#000000";
    qr.rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x += 1) {
        if (row[x] !== "1") continue;
        context.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
      }
    });
  }
  block.append(canvas);
  return block;
}

function storeNote(sync) {
  return el("p", "pane-note", `The relay keeps its frames in ${sync.store}.`);
}

function scopeBlock(sync, actions) {
  const block = el("div", "switch-block");
  block.append(el("h3", null, "Who can reach it"));

  if (!sync.installed) {
    block.append(el("p", "pane-note", "Available once Suite Sync is installed."));
    return block;
  }

  const label = el("label", "switch");
  const box = el("input");
  box.type = "checkbox";
  box.id = "sync-scope";
  box.checked = sync.scope === "network";
  box.addEventListener("change", async () => {
    box.disabled = true;
    await actions.setSyncScope(box.checked ? "network" : "loopback");
  });

  label.append(box, el("span", null, "Other devices on this network"));
  block.append(label);
  block.append(
    el(
      "p",
      "pane-note",
      sync.scope === "network"
        ? "Listening on every interface. Any device that can reach this port can join, and can write frames and membership. Roles are not verified here."
        : "Listening on this machine only. A device elsewhere needs the network switch, or a tunnel you already trust.",
    ),
  );
  return block;
}

function workspaceBlock(sync) {
  const block = el("div", "switch-block");
  block.append(el("h3", null, "Workspaces"));

  if (!sync.installed) {
    block.append(el("p", "pane-note", "Install Suite Sync to see what this machine is carrying."));
    return block;
  }
  if (!sync.running) {
    block.append(el("p", "pane-note", "Turn sync on to see what this machine is carrying."));
    return block;
  }
  if (sync.workspaces.length === 0) {
    block.append(
      el(
        "p",
        "pane-note",
        "Nothing yet. A workspace appears here the first time a device joins it.",
      ),
    );
    return block;
  }

  const list = el("ul", "sync-workspaces");
  for (const workspace of sync.workspaces) {
    const item = el("li");
    item.append(el("code", null, shortId(workspace.workspaceId)));
    item.append(
      el(
        "p",
        "pane-note",
        workspace.frames === 0
          ? "Nothing has changed here yet."
          : `${workspace.frames} ${workspace.frames === 1 ? "change" : "changes"} passed through.`,
      ),
    );

    item.append(el("p", "pane-note", RECOVERY_WORDS[workspace.recovery ?? "none"]));

    const members = el("ul", "sync-members");
    for (const member of workspace.members) {
      members.append(el("li", null, `${member.name} · ${ROLE_WORDS[String(member.role)]}`));
    }
    if (workspace.members.length === 0) members.append(el("li", null, "no devices yet"));
    item.append(members);
    list.append(item);
  }
  block.append(list);
  return block;
}

/** An id is 64 hex characters; six are enough to tell two apart on screen. */
function shortId(id) {
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}
