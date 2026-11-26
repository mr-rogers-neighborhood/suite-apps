import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
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

test("opens the handbook at the root, opens the explorer and reads a page", {
  tag: "@proof",
}, async () => {
  const testInfo = test.info();
  const userData = await mkdtemp(join(tmpdir(), "suite-help-proof-"));
  const proofDir = process.env.SUITE_PROOF_DIR ?? join(process.cwd(), ".dev", "proof");
  await mkdir(proofDir, { recursive: true });

  const app = await electron.launch({
    args: electronArgs(),
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
    await test.step("Open the handbook at the root", async () => {
      // Help is a reader first: `/` lands on the user handbook, not the explorer.
      await expect(page.getByRole("heading", { name: "User handbook", level: 1 })).toBeVisible();
      await expect(page.getByRole("complementary", { name: "Handbook contents" })).toBeVisible();
      await captureProofScreenshot(page, proofDir, "01-handbook-root.png", testInfo);
    });

    await test.step("Open the indexed code explorer", async () => {
      await page.getByRole("link", { name: "Explorer", exact: true }).click();
      await expect(page.getByRole("button", { name: "Modules" })).toBeVisible();
      await expect(page.getByRole("link", { name: /View the user handbook/ })).toBeVisible();
      await captureProofScreenshot(page, proofDir, "02-explorer.png", testInfo);
    });

    await test.step("Search the user handbook and read the Local-first page", async () => {
      await page.getByRole("link", { name: /View the user handbook/ }).click();
      await page.getByLabel("Search the handbook").fill("Local-first");
      await page
        .getByRole("link", { name: /Local-first/ })
        .first()
        .click();

      await expect(page.getByRole("heading", { name: "Local-first", level: 1 })).toBeVisible();

      await captureProofScreenshot(page, proofDir, "03-handbook-article.png", testInfo);
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
