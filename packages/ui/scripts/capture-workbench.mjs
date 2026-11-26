import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

/**
 * Capture the workbench matrix from the running Storybook.
 *
 * The owner starts Storybook (`mise exec -- pnpm --filter @suite/ui storybook`); this script
 * only drives a headless browser against it. Screenshots are local proof under `.artifacts/`,
 * not a hosted visual service and not part of the gate.
 */
const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..");
const base = process.env.STORYBOOK_URL ?? "http://localhost:6007";
const indexPath = join(app, ".storybook", "stories.index.json");
const outDir = join(app, "..", "..", ".artifacts", "workbench");

if (!existsSync(indexPath)) {
  console.error("stories.index.json is missing; run `pnpm --filter @suite/ui index:stories`.");
  process.exit(1);
}

const { stories } = JSON.parse(readFileSync(indexPath, "utf8"));
const targets = stories.filter(
  (story) => story.title.startsWith("Packs/") && story.name !== "Default",
);

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

let captured = 0;
for (const story of targets) {
  await page.goto(`${base}/iframe.html?id=${story.id}&viewMode=story`, {
    waitUntil: "networkidle",
  });
  await page.waitForSelector("#storybook-root > *", { timeout: 15_000 });
  const file = join(outDir, `${story.id}.png`);
  await page.screenshot({ path: file, fullPage: true });
  captured += 1;
  console.log(`${story.title} — ${story.name} → ${file}`);
}

await browser.close();
console.log(`${captured} screenshots in ${outDir}`);
