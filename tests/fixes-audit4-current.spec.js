import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "fixtures");
const names = fs.readdirSync(FIXTURES).filter(name => name.endsWith(".txt"));
const fixture = fragment => path.join(FIXTURES, names.find(name => name.includes(fragment)));

async function upload(page, ...fragments) {
  await page.goto("/index.html");
  await page.setInputFiles("#fileInput", fragments.map(fixture));
  await expect(page.locator("#workspace")).toBeVisible({ timeout: 60_000 });
}

test("BUG-073: приложение работает без localStorage", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new DOMException("blocked", "SecurityError"); } }));
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.goto("/index.html");
  await page.setInputFiles("#fileInput", fixture("KN1713"));
  await expect(page.locator("#workspace")).toBeVisible({ timeout: 20_000 });
  expect(errors).toEqual([]);
});

test("BUG-075/076: отмена доступна сразу и восстанавливает стороны сравнения", async ({ page }) => {
  await upload(page, "KN1713", "NC1812");
  await page.click("[data-nav-compare]");
  const before = await page.evaluate(() => [leftSelect.value, rightSelect.value]);
  await page.focus("#removeCurrentFile");
  await page.keyboard.press("Enter");
  await expect(page.locator("#toast button")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#leftSelect")).toHaveValue(before[0]);
  await expect(page.locator("#rightSelect")).toHaveValue(before[1]);
  expect(before[0]).not.toBe(before[1]);
});

test("BUG-077/078/083: новые прокручиваемые блоки доступны и используют ширину", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await upload(page, "KN1811", "NC1812");
  await page.click("[data-nav-compare]");
  for (const button of await page.locator(".mode-switch button").all()) expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(24);
  const key = await page.locator("[data-compare-key]").first().getAttribute("data-compare-key");
  await page.click(`[data-compare-key="${key}"]`);
  await page.locator(".raw-details summary").click();
  for (const pre of await page.locator(".raw-details pre").all()) {
    await expect(pre).toHaveAttribute("tabindex", "0");
    await expect(pre).toHaveAttribute("role", "region");
  }
  await upload(page, "KN1811");
  await page.click('[data-nav-category="diagnostics"]');
  await page.locator("[data-section-key]", { hasText: "mtdoops/ndm" }).first().click();
  await page.locator("details.json-cell-details summary").first().click();
  const size = await page.evaluate(() => { const pre = document.querySelector("details.json-cell-details[open] pre"); const group = pre.closest(".json-group"); return { tab: pre.tabIndex, role: pre.getAttribute("role"), ratio: pre.getBoundingClientRect().width / group.getBoundingClientRect().width }; });
  expect(size.tab).toBe(0);
  expect(size.role).toBe("region");
  expect(size.ratio).toBeGreaterThan(0.8);
});

test("BUG-080/081/082: шапка не содержит конфликтующих подписей и мёртвых правил", async ({ page }) => {
  await upload(page, "KN1713");
  await expect(page.locator(".app-version")).not.toHaveAttribute("aria-label", /.+/);
  await expect(page.locator("#globalFileSelect")).not.toHaveAttribute("aria-label", /.+/);
  await expect(page.locator("#themeSelect")).not.toHaveAttribute("aria-label", /.+/);
  const dead = await page.evaluate(() => [...document.styleSheets].flatMap(sheet => { try { return [...sheet.cssRules].flatMap(rule => rule.cssRules ? [...rule.cssRules] : [rule]); } catch { return []; } }).filter(rule => rule.selectorText?.includes(".theme-control button")).map(rule => rule.selectorText));
  expect(dead).toEqual([]);
});

test("BUG-084/085/086: пробелы не меняют карточки, skip-link фокусирует цель, бренд не меняет URL", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await upload(page, "KN1811");
  const count = () => page.evaluate(() => [...document.querySelectorAll(".category-card")].find(card => card.querySelector(".show-more"))?.querySelectorAll("[data-section-key]").length);
  const before = await count();
  await page.fill("#searchInput", "   ");
  await page.waitForTimeout(350);
  expect(await count()).toBe(before);
  await page.locator(".skip-link").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#exploreView")).toBeFocused();
  const url = page.url();
  await page.click("a.brand");
  expect(page.url()).toBe(url);
});
