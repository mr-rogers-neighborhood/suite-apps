import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";

function isHeadless(): boolean {
  return (
    process.env.SUITE_ELECTRON_HEADLESS === "1" ||
    (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)
  );
}

test("opens the explorer index and navigates to a handbook page", { tag: "@proof" }, async () => {
  const testInfo = test.info();
  const userData = await mkdtemp(join(tmpdir(), "suite-help-proof-"));
  const proofDir = process.env.SUITE_PROOF_DIR ?? join(process.cwd(), ".dev", "proof");
  await mkdir(proofDir, { recursive: true });

  const app = await electron.launch({
    args: [process.cwd(), "--no-sandbox", ...(isHeadless() ? ["--ozone-platform=headless"] : [])],
    env: {
      ...process.env,
      SUITE_HELP_USER_DATA: userData,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    },
    timeout: 30_000,
  });

  const page = await app.firstWindow({ timeout: 20_000 });
  await page.context().tracing.start({ screenshots: true, snapshots: true });

  try {
    await test.step("Open the indexed code explorer", async () => {
      await expect(page.getByRole("link", { name: "Handbook" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Modules" })).toBeVisible();
      const shot = join(proofDir, "01-explorer.png");
      await page.screenshot({ path: shot });
      await testInfo.attach("01-explorer", { path: shot, contentType: "image/png" });
    });

    await test.step("Search the handbook and open Run the gate", async () => {
      await page.getByRole("link", { name: "Handbook" }).click();
      await page.getByLabel("Search the handbook").fill("Run the gate");
      await page
        .getByRole("link", { name: /Run the gate/ })
        .first()
        .click();

      await expect(page.getByRole("heading", { name: "Run the gate", level: 1 })).toBeVisible();

      const shot = join(proofDir, "02-handbook-article.png");
      await page.screenshot({ path: shot });
      await testInfo.attach("02-handbook-article", { path: shot, contentType: "image/png" });
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
