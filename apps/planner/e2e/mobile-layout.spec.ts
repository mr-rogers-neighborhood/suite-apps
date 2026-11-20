import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";

/**
 * The phone widths the mobile pack has to survive: a small Android phone, a common one, and a
 * large one. The shell collapses its rail below `md` (768 px), so all three must show the same
 * layout: a navigation button, no rail, and no horizontal scrolling.
 */
const PHONE_WIDTHS = [360, 390, 430] as const;

async function openPlanner() {
  const userData = await mkdtemp(join(tmpdir(), "suite-planner-mobile-"));
  const app = await electron.launch({
    args: [process.cwd(), "--no-sandbox"],
    env: {
      ...process.env,
      SUITE_PLANNER_USER_DATA: userData,
      SUITE_PLANNER_LIBRARY: join(userData, "documents"),
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    },
  });
  const page = await app.firstWindow();
  // A fresh user-data directory means the first-run launcher; a reused one lands on the shell.
  const newPlanner = page.getByRole("button", { name: "New planner" });
  const openNavigation = page.getByRole("button", { name: "Open navigation" });
  await expect(newPlanner.or(openNavigation).first()).toBeVisible();
  if (await newPlanner.isVisible()) await newPlanner.click();
  return { app, page };
}

async function horizontalOverflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

for (const width of PHONE_WIDTHS) {
  test(`collapses the sidebar and fits at ${width}px`, async () => {
    const { app, page } = await openPlanner();
    await page.setViewportSize({ width, height: 780 });
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width);

    // A CSS locator, not a role: `display: none` removes the rail from the accessibility tree,
    // and the claim here is about the space it takes, not the role.
    const rail = page.locator('aside[aria-label="Navigation"]');
    await expect(rail).toHaveCount(1);
    await expect(rail).toBeHidden();
    expect(await rail.evaluate((node) => node.getBoundingClientRect().width)).toBe(0);

    // The day view starts at the left edge: the collapsed rail takes no horizontal space.
    const day = await page.locator('section[aria-label="Day plan"]').boundingBox();
    expect(day?.x).toBe(0);

    const overflow = await horizontalOverflow(page);
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

    // The drawer is the affordance that replaces the rail, and it yields the width back.
    await page.getByRole("button", { name: "Open navigation" }).click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer).toBeVisible();
    await drawer.getByRole("button", { name: "Inbox" }).click();
    await expect(drawer).toBeHidden();
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();

    const afterDrawer = await horizontalOverflow(page);
    expect(afterDrawer.scrollWidth).toBeLessThanOrEqual(afterDrawer.clientWidth);

    await app.close();
  });
}

test("keeps the rail on a desktop viewport", async () => {
  const { app, page } = await openPlanner();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1280);

  await expect(page.getByRole("complementary", { name: "Navigation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeHidden();

  const overflow = await horizontalOverflow(page);
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

  await app.close();
});
