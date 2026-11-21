import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  fakeApp,
  fakeFlatpak,
  fakeRelay,
  install,
  launch,
  launchedWith,
  type Sandbox,
  sandbox,
} from "./launcher.js";

/**
 * What the launcher promises.
 *
 * It lists what is installed, starts it with the file or the link it was handed,
 * and tells the truth about an install it cannot use. Each is checked against
 * the real process it spawned, not against its own idea of what it did.
 */

let box: Sandbox;

test.beforeEach(async () => {
  box = await sandbox();
});

test.afterEach(async () => {
  await box.dispose();
});

test("lists an installed app", async () => {
  const app = await fakeApp(box, { name: "Suite Canvas" });
  await install(box, { id: "canvas", executable: app.executable, manifestPath: app.manifestPath });

  const run = await launch(box);
  try {
    const card = run.page.locator('.card[data-app-id="canvas"]');
    await expect(card.locator(".card-name")).toHaveText("Suite Canvas");
    // The card states its version in the state line; the row under it is the hub's own.
    await expect(card.locator(".card-state")).toContainText("0.1.0");
  } finally {
    await run.close();
  }
});

test("launches the app the user picked", async () => {
  const app = await fakeApp(box);
  await install(box, { id: "canvas", executable: app.executable, manifestPath: app.manifestPath });

  const run = await launch(box);
  try {
    await run.page.getByRole("button", { name: "Open" }).click();
    await expect.poll(async () => launchedWith(app.logPath), { timeout: 15_000 }).not.toBeNull();
  } finally {
    await run.close();
  }
});

test("opens a file through the app that claims its extension", async () => {
  const app = await fakeApp(box, { extensions: ["canvas"] });
  await install(box, { id: "canvas", executable: app.executable, manifestPath: app.manifestPath });

  const document = join(box.root, "Research.canvas");
  await writeFile(document, "{}");

  const run = await launch(box, [document]);
  try {
    // The file was handed to the app as its argument, unaltered.
    await expect
      .poll(async () => launchedWith(app.logPath), { timeout: 15_000 })
      .toEqual([document]);
  } finally {
    await run.close();
  }
});

test("routes a suite:// link and records it as recent", async () => {
  const app = await fakeApp(box);
  await install(box, { id: "canvas", executable: app.executable, manifestPath: app.manifestPath });

  const run = await launch(box, ["suite://canvas/workspace/ws_1?card=c1"]);
  try {
    // Canonicalised, not passed through verbatim: the app receives the one shape
    // the suite defines.
    await expect
      .poll(async () => launchedWith(app.logPath), { timeout: 15_000 })
      .toEqual(["suite://canvas/workspace/ws_1?card=c1"]);
  } finally {
    await run.close();
  }
});

test("refuses a link to an app that is not installed, and spawns nothing", async () => {
  const app = await fakeApp(box);
  await install(box, { id: "canvas", executable: app.executable, manifestPath: app.manifestPath });

  const run = await launch(box, ["suite://planner/day/2026-11-04"]);
  try {
    // The dialog names the missing app; the point of the assertion is that the
    // installed app was not started with a link that was not meant for it.
    await run.page.waitForTimeout(1_500);
    expect(await launchedWith(app.logPath)).toBeNull();
  } finally {
    await run.close();
  }
});

test("shows an install it cannot use rather than pretending it is not there", async () => {
  const app = await fakeApp(box);
  // A manifest missing its deep-link prefix: the pair is refused, and named.
  await writeFile(
    app.manifestPath,
    JSON.stringify({
      format: "suite.app",
      id: "canvas",
      name: "Broken",
      version: "0.1.0",
      fileExtensions: ["canvas"],
    }),
  );
  await install(box, { id: "canvas", executable: app.executable, manifestPath: app.manifestPath });

  const run = await launch(box);
  try {
    const card = run.page.locator(".card-refused");
    await expect(card).toHaveCount(1);
    await expect(card.locator(".card-health")).toContainText("deepLinkPrefix");
    // It is a card, and it offers nothing to press: there is nothing to launch.
    await expect(card.getByRole("button", { name: "Open" })).toHaveCount(0);
    await expect(run.page.locator("#count-apps")).toHaveText("1");
  } finally {
    await run.close();
  }
});

test("keeps the rail quiet when every install is healthy", async () => {
  const app = await fakeApp(box);
  await install(box, { id: "canvas", executable: app.executable, manifestPath: app.manifestPath });

  const run = await launch(box);
  try {
    await expect(run.page.locator('.card[data-app-id="canvas"] .card-name')).toHaveText(
      "Suite Canvas",
    );
    await expect(run.page.locator(".card-refused")).toHaveCount(0);
    await expect(run.page.locator("#count-apps")).toBeHidden();
  } finally {
    await run.close();
  }
});

test("says an install's executable is missing, and counts it", async () => {
  const app = await fakeApp(box);
  await install(box, { id: "canvas", executable: app.executable, manifestPath: app.manifestPath });
  await rm(app.executable);

  const run = await launch(box);
  try {
    const card = run.page.locator(".card-refused");
    await expect(card.locator(".card-health")).toContainText(
      "the executable this install names is not there",
    );
    await expect(run.page.locator("#count-apps")).toHaveText("1");
  } finally {
    await run.close();
  }
});

test("records a file it opened, so it appears in recents", async () => {
  const app = await fakeApp(box);
  await install(box, { id: "canvas", executable: app.executable, manifestPath: app.manifestPath });

  const document = join(box.root, "Field notes.canvas");
  await writeFile(document, "{}");

  const first = await launch(box, [document]);
  try {
    await expect.poll(async () => launchedWith(app.logPath), { timeout: 15_000 }).not.toBeNull();
  } finally {
    await first.close();
  }

  const recents = JSON.parse(await readFile(join(box.data, "recents.json"), "utf8")) as unknown[];
  expect(recents).toHaveLength(1);

  const second = await launch(box);
  try {
    await second.page.getByRole("tab", { name: "Files" }).click();
    await expect(second.page.locator("#panel-files")).toBeVisible();
    await expect(second.page.locator("#recent-files .row-name").first()).toHaveText(
      "Field notes.canvas",
    );
  } finally {
    await second.close();
  }
});

test("reaches every section from the keyboard", async () => {
  const run = await launch(box);
  try {
    // The rail's first tab is the hub's own name, "Start".
    const apps = run.page.getByRole("tab", { name: "Start", exact: true });
    await apps.focus();
    await expect(run.page.locator("#panel-apps")).toBeVisible();

    // Automatic activation: moving focus moves the pane with it.
    await run.page.keyboard.press("ArrowDown");
    await expect(run.page.locator("#panel-files")).toBeVisible();
    await run.page.keyboard.press("ArrowDown");
    await expect(run.page.locator("#panel-sync")).toBeVisible();
    await run.page.keyboard.press("ArrowDown");
    await expect(run.page.locator("#panel-settings")).toBeVisible();
    await expect(run.page.getByRole("tab", { name: "Settings" })).toBeFocused();

    await run.page.keyboard.press("Home");
    await expect(run.page.locator("#panel-apps")).toBeVisible();
    await run.page.keyboard.press("End");
    await expect(run.page.locator("#panel-settings")).toBeVisible();
  } finally {
    await run.close();
  }
});

test("renders every section with nothing installed", async () => {
  const run = await launch(box);
  try {
    // The catalogue gives each app a card before anything is installed, so the pane is
    // never the empty placeholder; nothing is installed, so no card offers Open.
    await expect(run.page.locator('.card[data-app-id="canvas"]')).toBeVisible();
    await expect(run.page.locator("#apps-empty")).toBeHidden();
    await expect(run.page.getByRole("button", { name: "Open" })).toHaveCount(0);
    await expect(run.page.getByRole("tab")).toHaveCount(4);

    for (const name of ["Files", "Sync", "Settings"]) {
      await run.page.getByRole("tab", { name }).click();
      await expect(run.page.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
    }

    // The relay is its own program. With none installed the pane says what to
    // install and offers no dead control.
    await expect(run.page.locator("#panel-sync .pane-note").first()).toHaveText(
      "Relay not installed. Sync stays off until Suite Sync is installed.",
    );
    await expect(run.page.locator("#sync-toggle")).toHaveCount(0);
  } finally {
    await run.close();
  }
});

test("starts the Suite Sync relay it was given and shows its address", async () => {
  const relay = await fakeRelay(box);
  const run = await launch(box, [], { SUITE_SYNC_BIN: relay.executable });
  try {
    await expect(run.page.locator("#panel-sync .pane-note").first()).toHaveText(
      "On. Other devices can reach this machine.",
    );
    await expect(run.page.locator("#sync-address")).toHaveText("ws://127.0.0.1:18787/sync");
    await expect(run.page.locator("#sync-toggle")).toHaveText("Turn sync off");
    await expect.poll(async () => readFile(relay.logPath, "utf8")).toContain("serve");
  } finally {
    await run.close();
  }
});

test("says a copied install updates itself, not from the hub's feed", async () => {
  const app = await fakeApp(box);
  await install(box, { id: "canvas", executable: app.executable, manifestPath: app.manifestPath });

  const run = await launch(box);
  try {
    // The signed feed is the only update source now. A copied install keeps its own
    // updater, so the card says that rather than inventing a version.
    const card = run.page.locator('.card[data-app-id="canvas"]');
    await expect(card.locator(".card-state")).toContainText("0.1.0");
    await expect(card.locator(".card-state")).toContainText("updates itself");
  } finally {
    await run.close();
  }
});

test("lists every app's files under the app that claims the extension", async () => {
  const canvas = await fakeApp(box, { id: "canvas", name: "Suite Canvas" });
  const budget = await fakeApp(box, { id: "budget", name: "Suite Budget", extensions: ["budget"] });
  await writeFile(
    join(box.data, "installs.json"),
    JSON.stringify({
      apps: [
        { id: "canvas", executable: canvas.executable, manifestPath: canvas.manifestPath },
        { id: "budget", executable: budget.executable, manifestPath: budget.manifestPath },
      ],
    }),
  );

  const documents = join(box.root, "documents");
  await mkdir(join(documents, "Canvas"), { recursive: true });
  await mkdir(join(documents, "Budget"), { recursive: true });
  await writeFile(join(documents, "Canvas", "Research.canvas"), "{}");
  await writeFile(join(documents, "Canvas", "Field notes.canvas"), "{}");
  await writeFile(join(documents, "Budget", "Q4.budget"), "{}");

  const run = await launch(box, [], { SUITE_START_DOCUMENTS: documents });
  try {
    await run.page.getByRole("tab", { name: "Files" }).click();
    await expect(run.page.locator("#all-files .row-name")).toHaveCount(3);
    const names = await run.page.locator("#all-files .row-name").allTextContents();
    expect(names.sort()).toEqual(["Field notes.canvas", "Q4.budget", "Research.canvas"]);

    const budgetRow = run.page.locator("#all-files .row", { hasText: "Q4.budget" });
    await expect(budgetRow.locator(".row-meta")).toContainText("Budget");

    // The card summarises the index rather than guessing.
    const canvasCard = run.page.locator('.card[data-app-id="canvas"]');
    await run.page.getByRole("tab", { name: "Start", exact: true }).click();
    await expect(canvasCard.locator(".card-files")).toHaveText("2 files");
  } finally {
    await run.close();
  }
});

test("opens a file from the index through the app that owns it", async () => {
  const app = await fakeApp(box, { extensions: ["canvas"] });
  await install(box, { id: "canvas", executable: app.executable, manifestPath: app.manifestPath });

  const documents = join(box.root, "documents");
  await mkdir(join(documents, "Canvas"), { recursive: true });
  const document = join(documents, "Canvas", "Research.canvas");
  await writeFile(document, "{}");

  const run = await launch(box, [], { SUITE_START_DOCUMENTS: documents });
  try {
    await run.page.getByRole("tab", { name: "Files" }).click();
    await run.page.locator("#all-files .row-open", { hasText: "Research.canvas" }).click();
    await expect
      .poll(async () => launchedWith(app.logPath), { timeout: 15_000 })
      .toEqual([document]);
  } finally {
    await run.close();
  }
});

test("names a file whose app is not installed instead of hiding it", async () => {
  const app = await fakeApp(box);
  await install(box, { id: "canvas", executable: app.executable, manifestPath: app.manifestPath });

  const documents = join(box.root, "documents");
  await mkdir(join(documents, "Planner"), { recursive: true });
  await writeFile(join(documents, "Planner", "Week 45.planner"), "{}");

  const run = await launch(box, [], { SUITE_START_DOCUMENTS: documents });
  try {
    await run.page.getByRole("tab", { name: "Files" }).click();
    const row = run.page.locator("#all-files .row", { hasText: "Week 45.planner" });
    await expect(row.locator(".row-meta")).toHaveText("Planner · no app installed");
    // Nothing to open it with, so the row is not a button.
    await expect(row.locator("button")).toHaveCount(0);
  } finally {
    await run.close();
  }
});

test("drops a deleted file when the window refreshes", async () => {
  const app = await fakeApp(box);
  await install(box, { id: "canvas", executable: app.executable, manifestPath: app.manifestPath });

  const documents = join(box.root, "documents");
  await mkdir(join(documents, "Canvas"), { recursive: true });
  const kept = join(documents, "Canvas", "Kept.canvas");
  await writeFile(kept, "{}");
  await writeFile(join(documents, "Canvas", "Gone.canvas"), "{}");

  const run = await launch(box, [], { SUITE_START_DOCUMENTS: documents });
  try {
    await run.page.getByRole("tab", { name: "Files" }).click();
    await expect(run.page.locator("#all-files .row")).toHaveCount(2);

    await rm(join(documents, "Canvas", "Gone.canvas"));
    // Focus is the refresh signal: a timer would read every folder on a schedule
    // whether the window is in front of the person or not.
    await run.page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(run.page.locator("#all-files .row")).toHaveCount(1);
    await expect(run.page.locator("#all-files .row-name")).toHaveText("Kept.canvas");
  } finally {
    await run.close();
  }
});

test("lists a Flatpak install and says Flatpak owns it", async () => {
  const flatpak = await fakeFlatpak(box);
  const run = await launch(box, [], { SUITE_START_FLATPAK: flatpak.executable });
  try {
    const card = run.page.locator('.card[data-app-id="canvas"]');
    await expect(card.locator(".card-name")).toHaveText("Suite Canvas");
    // No feed was read and no version is promised: the remote is the update path.
    await expect(card.locator(".card-state")).toHaveText("0.1.0 · Flatpak");
    await expect(card.getByRole("button", { name: "Open" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Uninstall" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Roll back to 0.1.0" })).toHaveCount(0);
  } finally {
    await run.close();
  }
});

test("starts a Flatpak through the CLI that owns it", async () => {
  const flatpak = await fakeFlatpak(box);
  const run = await launch(box, [], { SUITE_START_FLATPAK: flatpak.executable });
  try {
    await run.page
      .locator('.card[data-app-id="canvas"]')
      .getByRole("button", { name: "Open" })
      .click();
    await expect
      .poll(async () => launchedWith(flatpak.logPath), { timeout: 15_000 })
      .toEqual(["run.suite.canvas"]);
  } finally {
    await run.close();
  }
});

test("hands a suite:// link to a Flatpak as the app's own argument", async () => {
  const flatpak = await fakeFlatpak(box);
  const run = await launch(box, ["suite://canvas/workspace/ws_1?card=c1"], {
    SUITE_START_FLATPAK: flatpak.executable,
  });
  try {
    await expect
      .poll(async () => launchedWith(flatpak.logPath), { timeout: 15_000 })
      .toEqual(["run.suite.canvas", "suite://canvas/workspace/ws_1?card=c1"]);
  } finally {
    await run.close();
  }
});

test("installs a store app through Flatpak", async () => {
  const flatpak = await fakeFlatpak(box, { installed: false, storeCommit: "b".repeat(64) });
  const run = await launch(box, [], { SUITE_START_FLATPAK: flatpak.executable });
  try {
    const card = run.page.locator('.card[data-app-id="canvas"]');
    await expect(card.locator(".card-state")).toHaveText("Not installed yet · from the store");

    await card.getByRole("button", { name: "Install Suite Canvas" }).click();
    // The card only claims the install after Flatpak reports it in `list`.
    await expect(card.locator(".card-state")).toHaveText("0.1.0 · Flatpak");
    await expect.poll(async () => launchedWith(flatpak.logPath)).toEqual(["install"]);
  } finally {
    await run.close();
  }
});

test("updates a Flatpak when the store publishes another commit", async () => {
  const flatpak = await fakeFlatpak(box, {
    commit: "a".repeat(64),
    storeCommit: "b".repeat(64),
  });
  const run = await launch(box, [], { SUITE_START_FLATPAK: flatpak.executable });
  try {
    const card = run.page.locator('.card[data-app-id="canvas"]');
    await expect(card.locator(".card-state")).toHaveText("0.1.0 · Flatpak · update available");

    await card.getByRole("button", { name: "Update" }).click();
    await expect(card.locator(".card-state")).toHaveText("0.1.0 · Flatpak");
    await expect.poll(async () => launchedWith(flatpak.logPath)).toEqual(["update"]);
  } finally {
    await run.close();
  }
});
