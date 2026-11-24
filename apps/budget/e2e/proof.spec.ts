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

test("creates a budget document, assigns a category, and updates the visible sheet", {
  tag: "@proof",
}, async () => {
  const testInfo = test.info();
  const userData = await mkdtemp(join(tmpdir(), "suite-budget-proof-"));
  const libraryDir = join(userData, "documents");
  const proofDir = process.env.SUITE_PROOF_DIR ?? join(process.cwd(), ".dev", "proof");
  await mkdir(proofDir, { recursive: true });

  const app = await electron.launch({
    args: [process.cwd(), "--no-sandbox", ...(isHeadless() ? ["--ozone-platform=headless"] : [])],
    env: {
      ...process.env,
      SUITE_BUDGET_USER_DATA: userData,
      SUITE_BUDGET_LIBRARY: libraryDir,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    },
    timeout: 30_000,
  });

  const page = await app.firstWindow({ timeout: 20_000 });
  await page.context().tracing.start({ screenshots: true, snapshots: true });

  try {
    await test.step("Create and open a .budget document", async () => {
      await page.getByRole("button", { name: "New budget" }).click();
      await page.getByLabel("Budget name").fill("Proof Budget");
      await page.getByLabel("Starting balance").fill("1000");
      await page.getByRole("button", { name: "Create budget" }).click();

      await expect(page.getByText("Ready to Assign").first()).toBeVisible();
      await expect(page.getByText("Rent / Mortgage")).toBeVisible();

      const files = await readdir(libraryDir);
      expect(files.some((file) => file.endsWith(".budget"))).toBe(true);

      const shot = join(proofDir, "01-budget-open.png");
      await page.screenshot({ path: shot });
      await testInfo.attach("01-budget-open", { path: shot, contentType: "image/png" });
    });

    await test.step("Assign $100 to Rent / Mortgage and verify the sheet updates", async () => {
      const assigned = page.getByLabel("Assigned to Rent / Mortgage");
      await assigned.fill("100");
      await assigned.press("Enter");

      await expect(assigned).toHaveValue("100.00");
      await expect(page.getByText("$100.00").first()).toBeVisible();

      const shot = join(proofDir, "02-category-assigned.png");
      await page.screenshot({ path: shot });
      await testInfo.attach("02-category-assigned", { path: shot, contentType: "image/png" });
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
