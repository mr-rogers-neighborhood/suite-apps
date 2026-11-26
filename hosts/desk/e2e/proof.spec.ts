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

test("opens Home Screen, creates a Screen document, and switches to it", {
  tag: "@proof",
}, async () => {
  const testInfo = test.info();
  const userData = await mkdtemp(join(tmpdir(), "suite-desk-proof-"));
  const dataDir = join(userData, "desk");
  const proofDir = process.env.SUITE_PROOF_DIR ?? join(process.cwd(), ".dev", "proof");
  await mkdir(proofDir, { recursive: true });

  const app = await electron.launch({
    args: electronArgs(),
    env: {
      ...process.env,
      SUITE_DESK_USER_DATA: userData,
      SUITE_DESK_DATA: dataDir,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    },
    timeout: 30_000,
  });

  const page = await app.firstWindow({ timeout: 20_000 });
  await page.context().tracing.start({ screenshots: true, snapshots: true });

  try {
    await test.step("Finish the first run", async () => {
      await expect(page.getByRole("heading", { name: "Welcome to Suite." })).toBeVisible();
      await captureProofScreenshot(page, proofDir, "00-first-run.png", testInfo);
      await page.getByRole("button", { name: "Skip choosing for now" }).click();
      await page.getByRole("button", { name: "Continue to Home" }).click();
      await expect(page.locator("#first-run")).toBeHidden();
    });

    await test.step("Open the empty Home Screen", async () => {
      await expect(page.locator("#screen-name")).toHaveText("Home");
      await expect(page.locator(".home-empty")).toBeVisible();
      await expect(
        page.getByText("No apps are installed yet. Add one, then make a document or add a widget."),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Add an app" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Choose an app" })).toBeVisible();
      await captureProofScreenshot(page, proofDir, "01-home-screen.png", testInfo);
    });

    await test.step("Create and open a Focus Screen document", async () => {
      await page.getByRole("button", { name: "Screens", exact: true }).click();
      await page.getByLabel("New Screen name").fill("Focus");
      await page.getByRole("button", { name: "Create Screen" }).click();

      await expect(page.locator("#screen-name")).toHaveText("Focus");
      await expect(page.locator('nav[aria-label="Open tabs"] [aria-current="page"]')).toContainText(
        "Focus",
      );

      const screenFiles = await readdir(join(dataDir, "screens"));
      expect(screenFiles.filter((file) => file.endsWith(".loro")).length).toBeGreaterThanOrEqual(1);

      await captureProofScreenshot(page, proofDir, "02-focus-screen.png", testInfo);
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
