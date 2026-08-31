import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const names = fs.readdirSync(fixtures).filter(name => name.endsWith(".txt")).sort();
const fixture = fragment => path.join(fixtures, names.find(name => name.includes(fragment)));

test.beforeEach(async ({ page }) => {
  await page.goto("/index.html");
  await page.setInputFiles("#fileInput", fixture("NC1812"));
});

test("BUG-061: список темы не сжимается на ширине 1024 px", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  expect((await page.locator("#themeSelect").boundingBox()).width).toBeGreaterThanOrEqual(96);
});

test("BUG-072: сравнение помещается на ширине 1024 px", async ({ page }) => {
  await page.setInputFiles("#fileInput", fixture("KN1912"));
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.click("[data-nav-compare]");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1025);
});
