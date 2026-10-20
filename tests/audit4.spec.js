// Аудит 4 — 31 августа 2026. Интерфейсная часть. Прогон: npx playwright test tests/audit4.spec.js
//
// Сетка: 8 экранов × ширины 320/360/390/768/820/900/960/1024/1100/1200/1440 × две темы.
// Контраст и горизонтальная прокрутка на этой сетке оказались чистыми — BUG-054…056,
// BUG-061 (кроме переключателя режимов) и BUG-072 подтверждены закрытыми.
// Ниже — то, что сетка нашла нового.
//
// Актуализирован 20.10.2026: активны проверки исправленного поведения.
// Запускать точечно: npx playwright test tests/audit4.spec.js
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "fixtures");
const all = fs.readdirSync(FIXTURES).filter(name => name.endsWith(".txt")).sort();
const fix = fragment => path.join(FIXTURES, all.find(name => name.includes(fragment)));

const WIDTHS = [320, 360, 390, 768, 820, 900, 960, 1024, 1100, 1200, 1440];

async function upload(page, ...fragments) {
  await page.goto("/index.html");
  await page.setInputFiles("#fileInput", fragments.map(fix));
  await expect(page.locator("#workspace")).toBeVisible({ timeout: 60_000 });
}

/** Размеры интерактивных целей ниже 24×24 (WCAG 2.5.8). */
const TARGET_PROBE = () => {
  const out = [];
  for (const el of document.querySelectorAll('button, a[href], select, input, summary, [tabindex="0"]')) {
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") continue;
    if (rect.width < 23.5 || rect.height < 23.5) {
      const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).join(".") : "";
      out.push({ selector: el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (cls ? "." + cls : ""), text: (el.textContent || "").trim().slice(0, 30), width: +rect.width.toFixed(1), height: +rect.height.toFixed(1) });
    }
  }
  return out;
};

/** Прокручиваемые области, недостижимые с клавиатуры (WCAG 2.1.1). */
const SCROLLER_PROBE = () => {
  const out = [];
  for (const el of document.querySelectorAll("*")) {
    const style = getComputedStyle(el);
    const scrollsX = /(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1;
    const scrollsY = /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1;
    if (!scrollsX && !scrollsY) continue;
    if (el.tabIndex >= 0 || el.matches("input,select,textarea,button,a[href]")) continue;
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).join(".") : "";
    out.push({ selector: el.tagName.toLowerCase() + (cls ? "." + cls : ""), scrollsX, scrollsY, label: el.getAttribute("aria-label"), role: el.getAttribute("role") });
  }
  return out;
};

// ── BUG-073 · Приложение не работает без localStorage ─────────────────────────

async function blockStorage(page) {
  await page.addInitScript(() => {
    const boom = () => { throw new DOMException("The operation is insecure.", "SecurityError"); };
    Object.defineProperty(window, "localStorage", { configurable: true, get: boom });
  });
}

test("BUG-073: приложение работает, когда localStorage недоступен", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await blockStorage(page);
  await page.goto("/index.html");
  await page.setInputFiles("#fileInput", fix("KN1713"));
  await expect(page.locator("#workspace")).toBeVisible({ timeout: 20_000 });
  expect(errors, "необработанных исключений быть не должно").toEqual([]);
});

// ── BUG-075 · «Отменить» не возвращает файл в сравнение ───────────────────────

async function removeAndUndo(page) {
  await page.click("[data-nav-compare]");
  await page.click("#removeCurrentFile");
  await page.waitForTimeout(200);
  await page.click("#toast button");
  await page.waitForTimeout(400);
  return page.evaluate(() => ({
    files: document.querySelector("#compareBadge").textContent,
    left: document.querySelector("#leftSelect")?.value,
    right: document.querySelector("#rightSelect")?.value,
    changed: document.querySelector('[data-filter="changed"] b')?.textContent,
  }));
}

test("BUG-075: отмена удаления возвращает файл в сравнение", async ({ page }) => {
  await upload(page, "KN1713", "NC1812");
  const after = await removeAndUndo(page);
  expect(after.files).toBe("2");
  expect(after.left, "стороны сравнения должны быть разными файлами").not.toBe(after.right);
  expect(Number(after.changed), "у двух разных устройств есть отличия").toBeGreaterThan(0);
});

// ── BUG-076 · Действие «Отменить» недостижимо с клавиатуры ────────────────────

test("BUG-076: до кнопки «Отменить» можно дойти с клавиатуры", async ({ page }) => {
  await upload(page, "KN1713", "NC1812");
  await page.focus("#removeCurrentFile");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  let steps = 0;
  for (; steps < 12; steps++) {
    if (await page.evaluate(() => !!document.activeElement?.closest?.("#toast"))) break;
    await page.keyboard.press("Tab");
  }
  expect(steps, "действие отмены должно быть в начале порядка табуляции после удаления").toBeLessThan(12);
});

// ── BUG-077 · Переключатель режимов сравнения ниже 24×24 ─────────────────────

test("BUG-077: цели не меньше 24×24 на всей сетке ширин, включая сравнение", async ({ page }) => {
  await upload(page, "KN1713", "NC1812");
  await page.click("[data-nav-compare]");
  const bad = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(120);
    for (const item of await page.evaluate(TARGET_PROBE)) bad.push(`@${width}: ${item.selector} «${item.text}» ${item.width}×${item.height}`);
  }
  expect(bad, bad.join("\n")).toEqual([]);
});

// ── BUG-078 · Прокручиваемые области без клавиатурного доступа ────────────────

test("BUG-078: все прокручиваемые области доступны с клавиатуры", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await upload(page, "KN1811", "NC1812");
  await page.click("[data-nav-compare]");
  const keys = await page.evaluate(() => [...document.querySelectorAll("[data-compare-key]")].map(el => el.dataset.compareKey));
  const bad = [];
  for (const key of keys) {
    await page.click(`[data-compare-key="${key}"]`);
    const summary = page.locator(".raw-details summary");
    if (await summary.count()) { await summary.click(); await page.waitForTimeout(120);
      for (const item of await page.evaluate(SCROLLER_PROBE)) bad.push(`объект ${key}: ${JSON.stringify(item)}`); }
    await page.click("#backToCompare");
  }
  expect(bad, bad.join("\n")).toEqual([]);
});

// ── BUG-080, BUG-081 · Доступные имена в шапке ────────────────────────────────

test("BUG-080: aria-label стоит только на элементах, у которых есть роль", async ({ page }) => {
  await upload(page, "KN1713");
  const bad = await page.evaluate(() => [...document.querySelectorAll("[aria-label]")]
    .filter(el => !el.getAttribute("role") && !/^(a|button|input|select|textarea|summary|nav|main|header|footer|aside|section|form|table|dialog|img)$/.test(el.tagName.toLowerCase()))
    .map(el => ({ tag: el.tagName.toLowerCase(), cls: el.className, label: el.getAttribute("aria-label") })));
  expect(bad, JSON.stringify(bad)).toEqual([]);
});

test("BUG-081: у select не спорят видимая подпись и aria-label", async ({ page }) => {
  await upload(page, "KN1713");
  const clashes = await page.evaluate(() => [...document.querySelectorAll("select[aria-label]")].map(el => {
    const label = el.id ? document.querySelector(`label[for="${el.id}"]`) : null;
    const legend = el.closest("fieldset")?.querySelector("legend");
    const visible = (label || legend)?.textContent?.trim();
    return visible ? { id: el.id, aria: el.getAttribute("aria-label"), visible } : null;
  }).filter(Boolean));
  expect(clashes, JSON.stringify(clashes)).toEqual([]);
});

// ── BUG-082 · Мёртвые стили старого переключателя тем ─────────────────────────

test("BUG-082: в таблицах стилей нет правил для элементов, которых нет в разметке", async ({ page }) => {
  await page.goto("/index.html");
  const dead = await page.evaluate(() => {
    const rules = [];
    for (const sheet of document.styleSheets) {
      let list; try { list = sheet.cssRules; } catch { continue; }
      const walk = items => { for (const rule of items) { if (rule.selectorText) { if (rule.selectorText.includes(".theme-control button")) rules.push(rule.selectorText); } else if (rule.cssRules) walk(rule.cssRules); } };
      walk(list);
    }
    return { rules, inDom: document.querySelectorAll(".theme-control button").length };
  });
  expect(dead.inDom).toBe(0);
  expect(dead.rules, `мёртвые правила: ${dead.rules.join(" | ")}`).toEqual([]);
});

// ── BUG-083 · Ограничение ширины из ячейки таблицы применяется к секции ───────

test("BUG-083: раскрытый JSON-фрагмент занимает доступную ширину", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await upload(page, "KN1811");
  await page.click('[data-nav-category="diagnostics"]');
  await page.locator("[data-section-key]", { hasText: "mtdoops/ndm" }).first().click();
  await page.locator("details.json-cell-details summary").first().click();
  await page.waitForTimeout(200);
  const size = await page.evaluate(() => {
    const pre = document.querySelector("details.json-cell-details[open] pre");
    return { pre: +pre.getBoundingClientRect().width.toFixed(0), group: +pre.closest(".json-group").getBoundingClientRect().width.toFixed(0), inTable: !!pre.closest("table") };
  });
  const fragment = page.locator("details.json-cell-details[open] pre");
  await expect(fragment).toHaveAttribute("tabindex", "0");
  await expect(fragment).toHaveAttribute("role", "region");
  await expect(fragment).toHaveAttribute("aria-label", /.+/);
  await fragment.focus();
  await expect(fragment).toBeFocused();
  expect(size.inTable, "фрагмент раскрыт не в таблице").toBe(false);
  expect(size.pre, `${size.pre} px из доступных ${size.group}`).toBeGreaterThan(size.group * 0.8);
});

// ── BUG-084 · Пробельный запрос меняет наполнение карточек ────────────────────

async function cardLimit(page) {
  return page.evaluate(() => {
    const card = [...document.querySelectorAll(".category-card")].find(item => item.querySelector(".show-more"));
    return { shown: card?.querySelectorAll("[data-section-key]").length ?? null, searchResults: !!document.querySelector(".search-results") };
  });
}

test("BUG-084: запрос из пробелов не меняет наполнение карточек категорий", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await upload(page, "KN1811");
  const before = await cardLimit(page);
  await page.fill("#searchInput", "   ");
  await page.waitForTimeout(400);
  const after = await cardLimit(page);
  expect(after.searchResults, "поиск по пробелам не выполняется — это правильно").toBe(false);
  expect(after.shown).toBe(before.shown);
});

// ── BUG-085 · Ссылка «К содержимому» не переводит фокус ──────────────────────

test("BUG-085: активация skip-link переводит фокус на содержимое", async ({ page }) => {
  await upload(page, "KN1713");
  await page.evaluate(() => document.querySelector(".skip-link").focus());
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
  const active = await page.evaluate(() => ({ id: document.activeElement.id, tag: document.activeElement.tagName }));
  expect(active.id, `фокус на ${active.tag}#${active.id}`).toBe("exploreView");
});

// ── BUG-086 · Логотип ведёт на «#» ───────────────────────────────────────────

test("BUG-086: логотип не делает пустой переход", async ({ page }) => {
  await upload(page, "KN1713");
  const before = page.url();
  await page.click("a.brand");
  await page.waitForTimeout(200);
  expect(page.url()).toBe(before);
});

// ── Подтверждение закрытого: сетка ширин и контраст ──────────────────────────

test("BUG-054/055/072 остаются закрытыми: нет горизонтальной прокрутки на всей сетке", async ({ page }) => {
  test.setTimeout(240_000);
  await upload(page, "KN1713", "NC1812");
  const screens = [
    ["обзор", async () => {}],
    ["категория", async () => page.click('[data-nav-category="system"]')],
    ["поиск", async () => { await page.fill("#searchInput", "Bridge0"); await page.waitForTimeout(350); }],
    ["сравнение", async () => page.click("[data-nav-compare]")],
    ["сравнение сырое", async () => { await page.click("[data-nav-compare]"); await page.click('[data-compare-mode="raw"]'); }],
  ];
  const bad = [];
  for (const [name, act] of screens) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await upload(page, "KN1713", "NC1812");
    await act();
    await page.waitForTimeout(150);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(100);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) bad.push(`${name} @${width}: +${overflow} px`);
    }
  }
  expect(bad, bad.join("\n")).toEqual([]);
});

test("BUG-058 остаётся закрытым: фокус переносится после каждой перерисовки", async ({ page }) => {
  await upload(page, "KN1713", "NC1812");
  const steps = [
    ["категория", () => page.click('[data-nav-category="system"]'), /^H1$/],
    ["секция", () => page.locator("[data-section-key]").first().click(), /^H2$/],
    ["сравнение", () => page.click("[data-nav-compare]"), /^H1$/],
    ["объект", () => page.locator("[data-compare-key]").first().click(), /^H2$/],
  ];
  for (const [name, act, expected] of steps) {
    await act();
    await page.waitForTimeout(250);
    const tag = await page.evaluate(() => document.activeElement.tagName);
    expect(tag, `после «${name}» фокус на ${tag}`).toMatch(expected);
  }
});
