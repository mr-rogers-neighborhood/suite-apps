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

test("opens Home Screen, creates a Screen document, and switches to it", {
  tag: "@proof",
}, async () => {
  const testInfo = test.info();
  const userData = await mkdtemp(join(tmpdir(), "suite-shell-proof-"));
  const dataDir = join(userData, "shell");
  const proofDir = process.env.SUITE_PROOF_DIR ?? join(process.cwd(), ".dev", "proof");
  await mkdir(proofDir, { recursive: true });

  const app = await electron.launch({
    args: [process.cwd(), "--no-sandbox", ...(isHeadless() ? ["--ozone-platform=headless"] : [])],
    env: {
      ...process.env,
      SUITE_SHELL_USER_DATA: userData,
      SUITE_SHELL_DATA: dataDir,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    },
    timeout: 30_000,
  });

  const page = await app.firstWindow({ timeout: 20_000 });
  await page.context().tracing.start({ screenshots: true, snapshots: true });

  try {
    await test.step("Open the Home Screen document", async () => {
      await expect(page.locator("#screen-name")).toHaveText("Home");
      await expect(page.locator('[data-registry-id="shell.apps"]')).toBeVisible();
      const shot = join(proofDir, "01-home-screen.png");
      await page.screenshot({ path: shot });
      await testInfo.attach("01-home-screen", { path: shot, contentType: "image/png" });
    });

    await test.step("Create and open a Focus Screen document", async () => {
      await page.getByRole("button", { name: "Screens", exact: true }).click();
      await page.getByLabel("New Screen name").fill("Focus");
      await page.getByRole("button", { name: "Create Screen" }).click();

      await expect(page.locator("#screen-name")).toHaveText("Focus");
      await expect(page.locator('[role="tab"][aria-selected="true"]')).toContainText("Focus");

      const screenFiles = await readdir(join(dataDir, "screens"));
      expect(screenFiles.filter((file) => file.endsWith(".loro")).length).toBeGreaterThanOrEqual(1);

      const shot = join(proofDir, "02-focus-screen.png");
      await page.screenshot({ path: shot });
      await testInfo.attach("02-focus-screen", { path: shot, contentType: "image/png" });
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
