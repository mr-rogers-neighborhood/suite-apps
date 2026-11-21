/**
 * The window.
 *
 * It draws what main sends and asks main for everything else. There is no network client
 * here, no relay client and no camera: the code is drawn from rows main computed, and the
 * only thing this page can do to a link is hand it back to be copied.
 *
 * The reach selector is drawn from `view.options`, including which option needs a confirmation.
 * That flag is main's decision, so a page that skipped the confirmation would still be refused.
 */

const bridge = window.suiteSync;

const statusNode = document.getElementById("status");
const addressNode = document.getElementById("address");
const copyLinkButton = document.getElementById("copy-link");
const fingerprintNode = document.getElementById("fingerprint");
const copyFingerprintButton = document.getElementById("copy-fingerprint");
const canvas = document.getElementById("qr");
const codeSection = document.querySelector(".code");
const codeNote = document.getElementById("code-note");
const toggleButton = document.getElementById("toggle");
const consoleButton = document.getElementById("console");
const autostartBox = document.getElementById("autostart");
const problemNode = document.getElementById("problem");
const storeNode = document.getElementById("store");
const scopesNode = document.getElementById("scopes");
const scopeNote = document.getElementById("scope-note");
const scopeConfirm = document.getElementById("scope-confirm");
const scopeWarning = document.getElementById("scope-warning");
const scopeCancel = document.getElementById("scope-cancel");
const scopeContinue = document.getElementById("scope-continue");

/** The last view drawn, so cancelling a confirmation can put the radios back. */
let current = null;
/** The scope waiting for confirmation, if a confirmation is open. */
let pending = null;
/** True while a scope change is restarting the relay. */
let busy = false;

/** A copy button says it copied, then says what it does again. */
function acknowledge(button, text) {
  const original = button.dataset.label ?? button.textContent;
  button.dataset.label = original;
  button.textContent = text;
  window.setTimeout(() => {
    button.textContent = original;
  }, 1_500);
}

async function copyWithFeedback(button, action) {
  const copied = await action();
  acknowledge(button, copied === true ? "Copied" : "Nothing to copy");
}

function drawCode(code) {
  const context = canvas.getContext("2d");
  if (context === null) return;
  // A whole multiple of the module count keeps the code crisp; the quiet zone is four
  // modules, which is the margin a scanner expects.
  const border = 4;
  const modules = code.size + border * 2;
  const scale = Math.max(1, Math.floor(canvas.width / modules));
  const dimension = modules * scale;
  const offset = Math.floor((canvas.width - dimension) / 2);

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#0b0d12";
  for (let row = 0; row < code.size; row += 1) {
    const line = code.rows[row] ?? "";
    for (let column = 0; column < code.size; column += 1) {
      if (line[column] !== "1") continue;
      context.fillRect(
        offset + (column + border) * scale,
        offset + (row + border) * scale,
        scale,
        scale,
      );
    }
  }
}

/** Put the radios back on the scope in force, which is what cancelling a confirmation does. */
function restoreRadios() {
  if (current === null) return;
  for (const input of scopesNode.querySelectorAll("input")) {
    input.checked = input.value === current.scope;
  }
}

function closeConfirmation() {
  pending = null;
  scopeConfirm.hidden = true;
  restoreRadios();
}

function renderScopes(view) {
  scopesNode.replaceChildren();
  for (const option of view.options) {
    const label = document.createElement("label");
    label.className = option.warning ? "scope warning" : "scope";

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "scope";
    input.value = option.id;
    input.checked = option.id === view.scope;
    input.disabled = busy || view.scopeLocked || !option.available;
    input.addEventListener("change", () => chooseScope(option));

    const text = document.createElement("span");
    text.className = "scope-text";
    const name = document.createElement("span");
    name.className = "scope-name";
    name.textContent = option.label;
    const sentence = document.createElement("span");
    sentence.className = "scope-sentence";
    sentence.textContent = option.sentence;
    text.append(name, sentence);

    if (option.detail !== null) {
      const detail = document.createElement("span");
      detail.className = "scope-detail";
      detail.textContent = option.detail;
      text.append(detail);
    }

    label.append(input, text);
    scopesNode.append(label);
  }
}

async function applyScope(scope, acknowledged) {
  busy = true;
  for (const input of scopesNode.querySelectorAll("input")) input.disabled = true;
  let next = null;
  try {
    // Main stops the relay, stores the choice and starts it on the new bind before it answers.
    next = await bridge.setScope(scope, acknowledged);
  } finally {
    busy = false;
  }
  // Draw with `busy` already false, or the rebuilt radios would stay disabled.
  if (next) render(next);
}

function chooseScope(option) {
  if (option.needsConfirmation) {
    // The warning is on screen before anything changes; the change itself waits for Continue.
    pending = option.id;
    scopeWarning.textContent = `${option.sentence} A device that can reach the port can claim an empty mailbox whose id it knows; a workspace that already has an owner needs an invitation. Choose this only on a network you trust.`;
    scopeConfirm.hidden = false;
    restoreRadios();
    scopeContinue.focus();
    return;
  }
  void applyScope(option.id, false);
}

function render(view) {
  current = view;
  const running = view.running === true;
  const sentence = view.options.find((option) => option.id === view.effective)?.sentence ?? "";
  statusNode.textContent = running
    ? `Running. ${sentence}`
    : "Stopped. Nothing can reach this machine.";
  statusNode.classList.toggle("warning", running && view.effective === "network");

  addressNode.textContent = view.address ?? "Not listening";
  copyLinkButton.disabled = view.link === null;

  fingerprintNode.textContent = view.fingerprint ?? "No certificate yet";
  copyFingerprintButton.disabled = view.fingerprint === null;

  toggleButton.textContent = running ? "Stop relay" : "Start relay";
  consoleButton.disabled = view.consoleUrl === null;

  autostartBox.checked = view.autostart === true;

  renderScopes(view);
  if (view.scopeLocked) {
    scopeNote.hidden = false;
    scopeNote.textContent =
      "The address is set by SUITE_SYNC_BIND, so the reach cannot be changed here.";
  } else {
    scopeNote.hidden = true;
    scopeNote.textContent = "";
  }
  if (pending !== null && view.scope === pending) {
    // The change landed (another window, or a retry): the confirmation has nothing left to do.
    closeConfirmation();
  }

  const empty = view.code === null;
  codeSection.classList.toggle("empty", empty);
  if (!empty) drawCode(view.code);
  codeNote.textContent = empty
    ? "The code appears while the relay is running."
    : "The code carries this relay's address and certificate pin. A phone or another " +
      "computer scans it to meet the relay.";

  problemNode.hidden = typeof view.problem !== "string";
  problemNode.textContent = typeof view.problem === "string" ? view.problem : "";

  storeNode.textContent = `Store: ${view.store} · Suite Sync ${view.version}`;
}

toggleButton.addEventListener("click", async () => {
  toggleButton.disabled = true;
  try {
    const next =
      toggleButton.textContent === "Stop relay" ? await bridge.stop() : await bridge.start();
    if (next) render(next);
  } finally {
    toggleButton.disabled = false;
  }
});

copyLinkButton.addEventListener("click", () => copyWithFeedback(copyLinkButton, bridge.copyLink));
copyFingerprintButton.addEventListener("click", () =>
  copyWithFeedback(copyFingerprintButton, bridge.copyFingerprint),
);

consoleButton.addEventListener("click", () => {
  void bridge.openConsole();
});

autostartBox.addEventListener("change", async () => {
  const next = await bridge.setAutostart(autostartBox.checked);
  if (next) render(next);
});

scopeCancel.addEventListener("click", () => closeConfirmation());

scopeContinue.addEventListener("click", async () => {
  const scope = pending;
  if (scope === null) return;
  scopeConfirm.hidden = true;
  pending = null;
  await applyScope(scope, true);
});

bridge.onChanged(render);
void bridge.state().then((view) => {
  if (view) render(view);
});
