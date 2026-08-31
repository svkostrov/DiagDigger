// Аудит 3 — UX/UI e2e-тесты DiagDigger, 31 августа 2026. Прогон: npm run test:ui
//
// Регрессионные UX/UI-тесты исправленных дефектов аудита 3.
//
// Зависимостей сверх @playwright/test не требуется: контраст считается по формуле WCAG 2.x
// прямо в браузере, доступность — по структуре DOM.
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
const KN1912_B = path.join(FIXTURES, all.filter(name => name.includes("KN1912"))[1]);

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
    results.push({
      selector: element.tagName.toLowerCase() + (element.id ? `#${element.id}` : "") + (element.className ? `.${String(element.className).split(" ")[0]}` : ""),
      text: text.slice(0, 40),
      ratio: Math.round(ratio * 100) / 100,
      required: large ? 3 : 4.5,
    });
  }
  return results.filter(item => item.ratio < item.required);
};

test.beforeEach(async ({ page }) => {
  await page.goto("/index.html");
});

// --------------------------------------------------------------- BUG-054 · 721–959 px

test("BUG-054: на планшетной ширине страница не шире вьюпорта", async ({ page }) => {
  await upload(page, NC1812);
  for (const width of [768, 820, 900]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, `ширина ${width} px`).toBeLessThanOrEqual(width + 1);
  }
});

// --------------------------------------------------------------- BUG-055 · 320 px

test("BUG-055: на ширине 320 px нет горизонтальной прокрутки", async ({ page }) => {
  await upload(page, NC1812);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
});

// --------------------------------------------------------------- BUG-056 · контраст

test("BUG-056: контраст текста не ниже WCAG AA в обеих темах", async ({ page }) => {
  for (const theme of ["dark", "light"]) {
    await setTheme(page, theme);
    await upload(page, NC1812);
    const failures = await page.evaluate(CONTRAST_PROBE);
    expect(failures, `${theme}: ${failures.map(item => `${item.selector} ${item.ratio}:1`).join(", ")}`).toEqual([]);
  }
});

// --------------------------------------------------------------- BUG-057 · одинаковые подписи

test("BUG-057: две диагностики одного устройства различимы в списках", async ({ page }) => {
  await upload(page, KN1912_A, KN1912_B);
  await page.click("[data-nav-compare]");
  const labels = await page.locator("#leftSelect option").allTextContents();
  expect(new Set(labels).size).toBe(labels.length);
});

// --------------------------------------------------------------- BUG-058 · фокус

test("BUG-058: после открытия секции фокус остаётся в приложении", async ({ page }) => {
  await upload(page, NC1812);
  await page.locator(".section-list button").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".section-detail, .wifi-associations")).toBeVisible();
  const active = await page.evaluate(() => document.activeElement?.tagName);
  expect(active).not.toBe("BODY");
});

// --------------------------------------------------------------- BUG-059 · усечение поиска

test("BUG-059: усечённая выдача поиска помечена в интерфейсе", async ({ page }) => {
  await upload(page, NC1812);
  await page.fill("#searchInput", "a");
  await expect(page.locator(".search-results")).toBeVisible();
  await expect(page.locator(".search-results")).toContainText(/показан|перв|усеч|лимит/i);
});

// --------------------------------------------------------------- BUG-060 · порядок заголовков

const headingLevels = () => [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
  .filter(element => !element.closest("[aria-hidden='true'],.hidden") && element.getAttribute("aria-hidden") !== "true")
  .filter(element => element.offsetParent !== null || element.classList.contains("sr-only"))
  .map(element => Number(element.tagName[1]));

test("BUG-060: уровни заголовков идут без пропусков", async ({ page }) => {
  await upload(page, NC1812);
  const levels = await page.evaluate(headingLevels);
  for (let index = 1; index < levels.length; index++) {
    expect(levels[index] - levels[index - 1], `переход h${levels[index - 1]} → h${levels[index]}`).toBeLessThanOrEqual(1);
  }
});

// --------------------------------------------------------------- BUG-061 · размер целей

const smallTargets = () => [...document.querySelectorAll("button, a[href], select, [tabindex='0']")]
  .map(element => ({ element, box: element.getBoundingClientRect() }))
  .filter(({ box }) => box.width > 0 && (box.width < 24 || box.height < 24))
  .map(({ element, box }) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : `.${String(element.className).split(" ")[0]}`} ${Math.round(box.width)}x${Math.round(box.height)}`);

test("BUG-061: интерактивные элементы не меньше 24×24 (WCAG 2.5.8)", async ({ page }) => {
  await upload(page, NC1812);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    expect(await page.evaluate(smallTargets), `ширина ${width} px`).toEqual([]);
  }
});

// --------------------------------------------------------------- BUG-064 · один тост на все ошибки

test("BUG-064: сообщения об отказе видны по каждому непринятому файлу", async ({ page }) => {
  const bad = path.join(HERE, "..", "tmp", "ux-bad-1.txt");
  const bad2 = path.join(HERE, "..", "tmp", "ux-bad-2.txt");
  fs.mkdirSync(path.dirname(bad), { recursive: true });
  fs.writeFileSync(bad, "не self-test"); fs.writeFileSync(bad2, "тоже не self-test");
  await page.setInputFiles("#fileInput", [bad, bad2]);
  await expect(page.locator("#toast")).toContainText("ux-bad-1");
  await expect(page.locator("#toast")).toContainText("ux-bad-2");
});

// --------------------------------------------------------------- BUG-065 · удаление без подтверждения

test("BUG-065: удаление диагностики подтверждается или обратимо", async ({ page }) => {
  await upload(page, NC1812);
  await page.click("#removeCurrentFile");
  const reversible = await page.locator("text=/отменить|вернуть|восстановить/i").count();
  const confirmed = await page.locator("[role='alertdialog'], dialog[open]").count();
  expect(reversible + confirmed).toBeGreaterThan(0);
});

// --------------------------------------------------------------- BUG-066 · тупик пустой выдачи

test("BUG-066: пустой результат поиска предлагает следующий шаг", async ({ page }) => {
  await upload(page, NC1812);
  await page.fill("#searchInput", "zzzqqq");
  await expect(page.locator(".empty-results")).toBeVisible();
  expect(await page.locator(".empty-results button, .empty-results a").count()).toBeGreaterThan(0);
});

// --------------------------------------------------------------- BUG-067 · заголовок страницы

test("BUG-067: заголовок вкладки отражает открытый раздел и файл", async ({ page }) => {
  await upload(page, NC1812);
  const overview = await page.title();
  await page.click('[data-nav-category="wifi"]');
  expect(await page.title()).not.toBe(overview);
});

// --------------------------------------------------------------- BUG-068 · часовой пояс

test("BUG-068: время диагностики подписано часовым поясом", async ({ page }) => {
  await upload(page, NC1812, KN1912_A);
  await page.click("[data-nav-compare]");
  const label = (await page.locator("#leftSelect option").first().textContent());
  expect(label).toMatch(/UTC|GMT|МСК|\+\d{2}:?\d{2}/);
});

// --------------------------------------------------------------- опорные проверки

test("консоль чиста во всех основных состояниях", async ({ page }) => {
  const problems = [];
  page.on("console", message => { if (["error", "warning"].includes(message.type())) problems.push(message.text()); });
  page.on("pageerror", error => problems.push(String(error.message)));
  await upload(page, NC1812, KN1912_A);
  await page.fill("#searchInput", "interface");
  await expect(page.locator(".search-results")).toBeVisible();
  await page.fill("#searchInput", "");
  await page.locator(".section-list button").first().click();
  await expect(page.locator(".section-detail, .wifi-associations")).toBeVisible();
  await page.click("[data-nav-compare]");
  await expect(page.locator(".semantic-groups")).toBeVisible();
  await page.click('[data-compare-mode="raw"]');
  await page.locator(".compare-row[data-compare-key]").first().click();
  await expect(page.locator(".diff-view")).toBeVisible();
  expect(problems).toEqual([]);
});

test("на 360 и 390 px горизонтальной прокрутки нет", async ({ page }) => {
  await upload(page, NC1812);
  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `ширина ${width} px`).toBeLessThanOrEqual(width + 1);
  }
});

test("Ctrl+K фокусирует поиск, каретка не уезжает при наборе", async ({ page }) => {
  await upload(page, NC1812);
  await page.keyboard.press("Control+k");
  expect(await page.evaluate(() => document.activeElement.id)).toBe("searchInput");
  await page.keyboard.type("wire");
  await page.waitForTimeout(400);
  await page.keyboard.type("guard");
  await page.waitForTimeout(400);
  expect(await page.inputValue("#searchInput")).toBe("wireguard");
  expect(await page.evaluate(() => document.activeElement.selectionStart)).toBe(9);
});

test("индикатор фокуса виден на всех интерактивных элементах", async ({ page }) => {
  await upload(page, NC1812);
  for (const selector of [".tab", "#headerUpload", "[data-nav-category='all']", "#globalFileSelect"]) {
    const outline = await page.evaluate(target => {
      const element = document.querySelector(target);
      element.focus();
      const style = getComputedStyle(element);
      return `${style.outlineStyle} ${parseFloat(style.outlineWidth)}`;
    }, selector);
    expect(outline, selector).toMatch(/solid [1-9]/);
  }
});
