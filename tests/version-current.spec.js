import fs from "node:fs";
import { test, expect } from "@playwright/test";

test("версия приложения видна в верхней панели на широком и узком экране", async ({ page }) => {
  await page.goto("/index.html");
  for (const width of [1440, 1024, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const version = page.locator(".app-version");
    await expect(version).toBeVisible();
    await expect(version).toHaveText(`v${JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version.split(".").slice(0, 2).join(".")}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  }
});
