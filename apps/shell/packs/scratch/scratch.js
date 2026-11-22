// window.suite is the host preload bridge; it is absent outside the host.
const api = window.suite;

const DOC_NAME = "scratch.txt";

const packIdEl = document.getElementById("pack-id");
const metaEl = document.getElementById("doc-meta");
const editorEl = document.getElementById("editor");
const saveBtn = document.getElementById("save");
const clearBtn = document.getElementById("clear");
const statusEl = document.getElementById("status");

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Metadata of the open document, or null.
let doc = null;

function setStatus(message, tone = "info") {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
}

function formatBytes(size) {
  return size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`;
}

function formatDate(time) {
  return new Date(time).toLocaleString();
}

function updateMeta() {
  if (!doc) return;
  const parts = [doc.name, formatBytes(doc.size), formatDate(doc.updatedAt)];
  metaEl.textContent = parts.join(" · ");
}

function setEditorEnabled(enabled) {
  editorEl.disabled = !enabled;
  saveBtn.disabled = !enabled;
  clearBtn.disabled = !enabled;
}

async function load() {
  if (!api) {
    packIdEl.textContent = "unavailable";
    setStatus("window.suite is missing — open this pack inside the host.", "bad");
    return;
  }

  packIdEl.textContent = api.packId;

  const docs = await api.documents.list();
  let target = docs.find((item) => item.name === DOC_NAME);
  let created = false;

  if (!target) {
    try {
      target = await api.documents.create(DOC_NAME);
      created = true;
    } catch (error) {
      // A second Scratch tab may have won the create race. Re-list before
      // treating the failure as fatal.
      const after = await api.documents.list();
      target = after.find((item) => item.name === DOC_NAME);
      if (!target) throw error;
    }
  }

  const opened = await api.documents.open(target.id);
  if (!opened) throw new Error("host returned no document.");

  doc = opened;
  // The host stores opaque bytes; this pack treats them as UTF-8 text.
  editorEl.value = decoder.decode(opened.bytes);
  setEditorEnabled(true);
  updateMeta();
  if (created) {
    setStatus(`Created ${DOC_NAME} for this pack.`, "ok");
  } else {
    setStatus("Ready.");
  }
}

async function save() {
  if (!doc) return;

  const bytes = encoder.encode(editorEl.value);
  doc = await api.documents.save(doc.id, bytes);
  updateMeta();
  setStatus(`Saved ${formatBytes(doc.size)}.`, "ok");
}

function clearEditor() {
  editorEl.value = "";
  setStatus("Cleared the editor. Save to write the empty document.", "warn");
  editorEl.focus();
}

// Conformance writes secret.txt in its own root. This pack shares the container
// but not the root, so the same name is absent here and a climbing path is
// refused before it reaches the filesystem.
async function probeConformanceFiles() {
  const entries = await api.files.list("");
  const own = entries.length === 0 ? "none" : entries.map((entry) => entry.path).join(", ");
  const sameName = await api.files.stat("secret.txt");

  try {
    const bytes = await api.files.read("../conformance/secret.txt");
    setStatus(`Read ${bytes.byteLength} bytes from Conformance — unexpected.`, "bad");
  } catch (err) {
    const absent = sameName === null ? "absent" : "present";
    setStatus(
      `Scratch files: ${own}; secret.txt here: ${absent}. Cross-pack read refused: ${err.message}`,
      "ok",
    );
  }
}

saveBtn.addEventListener("click", () => {
  save().catch((err) => setStatus(`Save failed: ${err.message}`, "bad"));
});

clearBtn.addEventListener("click", clearEditor);

document.getElementById("probe-files").addEventListener("click", () => {
  probeConformanceFiles().catch((err) => setStatus(`Files probe failed: ${err.message}`, "bad"));
});

load().catch((err) => setStatus(`Could not load ${DOC_NAME}: ${err.message}`, "bad"));
