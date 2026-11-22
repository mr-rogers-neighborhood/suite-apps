// window.suite is the host preload bridge. It is absent if this page is opened
// outside the host, so every entry point checks for it before use.
const api = window.suite;

const packIdEl = document.getElementById("pack-id");
const notesEl = document.getElementById("notes");
const nameEl = document.getElementById("note-name");
const editorEl = document.getElementById("editor");
const metaEl = document.getElementById("note-meta");
const saveBtn = document.getElementById("save");
const deleteBtn = document.getElementById("delete");
const statusEl = document.getElementById("status");

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Metadata of the open note, or null.
let current = null;

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

// The host stores opaque bytes; the pack owns the format.
function encodeNote(text) {
  return encoder.encode(JSON.stringify({ text }));
}

function decodeNote(bytes) {
  const parsed = JSON.parse(decoder.decode(bytes));
  if (!parsed || typeof parsed.text !== "string") {
    throw new Error("Unrecognised note format.");
  }
  return parsed.text;
}

function describe(doc) {
  return `${doc.name} · ${formatBytes(doc.size)} · updated ${formatDate(doc.updatedAt)}`;
}

function renderList(notes) {
  notesEl.replaceChildren();

  if (notes.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No notes yet. Create one above.";
    notesEl.append(empty);
    return;
  }

  for (const doc of notes) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const name = document.createElement("span");
    const size = document.createElement("span");

    button.type = "button";
    button.className = "note";
    if (current && current.id === doc.id) button.classList.add("is-open");
    button.title = describe(doc);

    name.className = "name";
    name.textContent = doc.name;
    size.className = "size";
    size.textContent = formatBytes(doc.size);

    button.append(name, size);
    button.addEventListener("click", () => {
      openNote(doc.id).catch((err) => setStatus(`Could not open: ${err.message}`, "bad"));
    });

    item.append(button);
    notesEl.append(item);
  }
}

async function refresh() {
  const docs = await api.documents.list();
  const notes = docs
    .filter((doc) => doc.name.endsWith(".note"))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  renderList(notes);
  return notes;
}

function setEditorEnabled(enabled) {
  editorEl.disabled = !enabled;
  saveBtn.disabled = !enabled;
  deleteBtn.disabled = !enabled;
}

async function openNote(id) {
  const doc = await api.documents.open(id);
  if (!doc) throw new Error("host returned no document.");

  current = doc;
  editorEl.value = decodeNote(doc.bytes);
  setEditorEnabled(true);
  metaEl.textContent = describe(doc);
  api.setTitle(doc.name);
  setStatus(`Opened ${doc.name}.`, "ok");
  await refresh();
}

async function createNote() {
  let name = nameEl.value.trim();
  if (!name) name = `note-${Date.now().toString(36)}`;
  if (!name.endsWith(".note")) name += ".note";

  const created = await api.documents.create(name);
  nameEl.value = "";
  await refresh();
  await openNote(created.id);
  setStatus(`Created and opened ${created.name}.`, "ok");
}

async function saveNote() {
  if (!current) return;

  const bytes = encodeNote(editorEl.value);
  const meta = await api.documents.save(current.id, bytes);
  current = meta;
  metaEl.textContent = describe(meta);
  await refresh();
  setStatus(`Saved ${meta.name} (${formatBytes(meta.size)}).`, "ok");
}

async function deleteNote() {
  if (!current) return;

  const name = current.name;
  await api.documents.remove(current.id);
  current = null;
  editorEl.value = "";
  setEditorEnabled(false);
  metaEl.textContent = "No note open.";
  api.setTitle("Welcome");
  await refresh();
  setStatus(`Deleted ${name}.`, "ok");
}

async function testNetwork() {
  setStatus('Calling fetch("https://example.com")…');
  try {
    const response = await fetch("https://example.com");
    setStatus(`fetch resolved with ${response.status} — the CSP did not block it.`, "bad");
  } catch (err) {
    setStatus(`Blocked as expected by the CSP: ${err.message}`, "ok");
  }
}

async function testSibling() {
  setStatus('Calling documents.open("../scratch/scratch.txt")…');
  try {
    const doc = await api.documents.open("../scratch/scratch.txt");
    if (doc) {
      setStatus("Host returned a document for a traversal path — unexpected.", "bad");
    } else {
      setStatus("Refused as expected: the host returned null.", "ok");
    }
  } catch (err) {
    setStatus(`Refused as expected by the host: ${err.message}`, "ok");
  }
}

async function testFilesCapability() {
  setStatus('Calling files.list("") without the files capability…');
  try {
    const entries = await api.files.list("");
    setStatus(
      `Host returned ${entries.length} entries without the files capability — unexpected.`,
      "bad",
    );
  } catch (err) {
    setStatus(`Refused as expected: ${err.message}`, "ok");
  }
}

function bind() {
  document.getElementById("new-note").addEventListener("click", () => {
    createNote().catch((err) => setStatus(`Could not create: ${err.message}`, "bad"));
  });
  saveBtn.addEventListener("click", () => {
    saveNote().catch((err) => setStatus(`Could not save: ${err.message}`, "bad"));
  });
  deleteBtn.addEventListener("click", () => {
    deleteNote().catch((err) => setStatus(`Could not delete: ${err.message}`, "bad"));
  });
  document.getElementById("test-network").addEventListener("click", () => {
    testNetwork().catch((err) => setStatus(`Network test failed oddly: ${err.message}`, "bad"));
  });
  document.getElementById("test-sibling").addEventListener("click", () => {
    testSibling().catch((err) => setStatus(`Sibling test failed oddly: ${err.message}`, "bad"));
  });
  document.getElementById("test-files").addEventListener("click", () => {
    testFilesCapability().catch((err) =>
      setStatus(`Files test failed oddly: ${err.message}`, "bad"),
    );
  });
}

async function init() {
  bind();

  if (!api) {
    packIdEl.textContent = "unavailable";
    setStatus("window.suite is missing — open this pack inside the host.", "bad");
    return;
  }

  packIdEl.textContent = api.packId;

  try {
    const notes = await refresh();
    const message =
      notes.length === 0
        ? "Ready. No notes yet — create one above."
        : `Ready. ${notes.length} note(s) in this pack.`;
    setStatus(message);
  } catch (err) {
    setStatus(`Could not list documents: ${err.message}`, "bad");
  }
}

init().catch((err) => setStatus(`Startup failed: ${err.message}`, "bad"));
