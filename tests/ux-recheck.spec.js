// Перепроверка аудита 3 — 31 августа 2026, 10:10 MSK. Прогон: npm run test:ui
//
// Тесты BUG-056 и BUG-061 в `ux.spec.js` оказались уже дефекта: контраст мерился
// только на экране «обзор», размеры целей — только на 1440/768/390. Исправление
// сделали ровно по границам теста. Здесь набор расширен на все экраны и на полный
// диапазон ширин, плюс заведён BUG-072.
//
// Соглашение проекта: пара тестов — ожидаемое поведение с `test.skip` и рядом
// «BUG-xxx воспроизводится», закрепляющий фактическое поведение.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "fixtures");
const all = fs.readdirSync(FIXTURES).filter(name => name.endsWith(".txt")).sort();
const fix = fragment => path.join(FIXTURES, all.find(name => name.includes(fragment)));

const NC1812 = fix("NC1812");
const KN1912_A = path.join(FIXTURES, all.filter(name => name.includes("KN1912"))[0]);

async function upload(page, ...files) {
  for (const file of files) {
    await page.setInputFiles("#fileInput", file);
    await expect(page.locator("#workspace")).toBeVisible();
  }
}
async function setTheme(page, theme) {
  await page.evaluate(value => localStorage.setItem("diagdigger-theme", value), theme);
  await page.reload();
}

/** Контрастность всех видимых текстовых узлов по формуле WCAG 2.x. */
const CONTRAST_PROBE = () => {
  const luminance = rgb => {
    const [r, g, b] = rgb.map(value => {
      const channel = value / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parse = value => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const opaqueBackground = element => {
    for (let node = element; node; node = node.parentElement) {
      const background = getComputedStyle(node).backgroundColor;
      const alpha = Number((background.match(/[\d.]+/g) || [])[3] ?? 1);
      if (alpha > 0.9 && background !== "transparent") return parse(background);
    }
    return [255, 255, 255];
  };
  const results = [];
  for (const element of document.querySelectorAll("body *")) {
    const text = [...element.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent.trim()).join("");
    if (!text) continue;
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || style.opacity === "0") continue;
    const size = parseFloat(style.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    const front = luminance(parse(style.color));
    const back = luminance(opaqueBackground(element));
    const ratio = (Math.max(front, back) + 0.05) / (Math.min(front, back) + 0.05);
    if (ratio < (large ? 3 : 4.5)) {
      results.push({
        selector: element.tagName.toLowerCase() + (element.id ? `#${element.id}` : "") + (element.className ? `.${String(element.className).split(" ")[0]}` : ""),
        text: text.slice(0, 32),
        ratio: Math.round(ratio * 100) / 100,
      });
    }
  }
  return results;
};

const smallTargets = () => [...document.querySelectorAll("button, a[href], select, [tabindex='0']")]
  .map(element => ({ element, box: element.getBoundingClientRect() }))
  .filter(({ box }) => box.width > 0 && (box.width < 24 || box.height < 24))
  .map(({ element, box }) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : `.${String(element.className).split(" ")[0]}`} ${Math.round(box.width)}x${Math.round(box.height)}`);

/** Экраны, на которых обязателен прогон: обзор — не единственное состояние. */
const SCREENS = {
  "обзор": async () => {},
  "поиск": async page => { await page.fill("#searchInput", "interface"); await expect(page.locator(".search-results")).toBeVisible(); },
  "секция": async page => { await page.fill("#searchInput", ""); await page.waitForTimeout(300); await page.locator(".section-list button").first().click(); await expect(page.locator(".section-detail, .wifi-associations")).toBeVisible(); },
  "сравнение": async page => {
    await page.click("[data-nav-compare]");
    if (await page.locator("#backToCompare").count()) await page.click("#backToCompare");
    await page.click('[data-compare-mode="semantic"]');
    await expect(page.locator(".semantic-groups")).toBeVisible();
  },
  "diff": async page => { await page.click('[data-compare-mode="raw"]'); await expect(page.locator(".compare-table")).toBeVisible(); await page.locator(".compare-row[data-compare-key]").first().click(); await expect(page.locator(".diff-view")).toBeVisible(); },
};

test.beforeEach(async ({ page }) => {
  await page.goto("/index.html");
});

// --------------------------------------------------- BUG-056 · контраст на всех экранах

test("BUG-056: контраст не ниже WCAG AA на каждом экране в обеих темах", async ({ page }) => {
  test.setTimeout(180_000);
  for (const theme of ["dark", "light"]) {
    await setTheme(page, theme);
    await upload(page, NC1812, KN1912_A);
    for (const [name, go] of Object.entries(SCREENS)) {
      await go(page);
      await page.waitForTimeout(200);
      const failures = await page.evaluate(CONTRAST_PROBE);
      const summary = [...new Set(failures.map(item => `${item.selector} ${item.ratio}:1`))].slice(0, 6).join(", ");
      expect(failures, `${theme} / ${name}: ${failures.length} нарушений — ${summary}`).toEqual([]);
    }
  }
});

// --------------------------------------------------- BUG-061 · размеры целей на всех ширинах

test("BUG-061: цели не меньше 24×24 на всём диапазоне ширин", async ({ page }) => {
  await upload(page, NC1812);
  for (const width of [320, 390, 768, 900, 1024, 1100, 1200, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    expect(await page.evaluate(smallTargets), `ширина ${width} px`).toEqual([]);
  }
});

test("на 768 и 1440 px цели уже не меньше 24×24 — не сломать при исправлении BUG-061", async ({ page }) => {
  await upload(page, NC1812);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    expect(await page.evaluate(smallTargets), `ширина ${width} px`).toEqual([]);
  }
});

// --------------------------------------------------- BUG-072 · переполнение на 1001–1199 px

test("BUG-072: экран сравнения не шире вьюпорта на ноутбучных ширинах", async ({ page }) => {
  await upload(page, NC1812, KN1912_A);
  await page.click("[data-nav-compare]");
  for (const width of [1024, 1100, 1152]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `ширина ${width} px`).toBeLessThanOrEqual(width + 1);
  }
});

test("на 1000, 1200 и 1440 px переполнения нет — не сломать при исправлении BUG-072", async ({ page }) => {
  await upload(page, NC1812, KN1912_A);
  await page.click("[data-nav-compare]");
  for (const width of [1000, 1200, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `ширина ${width} px`).toBeLessThanOrEqual(width + 1);
  }
});

// --------------------------------------------------- опорные проверки закрытых дефектов

test("BUG-054, BUG-055 закрыты: 320…960 px без горизонтальной прокрутки", async ({ page }) => {
  test.setTimeout(120_000);
  await upload(page, NC1812, KN1912_A);
  for (const width of [320, 390, 768, 900, 960]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(120);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width} px / обзор`).toBeLessThanOrEqual(width + 1);
    await page.locator(".section-list button").first().click();
    await expect(page.locator(".section-detail, .wifi-associations")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width} px / секция`).toBeLessThanOrEqual(width + 1);
    await page.click("#backToCategories");
    await page.click("[data-nav-compare]");
    await expect(page.locator("#compareView")).toBeVisible();
    await page.waitForTimeout(120);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width} px / сравнение`).toBeLessThanOrEqual(width + 1);
    await page.click('[data-nav-category="all"]');
  }
});

test("BUG-058 закрыт: фокус не уходит на body ни на одном переходе", async ({ page }) => {
  await upload(page, NC1812, KN1912_A);
  const transitions = [
    ["открытие секции", async () => { await page.locator(".section-list button").first().click(); await expect(page.locator(".section-detail, .wifi-associations")).toBeVisible(); }],
    ["возврат из секции", async () => { await page.click("#backToCategories"); await expect(page.locator(".category-grid")).toBeVisible(); }],
    ["переход в сравнение", async () => { await page.click("[data-nav-compare]"); await expect(page.locator(".semantic-groups")).toBeVisible(); }],
    ["открытие объекта", async () => { await page.locator(".semantic-row").first().click(); await expect(page.locator(".semantic-detail")).toBeVisible(); }],
  ];
  for (const [name, go] of transitions) {
    await go(page);
    expect(await page.evaluate(() => document.activeElement?.tagName), name).not.toBe("BODY");
  }
});

test("BUG-060 закрыт: порядок заголовков без пропусков", async ({ page }) => {
  test.setTimeout(90_000);
  const levels = () => [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
    .filter(element => !element.closest("[aria-hidden='true'],.hidden") && element.getAttribute("aria-hidden") !== "true")
    .filter(element => element.offsetParent !== null || element.classList.contains("sr-only"))
    .map(element => Number(element.tagName[1]));
  const check = async name => {
    const list = await page.evaluate(levels);
    for (let index = 1; index < list.length; index++) {
      expect(list[index] - list[index - 1], `${name}: h${list[index - 1]} → h${list[index]}`).toBeLessThanOrEqual(1);
    }
  };
  await upload(page, NC1812, KN1912_A);
  await check("обзор");
  await page.fill("#searchInput", "interface");
  await expect(page.locator(".search-results")).toBeVisible();
  await check("поиск");
  await page.fill("#searchInput", "");
  await page.waitForTimeout(300);
  await page.locator(".section-list button").first().click();
  await expect(page.locator(".section-detail, .wifi-associations")).toBeVisible();
  await check("секция");
  await page.click("[data-nav-compare]");
  await expect(page.locator(".semantic-groups")).toBeVisible();
  await check("сравнение");
});
