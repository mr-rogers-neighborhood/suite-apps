// window.suite is the host preload bridge; it is absent outside the host.
const api = window.suite;

const packEl = document.getElementById("pack-id");
const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// The relative path of the last backup, so "Remove" can clean it up.
let lastBackup = null;

function setStatus(message, tone = "info") {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
}

function append(step, message, tone = "info") {
  const item = document.createElement("li");
  item.dataset.tone = tone;

  const label = document.createElement("span");
  label.className = "step";
  label.textContent = step;

  const text = document.createElement("span");
  text.textContent = message;

  item.append(label, text);
  logEl.append(item);
}

function describe(error) {
  return error instanceof Error ? error.message : String(error);
}

function requireFiles() {
  if (!api?.files) {
    throw new Error("window.suite.files is missing — open this pack inside the host.");
  }
}

const checks = {
  async writeListRead() {
    requireFiles();
    const info = await api.files.write(
      "notes/hello.txt",
      encoder.encode("hello from the files service"),
    );
    const entries = await api.files.list("notes");
    const bytes = await api.files.read("notes/hello.txt");
    return `wrote ${info.path} (${info.size} B); list: ${entries
      .map((entry) => entry.path)
      .join(", ")}; read: "${decoder.decode(bytes)}"`;
  },

  async makeDirectory() {
    requireFiles();
    await api.files.mkdir("folders/one/two");
    const info = await api.files.stat("folders/one/two");
    return info === null
      ? "mkdir returned, but stat did not find the directory"
      : `created ${info.path} (${info.kind})`;
  },

  async rename() {
    requireFiles();
    if ((await api.files.stat("notes/hello.txt")) === null) await checks.writeListRead();
    await api.files.rename("notes/hello.txt", "notes/renamed.txt");
    const info = await api.files.stat("notes/renamed.txt");
    return info === null
      ? "renamed, but stat did not find the destination"
      : `renamed to ${info.path} (${info.size} B)`;
  },

  async backup() {
    requireFiles();
    if ((await api.files.stat("notes/renamed.txt")) === null) await checks.rename();
    lastBackup = await api.files.backup("notes/renamed.txt");
    const bytes = await api.files.read(lastBackup);
    return `backup path: ${lastBackup}; read back "${decoder.decode(bytes)}"`;
  },

  async remove() {
    requireFiles();
    if ((await api.files.stat("notes/renamed.txt")) === null) await checks.rename();
    await api.files.remove("notes/renamed.txt");
    if (lastBackup !== null) {
      await api.files.remove(lastBackup);
      lastBackup = null;
    }
    const entries = await api.files.list("notes");
    return `removed the file and its backup; notes now: ${
      entries.length === 0 ? "empty" : entries.map((entry) => entry.path).join(", ")
    }`;
  },

  async lock() {
    requireFiles();
    await api.files.write("locks/held.txt", encoder.encode("held"));
    const lock = await api.files.lock("locks/held.txt");

    let second;
    try {
      const extra = await api.files.lock("locks/held.txt");
      second = "allowed (unexpected)";
      await extra.release();
    } catch (error) {
      second = `refused — ${describe(error)}`;
    }

    await lock.release();

    let reacquired;
    try {
      const again = await api.files.lock("locks/held.txt");
      reacquired = "a new lock succeeded";
      await again.release();
    } catch (error) {
      reacquired = `a new lock failed — ${describe(error)}`;
    }

    return `first lock held; second ${second}; after release, ${reacquired}`;
  },

  async traversal() {
    requireFiles();
    const attempts = ["../outside.txt", "/etc/passwd", "notes/../../outside.txt"];
    const results = [];
    for (const attempt of attempts) {
      try {
        const bytes = await api.files.read(attempt);
        results.push(`${attempt}: READ ${bytes.byteLength} B (unexpected)`);
      } catch (error) {
        results.push(`${attempt}: refused — ${describe(error)}`);
      }
    }
    return results.join(" · ");
  },

  async secret() {
    requireFiles();
    const info = await api.files.write("secret.txt", encoder.encode("conformance secret"));
    return `wrote ${info.path}. Open Scratch in another tab and press "Probe Conformance files"; it should be refused.`;
  },
};

async function run(name) {
  const check = checks[name];
  if (check === undefined) return;

  setStatus(`${name}…`);
  try {
    const message = await check();
    append(name, message, "ok");
    setStatus(`${name} passed.`, "ok");
  } catch (error) {
    append(name, describe(error), "bad");
    setStatus(`${name} failed.`, "bad");
  }
}

async function runAll() {
  logEl.replaceChildren();
  lastBackup = null;
  for (const name of Object.keys(checks)) {
    await run(name);
  }
  setStatus("All checks finished. Read the log for refusals and results.", "ok");
}

function bind() {
  for (const button of document.querySelectorAll("[data-check]")) {
    button.addEventListener("click", () => {
      const name = button.dataset.check;
      if (name) run(name).catch((error) => setStatus(describe(error), "bad"));
    });
  }

  document.getElementById("run-all").addEventListener("click", () => {
    runAll().catch((error) => setStatus(describe(error), "bad"));
  });

  document.getElementById("clear").addEventListener("click", () => {
    logEl.replaceChildren();
    setStatus("Log cleared.");
  });
}

function init() {
  bind();

  if (!api) {
    packEl.textContent = "unavailable";
    setStatus("window.suite is missing — open this pack inside the host.", "bad");
    return;
  }

  packEl.textContent = api.packId;

  if (!api.files) {
    setStatus("window.suite.files is missing — this build predates the files bridge.", "bad");
    return;
  }

  setStatus("Ready. Run a check, or run all of them.");
}

init();
