import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, expect, type Page, type TestInfo, test } from "@playwright/test";

function isHeadless(): boolean {
  return (
    process.env.SUITE_ELECTRON_HEADLESS === "1" ||
    (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)
  );
}

function electronArgs(): string[] {
  return [
    process.cwd(),
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    ...(isHeadless() ? ["--ozone-platform=headless"] : []),
  ];
}

async function captureProofScreenshot(
  page: Page,
  proofDir: string,
  filename: string,
  testInfo: TestInfo,
): Promise<void> {
  await page.waitForLoadState("load");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const settle = () => requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        if (document.fonts?.ready) {
          void document.fonts.ready.then(settle, settle);
        } else {
          settle();
        }
      }),
  );
  const shot = join(proofDir, filename);
  try {
    await page.screenshot({ path: shot });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to capture proof screenshot ${filename}: ${detail}`);
  }
  const info = await stat(shot).catch(() => null);
  if (info === null || info.size === 0) {
    throw new Error(`Proof screenshot ${filename} is missing or empty (${shot})`);
  }
  await testInfo.attach(filename.replace(/\.png$/u, ""), {
    path: shot,
    contentType: "image/png",
  });
}

test("opens a planner document, captures a task, and shows it on the day plan", {
  tag: "@proof",
}, async () => {
  const testInfo = test.info();
  const userData = await mkdtemp(join(tmpdir(), "suite-planner-proof-"));
  const libraryDir = join(userData, "documents");
  const proofDir = process.env.SUITE_PROOF_DIR ?? join(process.cwd(), ".dev", "proof");
  await mkdir(proofDir, { recursive: true });

  const app = await electron.launch({
    args: electronArgs(),
    env: {
      ...process.env,
      SUITE_PLANNER_USER_DATA: userData,
      SUITE_PLANNER_LIBRARY: libraryDir,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    },
    timeout: 30_000,
  });

  const page = await app.firstWindow({ timeout: 20_000 });
  await page.context().tracing.start({ screenshots: true, snapshots: true });

  try {
    await test.step("Create and open a .planner document", async () => {
      const newPlanner = page.getByRole("button", { name: "New planner" });
      const capture = page.getByLabel("Capture a task");
      await expect(newPlanner.or(capture).first()).toBeVisible();
      if (await newPlanner.isVisible()) await newPlanner.click();

      await expect(capture).toBeVisible();

      await captureProofScreenshot(page, proofDir, "01-day-plan.png", testInfo);
    });

    await test.step("Capture a task and verify it appears in the plan", async () => {
      const capture = page.getByLabel("Capture a task");
      await capture.fill("Review desktop proof ~20m");
      await capture.press("Enter");

      await expect(
        page.getByRole("button", { name: "Review desktop proof", exact: true }),
      ).toBeVisible();

      await expect
        .poll(async () => {
          const files = await readdir(libraryDir, { recursive: true });
          return files.some((file) => file.endsWith(".planner"));
        })
        .toBe(true);

      await captureProofScreenshot(page, proofDir, "02-task-captured.png", testInfo);
    });
  } finally {
    const tracePath = join(proofDir, "trace.zip");
    await page
      .context()
      .tracing.stop({ path: tracePath })
      .catch(() => {});
    await app.close().catch(() => {});
    await rm(userData, { recursive: true, force: true });
  }
});
