/**
 * The window.
 *
 * It draws what main sends and asks main for everything else. There is no network client
 * here, no relay client and no camera: the code is drawn from rows main computed, and the
 * only thing this page can do to a link is hand it back to be copied.
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

function render(view) {
  const running = view.running === true;
  statusNode.textContent = running
    ? "Running. Other devices on this network can reach it."
    : "Stopped. Nothing can reach this machine.";

  addressNode.textContent = view.address ?? "Not listening";
  copyLinkButton.disabled = view.link === null;

  fingerprintNode.textContent = view.fingerprint ?? "No certificate yet";
  copyFingerprintButton.disabled = view.fingerprint === null;

  toggleButton.textContent = running ? "Stop relay" : "Start relay";
  consoleButton.disabled = view.consoleUrl === null;

  autostartBox.checked = view.autostart === true;

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

bridge.onChanged(render);
void bridge.state().then((view) => {
  if (view) render(view);
});
