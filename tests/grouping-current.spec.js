import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(HERE, "fixtures", fs.readdirSync(path.join(HERE, "fixtures")).find(name => name.includes("KN1811")));

test.beforeEach(async ({ page }) => {
  await page.goto("/index.html");
  await page.setInputFiles("#fileInput", fixture);
  await expect(page.locator("#workspace")).toBeVisible();
});

test("карточка устройства не дублирует HW ID", async ({ page }) => {
  const device = page.locator(".meta-grid > div").filter({ hasText: "Устройство" }).first();
  await expect(device.locator("span")).toHaveText("Устройство");
  await expect(device.locator("b")).toHaveText("KN1811");
  await expect(page.getByText("Устройство · HW ID", { exact: true })).toHaveCount(0);
});

test("основные show-списки KN-1811 открываются карточками с исходным XML", async ({ page }) => {
  const sections = [
    ["hosts", "show device-list"],
    ["hosts", "show ip neighbour"],
    ["hosts", "show ip arp"],
    ["appTraffic", "show ntce hosts"],
    ["remoteAccess", "show ip http proxy"],
  ];
  for (const [category, name] of sections) {
    await page.click(`[data-nav-category="${category}"]`);
    await page.locator(".section-list button", { hasText: name }).click();
    await expect(page.locator(".human-xml-section")).toBeVisible();
    await expect(page.locator(".record-card").first()).toBeVisible();
    await expect(page.locator(".human-xml-raw summary")).toHaveText("Исходный XML");
    await page.click("#backToCategories");
  }
});

test("меню следует новой группировке и сохраняет IPv6", async ({ page }) => {
  for (const label of ["Системный монитор", "Анализатор трафика приложений", "Списки клиентов", "Доменное имя и удалённый доступ", "Диагностика", "IPv6"]) {
    await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
  }
});

test("карточки не расширяют страницу на узком экране в обеих темах", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  for (const theme of ["light", "dark"]) {
    await page.locator("#themeSelect").selectOption(theme);
    await page.click('[data-nav-category="hosts"]');
    await page.locator(".section-list button", { hasText: "show device-list" }).click();
    await expect(page.locator(".record-card").first()).toBeVisible();
    const dimensions = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
    await expect(page.locator(".human-xml-raw .code-view")).toHaveAttribute("tabindex", "0");
    await page.click("#backToCategories");
  }
});
