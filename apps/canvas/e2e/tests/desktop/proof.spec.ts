import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function isHeadless(): boolean {
  return (
    process.env.SUITE_ELECTRON_HEADLESS === "1" ||
    (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)
  );
}

/**
 * Serve the built standalone Canvas bundle over loopback HTTP.
 *
 * `apps/canvas/desktop/src/main/index.ts` still resolves its unpackaged renderer
 * path from the pre-flattening `../canvas/dist` location, so passing
 * `SUITE_DESKTOP_DEV_URL` lets the proof drive the real Electron desktop shell
 * without modifying product code.
 */
async function startDistServer(
  distDir: string,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const rawPath = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
    const rel = rawPath === "/" ? "index.html" : rawPath.replace(/^\/+/, "");
    const file = normalize(join(distDir, rel));
    if (!file.startsWith(distDir + sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[extname(file)] ?? "application/octet-stream",
    });
    res.end(readFileSync(file));
  });

  await new Promise<void>((resolveListen) => {
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("failed to bind loopback server for canvas dist");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
      }),
  };
}

test("opens a .canvas document, creates a card, and renders it on the board", {
  tag: "@proof",
}, async () => {
  const testInfo = test.info();
  const canvasRoot = resolve(process.cwd(), "..");
  const desktopDir = join(canvasRoot, "desktop");
  const distDir = join(canvasRoot, "dist");
  const userData = await mkdtemp(join(tmpdir(), "suite-canvas-proof-"));
  const libraryDir = join(userData, "library");
  const dataDir = join(userData, "data");
  const proofDir = process.env.SUITE_PROOF_DIR ?? join(canvasRoot, ".dev", "proof");
  await mkdir(libraryDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await mkdir(proofDir, { recursive: true });

  const server = await startDistServer(distDir);
  const app = await electron.launch({
    args: [
      desktopDir,
      `--user-data-dir=${join(userData, "profile")}`,
      "--no-sandbox",
      ...(isHeadless() ? ["--ozone-platform=headless"] : []),
    ],
    env: {
      ...process.env,
      SUITE_CANVAS_LIBRARY: libraryDir,
      SUITE_CANVAS_DATA: dataDir,
      SUITE_SHELL_VERSION: "0.1.0-proof",
      SUITE_DESKTOP_DEV_URL: server.url,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    },
    timeout: 30_000,
  });

  const page = await app.firstWindow({ timeout: 20_000 });
  await page.context().tracing.start({ screenshots: true, snapshots: true });

  try {
    let initialCards = 0;
    await test.step("Create and open a .canvas workspace document", async () => {
      await expect(page.getByTestId("workspace-launcher")).toBeVisible({ timeout: 20_000 });
      await page.getByTestId("launcher-new").dispatchEvent("click");

      await expect(page.getByTestId("canvas-board")).toBeVisible({ timeout: 20_000 });
      const cards = page.locator('[data-testid="node-card"]');
      await expect(cards.first()).toBeVisible();
      initialCards = await cards.count();

      const files = await readdir(libraryDir);
      expect(files.some((file) => file.endsWith(".canvas"))).toBe(true);

      const shot = join(proofDir, "01-canvas-board.png");
      await page.screenshot({ path: shot });
      await testInfo.attach("01-canvas-board", { path: shot, contentType: "image/png" });
    });

    await test.step("Create a new card and verify it renders on the board", async () => {
      await page.getByTestId("dock-new-card").click();
      await page.getByTestId("dock-type-note").click();
      await expect(page.locator(".card-title-editor.ProseMirror-focused")).toHaveCount(1);
      await page.keyboard.type("Proof card");
      await page.keyboard.press("Escape");

      await expect(page.locator('[data-testid="node-card"]')).toHaveCount(initialCards + 1);
      await expect(page.getByText("Proof card").first()).toBeVisible();

      const shot = join(proofDir, "02-card-created.png");
      await page.screenshot({ path: shot });
      await testInfo.attach("02-card-created", { path: shot, contentType: "image/png" });
    });
  } finally {
    const tracePath = join(proofDir, "trace.zip");
    await page
      .context()
      .tracing.stop({ path: tracePath })
      .catch(() => {});
    await app.close().catch(() => {});
    await server.close();
    await rm(userData, { recursive: true, force: true });
  }
});
