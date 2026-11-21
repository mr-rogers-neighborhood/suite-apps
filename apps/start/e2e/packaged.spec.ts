import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Browser, chromium, expect, type Page, test } from "@playwright/test";
import { fakeApp, install, type Sandbox, START_DIR, sandbox } from "./launcher.js";

/**
 * The packaged hub against the published feed.
 *
 * `_electron.launch` cannot drive this binary. Playwright waits for the Node
 * inspector line before it connects, and the shipped build turns CLI inspect
 * arguments off with an Electron fuse (`enableNodeCliInspectArguments: false`),
 * so the handshake times out while the window opens normally. Flipping the fuse
 * for a test build would test a different artifact, and the Chromium DevTools
 * endpoint is there either way. So this spec starts the binary itself and
 * connects over CDP.
 *
 * It is not part of `pnpm e2e` or the gate. It needs `pnpm package:dir` first and
 * it reads the real host, so it runs on request after a publish:
 * `pnpm --filter @suite/start e2e:packaged`.
 */

const BINARY = resolve(START_DIR, "release", "linux-unpacked", "suite-start");
const CANVAS_FEED =
  "https://raw.githubusercontent.com/mr-rogers-neighborhood/suite-apps/main/feeds/canvas/latest-linux.yml";

/** The version the published manifest offers, read the way the app reads it. */
async function feedVersion(): Promise<string> {
  const response = await fetch(CANVAS_FEED);
  expect(response.ok, `${CANVAS_FEED} answered ${response.status}`).toBe(true);
  const match = /^version:\s*['"]?([0-9][^'"\s]*)/m.exec(await response.text());
  expect(match, "the feed names no version").not.toBeNull();
  return match?.[1] ?? "";
}

function stopped(child: ChildProcess): Promise<void> {
  return new Promise((done) => {
    if (child.exitCode !== null) {
      done();
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      done();
    });
  });
}

interface Running {
  readonly browser: Browser;
  readonly page: Page;
  stop(): Promise<void>;
}

async function launchPackaged(box: Sandbox): Promise<Running> {
  const child = spawn(BINARY, ["--no-sandbox", "--remote-debugging-port=0"], {
    env: {
      ...process.env,
      // The same isolation the launcher spec gets: a profile, a home and a port
      // of its own, so a running hub cannot take this one's lock or its port.
      HOME: box.home,
      XDG_DATA_HOME: join(box.home, ".local", "share"),
      SUITE_START_USER_DATA: box.userData,
      SUITE_START_DATA: box.data,
      SUITE_START_SYNC_PORT: "0",
      // A packaged hub on a machine with suite-sync installed must still be the
      // same test every time; a spec that wants a relay names its own stand-in.
      SUITE_SYNC_BIN: join(box.root, "no-suite-sync"),
      // The fake lives under `box.apps`, so this is the root that makes the
      // record a managed install rather than a copy the person placed.
      SUITE_START_APPS_ROOT: box.apps,
      // Empty rather than absent: `feedFor` reads the compiled feeds when no
      // base overrides them, which is the path this spec is here to prove.
      SUITE_START_FEED_BASE: "",
      SUITE_START_FLATPAK: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  const endpoint = await new Promise<string>((done, fail) => {
    const timer = setTimeout(() => {
      fail(new Error(`no DevTools endpoint after 30 s:\n${output}`));
    }, 30_000);
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const match = /^DevTools listening on (ws:\/\/.*)$/m.exec(output);
      if (match?.[1]) {
        clearTimeout(timer);
        done(match[1].trim());
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      fail(new Error(`the packaged hub exited with ${code}:\n${output}`));
    });
  });

  const browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? (await context.waitForEvent("page"));
  await expect(page.locator("h1")).toHaveText("Suite", { timeout: 30_000 });

  return {
    browser,
    page,
    stop: async () => {
      await browser.close().catch(() => {});
      child.kill("SIGTERM");
      await stopped(child);
    },
  };
}

test.skip(
  !existsSync(BINARY),
  "the packaged hub is not built; run `pnpm --filter @suite/start package:dir` first",
);

test("the packaged hub reads Canvas's version from the published feed", async () => {
  const version = await feedVersion();
  const box = await sandbox();
  // Older than anything published, so the label with the live version in it can
  // only come from the feed.
  const fake = await fakeApp(box, { name: "Suite Canvas", version: "0.0.1" });
  await install(box, {
    id: "canvas",
    executable: fake.executable,
    manifestPath: fake.manifestPath,
  });

  const run = await launchPackaged(box);
  try {
    const card = run.page.locator('.card[data-app-id="canvas"]');
    await expect(card.locator(".card-state")).toContainText("newer version available", {
      timeout: 30_000,
    });
    await expect(run.page.getByRole("button", { name: `Update to ${version}` })).toBeVisible();
  } finally {
    await run.stop();
    await box.dispose();
  }
});
