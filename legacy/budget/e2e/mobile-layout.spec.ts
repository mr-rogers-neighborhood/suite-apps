import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";

/**
 * The phone widths the shell has to survive. Budget keeps its rail at every width, so the bar
 * beside it has only the leftover space; these three widths are the ones the mobile pack names.
 */
const PHONE_WIDTHS = [360, 390, 430] as const;

async function openBudget() {
  const userData = await mkdtemp(join(tmpdir(), "suite-budget-mobile-"));
  const app = await electron.launch({
    args: [process.cwd(), "--no-sandbox"],
    env: {
      ...process.env,
      SUITE_BUDGET_USER_DATA: userData,
      SUITE_BUDGET_LIBRARY: join(userData, "documents"),
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    },
  });
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "New budget" }).click();
  await page.getByLabel("Budget name").fill("Mobile Budget");
  await page.getByLabel("Starting balance").fill("1000");
  await page.getByRole("button", { name: "Create budget" }).click();
  await expect(page.getByText("Ready to Assign").first()).toBeVisible();
  return { app, page };
}

async function horizontalOverflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

for (const width of PHONE_WIDTHS) {
  test(`keeps the rail and the bar inside ${width}px`, async () => {
    const { app, page } = await openBudget();
    await page.setViewportSize({ width, height: 780 });
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width);

    // The rail is the navigation at every width here, so it stays and takes its 236 px.
    const rail = page.getByRole("complementary", { name: "Navigation" });
    await expect(rail).toBeVisible();
    expect(await rail.evaluate((node) => node.getBoundingClientRect().width)).toBe(236);

    // The bar survives in what is left: Add transaction keeps a control, the wide zones hide.
    await expect(page.getByRole("button", { name: "Add transaction" })).toBeVisible();

    const overflow = await horizontalOverflow(page);
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

    // The rail still navigates at this width.
    await rail.getByRole("button", { name: "Accounts" }).click();
    await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();

    const afterNavigation = await horizontalOverflow(page);
    expect(afterNavigation.scrollWidth).toBeLessThanOrEqual(afterNavigation.clientWidth);

    await app.close();
  });
}
