import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";

function isHeadless(): boolean {
  return (
    process.env.SUITE_ELECTRON_HEADLESS === "1" ||
    (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)
  );
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
    args: [process.cwd(), "--no-sandbox", ...(isHeadless() ? ["--ozone-platform=headless"] : [])],
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

      const shot = join(proofDir, "01-day-plan.png");
      await page.screenshot({ path: shot });
      await testInfo.attach("01-day-plan", { path: shot, contentType: "image/png" });
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

      const shot = join(proofDir, "02-task-captured.png");
      await page.screenshot({ path: shot });
      await testInfo.attach("02-task-captured", { path: shot, contentType: "image/png" });
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
