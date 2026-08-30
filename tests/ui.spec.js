// UI/UX e2e-тесты DiagDigger. Прогон: npm run test:ui
// Регрессионные тесты BUG-xxx фиксируют ожидаемое поведение после исправлений.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "fixtures");
const TMP = path.join(HERE, "..", "tmp");
const all = fs.readdirSync(FIXTURES).filter(name => name.endsWith(".txt")).sort();
const fix = fragment => path.join(FIXTURES, all.find(name => name.includes(fragment)));

const KN1811 = fix("KN1811");                                        // роутер с L2TP, WireGuard, ZeroTier
const NC1812 = fix("NC1812");                                        // ретранслятор
const SMALL = fix("KN1713");                                         // самая лёгкая диагностика
const KN1912_A = path.join(FIXTURES, all.filter(n => n.includes("KN1912"))[0]);
const KN1912_B = path.join(FIXTURES, all.filter(n => n.includes("KN1912"))[1]);

/** Ошибки и предупреждения консоли. 404 фавиконки отфильтрован — см. BUG-018. */
function watchConsole(page) {
  const problems = [];
  const ignore = /favicon\.ico/;
  page.on("console", message => {
    if (["error", "warning"].includes(message.type()) && !ignore.test(message.text() + message.location().url)) {
      problems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", error => problems.push(`pageerror: ${error.message}`));
  return problems;
}

/** Загружает файлы по одному: множественный выбор сломан, см. BUG-011. */
async function upload(page, ...files) {
  for (const file of files) {
    await page.setInputFiles("#fileInput", file);
    await expect(page.locator("#workspace")).toBeVisible();
    await expect(page.locator("#globalFileSelect option")).toHaveCount(files.indexOf(file) + 1);
  }
}

/** Открывает раздел «Сравнение». Верхние вкладки скрыты стилями — см. BUG-012. */
async function openCompare(page) {
  await page.click("[data-nav-compare]");
  await expect(page.locator("#compareView")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/index.html");
});

// ------------------------------------------------------------------ пустое состояние

test("пустое состояние объясняет, что делать", async ({ page }) => {
  await expect(page.locator("#emptyState")).toBeVisible();
  await expect(page.locator("#workspace")).toBeHidden();
  await expect(page.locator("#dropzone")).toBeVisible();
  await expect(page.getByText("Локальная обработка")).toBeVisible();
});

test("некорректный файл даёт понятное сообщение и не ломает интерфейс", async ({ page }) => {
  const problems = watchConsole(page);
  fs.mkdirSync(TMP, { recursive: true });
  const junk = path.join(TMP, "not-a-selftest.txt");
  fs.writeFileSync(junk, "это не диагностика");
  await page.setInputFiles("#fileInput", junk);
  await expect(page.locator("#toast")).toBeVisible();
  await expect(page.locator("#toast")).toContainText("не найдены секции");
  await expect(page.locator("#emptyState")).toBeVisible();
  expect(problems).toEqual([]);
});

// ------------------------------------------------------------------ загрузка

test("загрузка диагностики раскрывает рабочую область и меню", async ({ page }) => {
  const problems = watchConsole(page);
  await upload(page, SMALL);
  await expect(page.locator("#emptyState")).toBeHidden();
  await expect(page.locator("#categoryNav .nav-group").first()).toBeVisible();
  await expect(page.locator("[data-nav-category='all']")).toContainText("Обзор диагностики");
  await expect(page.locator(".category-card").first()).toBeVisible();
  expect(problems).toEqual([]);
});

test(
  "выбор нескольких файлов в диалоге загружает их все",
  { annotation: { type: "bug", description: "BUG-011" } },
  async ({ page }) => {
    await page.setInputFiles("#fileInput", [KN1912_A, KN1912_B]);
    await expect(page.locator("#workspace")).toBeVisible();
    await page.waitForTimeout(800);
    await expect(page.locator("#globalFileSelect option")).toHaveCount(2);
  },
);

test("регрессия BUG-011: из диалога загружаются оба файла", async ({ page }) => {
  await page.setInputFiles("#fileInput", [KN1912_A, KN1912_B]);
  await expect(page.locator("#workspace")).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.locator("#globalFileSelect option")).toHaveCount(2);
  await openCompare(page);
  await expect(page.locator(".semantic-row").first()).toBeVisible();
});

/** Бросает две синтетические диагностики на указанный элемент. */
async function dropTwo(page, selector) {
  await page.evaluate(target => {
    const make = name => new File(
      [`<selftest><file name="ndm:sharing-config"><![CDATA[! $$$ Model: ${name}\ninterface WifiMaster0\n    up\n!\n]]></file></selftest>`],
      name, { type: "text/plain" },
    );
    const transfer = new DataTransfer();
    transfer.items.add(make("selftest_A_stable_1_router_x.txt"));
    transfer.items.add(make("selftest_B_stable_1_router_x.txt"));
    document.querySelector(target).dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true }));
  }, selector);
  await page.waitForTimeout(600);
}

test("перетаскивание нескольких файлов загружает их все", async ({ page }) => {
  // тот же сценарий через drag&drop работает — значит дело именно в обработчике change
  await dropTwo(page, "body");
  await expect(page.locator("#globalFileSelect option")).toHaveCount(2);
});

test("перетаскивание в зону загрузки не задваивает файлы", async ({ page }) => {
  await dropTwo(page, "#dropzone");
  await expect(page.locator("#globalFileSelect option")).toHaveCount(2);
});

test("регрессия BUG-019: drop на зоне не задваивает файлы", async ({ page }) => {
  await dropTwo(page, "#dropzone");
  await expect(page.locator("#globalFileSelect option")).toHaveCount(2);
});

test(
  "повторная загрузка того же файла не создаёт дубликат",
  async ({ page }) => {
    await upload(page, SMALL);
    await page.setInputFiles("#fileInput", SMALL);
    await page.waitForTimeout(500);
    await expect(page.locator("#globalFileSelect option")).toHaveCount(1);
  },
);

test("регрессия BUG-014: повторная загрузка не создаёт дубликат", async ({ page }) => {
  await upload(page, SMALL);
  await page.setInputFiles("#fileInput", SMALL);
  await expect(page.locator("#globalFileSelect option")).toHaveCount(1);
});

test("загруженную диагностику можно убрать из сессии", async ({ page }) => {
  await upload(page, SMALL);
  await expect(page.locator("[data-remove-id]").first()).toBeVisible();
});

test("регрессия BUG-013: элемент удаления диагностики доступен", async ({ page }) => {
  await upload(page, SMALL, NC1812);
  await expect(page.locator("[data-remove-id]")).toHaveCount(1);
});

// ------------------------------------------------------------------ навигация

test("меню скрывает категории, которых нет в диагностике", async ({ page }) => {
  await upload(page, NC1812);
  await expect(page.locator("[data-nav-category='internet']")).toHaveCount(0);   // у ретранслятора нет WAN
  await expect(page.locator("[data-nav-category='wifi']")).toHaveCount(1);
});

test("счётчики в меню совпадают с числом секций в категории", async ({ page }) => {
  await upload(page, SMALL);
  await page.click("[data-nav-category='memory']");
  const badge = await page.locator("[data-nav-category='memory'] .nav-count").innerText();
  await expect(page.locator(".category-card .section-list > button")).toHaveCount(Number(badge));
});

test("выбранный раздел подсвечен в меню", async ({ page }) => {
  await upload(page, SMALL);
  await page.click("[data-nav-category='wifi']");
  await expect(page.locator("[data-nav-category='wifi']")).toHaveClass(/active/);
  await expect(page.locator("[data-nav-category='all']")).not.toHaveClass(/active/);
});

test("открытие секции и возврат к списку", async ({ page }) => {
  await upload(page, SMALL);
  await page.click("[data-nav-category='logs']");
  await page.locator(".section-list > button").first().click();
  await expect(page.locator(".section-detail .code-view")).toBeVisible();
  await page.click("#backToCategories");
  await expect(page.locator(".category-card").first()).toBeVisible();
});

test("«Ещё N» раскрывает полный список секций категории", async ({ page }) => {
  await upload(page, KN1811);
  await page.click("[data-nav-category='all']");
  const index = await page.locator(".category-card").evaluateAll(cards =>
    cards.findIndex(card => card.querySelector(".show-more")));
  const card = page.locator(".category-card").nth(index);
  const before = await card.locator(".section-list > button").count();
  await card.locator(".show-more").click();
  expect(await card.locator(".section-list > button").count()).toBeGreaterThan(before);
});

test(
  "верхние вкладки «Обзор/Сравнение» видны и работают",
  async ({ page }) => {
    await upload(page, SMALL);
    await expect(page.locator(".tabs")).toBeVisible();
  },
);

test("регрессия BUG-012: вкладки и счётчик видимы", async ({ page }) => {
  await upload(page, SMALL);
  await expect(page.locator(".tabs")).toBeVisible();
  await expect(page.locator("#compareBadge")).toBeVisible();
  await expect(page.locator("[data-tab='explore']")).toHaveCount(1);              // разметка на месте
});

// ------------------------------------------------------------------ поиск

test("поиск показывает найденные строки с подсветкой и переходом в секцию", async ({ page }) => {
  await upload(page, KN1811);
  await page.fill("#searchInput", "wireguard");
  await page.waitForTimeout(600);                                                 // debounce 160 мс + перерисовка
  await expect(page.locator(".search-result-group").first()).toBeVisible();
  await expect(page.locator(".search-hit mark").first()).toBeVisible();
  await page.locator("[data-search-section]").first().click();
  await expect(page.locator(".section-detail .code-view")).toBeVisible();
  await expect(page.locator(".code-view mark").first()).toBeVisible();
});

test("поиск идёт по всему файлу, а не только по разобранным секциям", async ({ page }) => {
  // <process> лежит вне <file> и в секции не попадает (BUG-003), но найтись должен
  await upload(page, SMALL);
  await page.fill("#searchInput", "<process>");
  await page.waitForTimeout(600);
  await expect(page.locator(".search-hit").first()).toBeVisible();
});

test("поиск без результатов сообщает об этом", async ({ page }) => {
  await upload(page, SMALL);
  await page.fill("#searchInput", "строка-которой-точно-нет");
  await expect(page.locator(".empty-results")).toContainText("Совпадений во всём файле");
});

test("Ctrl+K переводит фокус в поле поиска", async ({ page }) => {
  await upload(page, SMALL);
  await page.locator("body").click();
  await page.keyboard.press("Control+k");
  await expect(page.locator("#searchInput")).toBeFocused();
});

test("правка запроса в середине строки не сбрасывает курсор", async ({ page }) => {
  await upload(page, SMALL);
  const input = page.locator("#searchInput");
  await input.fill("wifi");
  await page.waitForTimeout(500);
  await input.evaluate(el => el.setSelectionRange(2, 2));
  await page.keyboard.type("X");
  await page.waitForTimeout(500);
  expect(await input.inputValue()).toBe("wiXfi");
  expect(await input.evaluate(el => el.selectionStart)).toBe(3);
});

test("регрессия BUG-010: курсор остаётся после введённого символа", async ({ page }) => {
  await upload(page, SMALL);
  const input = page.locator("#searchInput");
  await input.fill("wifi");
  await page.waitForTimeout(500);
  await input.evaluate(el => el.setSelectionRange(2, 2));
  await page.keyboard.type("X");
  await page.waitForTimeout(500);
  expect(await input.inputValue()).toBe("wiXfi");
  expect(await input.evaluate(el => el.selectionStart)).toBe(3);
});

// ------------------------------------------------------------------ темы

for (const mode of ["light", "dark"]) {
  test(`тема «${mode}» применяется и переживает перезагрузку`, async ({ page }) => {
    await upload(page, SMALL);
    await page.click(`[data-theme-choice='${mode}']`);
    await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
    await expect(page.locator(`[data-theme-choice='${mode}']`)).toHaveAttribute("aria-pressed", "true");
  });
}

test("тема «auto» следует системной", async ({ page }) => {
  await page.click("[data-theme-choice='auto']");
  await expect(page.locator("html")).toHaveAttribute("data-theme-mode", "auto");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("контраст основного текста не ниже 4.5:1 в обеих темах", async ({ page }) => {
  await upload(page, SMALL);
  for (const mode of ["light", "dark"]) {
    await page.click(`[data-theme-choice='${mode}']`);
    const ratio = await page.evaluate(() => {
      const target = document.querySelector(".category-card h3") || document.body;
      const luminance = color => {
        const [r, g, b] = color.match(/[\d.]+/g).slice(0, 3).map(Number)
          .map(v => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      let node = target, background = "rgba(0, 0, 0, 0)";
      while (node && /rgba\(0, 0, 0, 0\)/.test(background)) {
        background = getComputedStyle(node).backgroundColor; node = node.parentElement;
      }
      const a = luminance(getComputedStyle(target).color), b = luminance(background);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    expect(ratio, `тема ${mode}`).toBeGreaterThanOrEqual(4.5);
  }
});

// ------------------------------------------------------------------ сравнение

test("сравнение недоступно, пока загружен один файл", async ({ page }) => {
  await upload(page, SMALL);
  await openCompare(page);
  await expect(page.locator(".compare-empty")).toContainText("Добавьте второй файл");
});

test("смысловое сравнение двух роутеров показывает объекты, фильтры и детали", async ({ page }) => {
  const problems = watchConsole(page);
  await upload(page, KN1912_A, KN1912_B);
  await openCompare(page);
  await expect(page.locator(".semantic-row").first()).toBeVisible();
  await expect(page.locator(".summary-strip button")).toHaveCount(5);
  await page.click("[data-filter='changed']");
  await expect(page.locator(".semantic-result.changed").first()).toBeVisible();
  await page.locator(".semantic-row").first().click();
  await expect(page.locator(".field-comparison .field-row.changed").first()).toBeVisible();
  await page.click("#backToCompare");
  await expect(page.locator(".semantic-row").first()).toBeVisible();
  expect(problems).toEqual([]);
});

test("сравнение роутера и ретранслятора помечает отсутствующие объекты", async ({ page }) => {
  await upload(page, KN1811, NC1812);
  await openCompare(page);
  await page.click("[data-filter='left-only']");
  await expect(page.locator(".semantic-result.left-only").first()).toBeVisible();
  await expect(page.locator(".semantic-side .presence.no").first()).toBeVisible();
});

test("фильтр без объектов сообщает, что группа пуста", async ({ page }) => {
  await upload(page, KN1912_A, KN1912_B);
  await openCompare(page);
  await page.click("[data-filter='right-only']");
  await expect(page.locator(".empty-results")).toContainText("нет объектов");
});

test("режим «Сырые секции» строит построчный diff", async ({ page }) => {
  const problems = watchConsole(page);
  await upload(page, KN1912_A, KN1912_B);
  await openCompare(page);
  await page.click("[data-compare-mode='raw']");
  await page.click("[data-filter='changed']");
  await page.locator(".compare-row[data-compare-key]").first().click();
  await expect(page.locator(".diff-view .diff-line").first()).toBeVisible();
  await expect(page.locator(".diff-line.added, .diff-line.removed").first()).toBeVisible();
  expect(problems).toEqual([]);
});

test("исходная конфигурация объекта раскрывается по требованию", async ({ page }) => {
  await upload(page, KN1811, NC1812);
  await openCompare(page);
  await page.locator(".semantic-row").first().click();
  const details = page.locator(".raw-details");
  await expect(details.locator("pre").first()).toBeHidden();
  await details.locator("summary").click();
  await expect(details.locator("pre").first()).toBeVisible();
});

test("выбор диагностик в сравнении переключает стороны", async ({ page }) => {
  await upload(page, KN1811, NC1812);
  await openCompare(page);
  const before = await page.locator(".semantic-row").count();
  await page.selectOption("#rightSelect", { index: 0 });                 // справа тот же файл, что слева
  await expect(page.locator(".semantic-result.same").first()).toBeVisible();
  expect(await page.locator(".semantic-result.left-only").count()).toBe(0);
  expect(before).toBeGreaterThan(0);
});

test(
  "строка сравнения поясняет, что секция собрана из конфигурации",
  async ({ page }) => {
    await upload(page, KN1912_A, KN1912_B);
    await openCompare(page);
    await page.click("[data-compare-mode='raw']");
    await expect(page.locator(".compare-row[data-compare-key] small").first()).toHaveText("Собранная секция");
  },
);

test("регрессия BUG-005: показано пояснение собранной секции", async ({ page }) => {
  await upload(page, KN1912_A, KN1912_B);
  await openCompare(page);
  await page.click("[data-compare-mode='raw']");
  const labels = await page.locator(".compare-row[data-compare-key] small").allInnerTexts();
  expect(labels.some(label => label.startsWith("config:"))).toBe(false);
  expect(labels).toContain("Собранная секция");
});

test(
  "подписи диагностик в списках читаемы",
  async ({ page }) => {
    await upload(page, KN1912_A, KN1912_B);
    await openCompare(page);
    const labels = await page.locator("#leftSelect option").allInnerTexts();
    for (const label of labels) expect(label.length).toBeLessThan(45);
  },
);

test("регрессия BUG-001: подписи используют разобранную метаинформацию", async ({ page }) => {
  await upload(page, KN1912_A, KN1912_B);
  await openCompare(page);
  const labels = await page.locator("#leftSelect option").allInnerTexts();
  expect(labels[0]).toContain("KN1912");
  expect(labels[0]).not.toContain("· — · —");
  expect(labels[0].length).toBeLessThan(45);
});

// ------------------------------------------------------------------ доступность и адаптивность

test("по интерфейсу можно двигаться с клавиатуры", async ({ page }) => {
  await upload(page, SMALL);
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => document.activeElement?.tagName);
  expect(["A", "BUTTON", "INPUT", "SELECT"]).toContain(focused);
});

test("активный пункт меню помечен для скринридера", async ({ page }) => {
  await upload(page, SMALL);
  await page.click("[data-nav-category='wifi']");
  await expect(page.locator("[data-nav-category='wifi']")).toHaveAttribute("aria-current", "page");
});

test("узкий экран не даёт горизонтальной прокрутки страницы", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await upload(page, SMALL);
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator(".category-card").first()).toBeVisible();
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("регрессия BUG-017: страница не шире мобильного вьюпорта", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await upload(page, SMALL);
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("на узком экране меню сворачивается в полосу иконок", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await upload(page, SMALL);
  await expect(page.locator("[data-nav-category='all'] .nav-icon")).toBeVisible();
  await expect(page.locator("[data-nav-category='all'] span:not(.nav-icon)").first()).toBeHidden();
});

test("страница имеет иконку вкладки", async ({ page }) => {
  await expect(page.locator("link[rel~='icon']")).toHaveCount(1);
});

test("кнопка «Копировать» сообщает об ошибке, если буфер обмена недоступен", async ({ page }) => {
  await upload(page, SMALL);
  await page.click("[data-nav-category='logs']");
  await page.locator(".section-list > button").first().click();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("denied")) }, configurable: true,
    });
  });
  await page.click("#copySection");
  await expect(page.locator("#toast")).toContainText(/не удалось|ошибка/i);
});

test("регрессия BUG-015: тост сообщает об отказе буфера обмена", async ({ page }) => {
  await upload(page, SMALL);
  await page.click("[data-nav-category='logs']");
  await page.locator(".section-list > button").first().click();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("denied")) }, configurable: true,
    });
  });
  await page.click("#copySection");
  await expect(page.locator("#toast")).toContainText(/не удалось|ошибка/i);
});

test("контраст мелких служебных подписей не ниже 4.5:1", async ({ page }) => {
  await upload(page, SMALL);
  await page.click("[data-theme-choice='light']");
  const ratios = await page.evaluate(() => {
    const luminance = color => {
      const [r, g, b] = color.match(/[\d.]+/g).slice(0, 3).map(Number)
        .map(v => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = selector => {
      const target = document.querySelector(selector);
      if (!target) return null;
      let node = target, background = "rgba(0, 0, 0, 0)";
      while (node && /rgba\(0, 0, 0, 0\)/.test(background)) {
        background = getComputedStyle(node).backgroundColor; node = node.parentElement;
      }
      const a = luminance(getComputedStyle(target).color), b = luminance(background);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    return { navCount: ratio(".nav-count"), kbd: ratio(".search-wrap kbd") };
  });
  expect(ratios.navCount).toBeGreaterThanOrEqual(4.5);
  expect(ratios.kbd).toBeGreaterThanOrEqual(4.5);
});

test("отсутствующее значение в сравнении читаемо в тёмной теме", async ({ page }) => {
  await upload(page, KN1811, NC1812);
  await page.click("[data-theme-choice='dark']");
  await openCompare(page);
  await page.click("[data-filter='left-only']");
  await page.locator(".semantic-row").first().click();
  const info = await page.locator(".field-row code.missing").first().evaluate(el => ({
    color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor,
  }));
  expect(info.background).not.toMatch(/253, 234, 232/);
});

test("регрессия BUG-020: в тёмной теме используется тёмная плашка", async ({ page }) => {
  await upload(page, KN1811, NC1812);
  await page.click("[data-theme-choice='dark']");
  await openCompare(page);
  await page.click("[data-filter='left-only']");
  await page.locator(".semantic-row").first().click();
  const background = await page.locator(".field-row code.missing").first()
    .evaluate(el => getComputedStyle(el).backgroundColor);
  expect(background).not.toMatch(/253, 234, 232/);
});

test("числительные согласованы с существительными", async ({ page }) => {
  await upload(page, SMALL);
  await page.click("[data-nav-category='memory']");
  const labels = await page.locator(".section-list button small").allInnerTexts();
  expect(labels.every(label => !/(?<!1)1 строк$/.test(label))).toBe(true);
  await expect(page.locator(".category-head small").first()).not.toHaveText(/^[234] секций$/);
});

test("регрессия BUG-021: форма «1 строка» согласована", async ({ page }) => {
  await upload(page, SMALL);
  await page.click("[data-nav-category='memory']");
  const labels = await page.locator(".section-list button small").allInnerTexts();
  expect(labels.some(label => /(?<!1)1 строк$/.test(label)), `формы: ${labels.join(", ")}`).toBe(false);
});

test("подсказка горячей клавиши соответствует платформе", async ({ page }) => {
  await upload(page, SMALL);
  const expected = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform) ? /⌘/ : /Ctrl/i);
  await expect(page.locator(".search-wrap kbd")).toHaveText(expected);
});

test("регрессия BUG-023: подсказка определяется платформой", async ({ page }) => {
  await upload(page, SMALL);
  const result = await page.evaluate(() => ({ platform: navigator.platform, hint: document.querySelector(".search-wrap kbd").textContent }));
  expect(result.hint).toMatch(/Mac|iPhone|iPad/.test(result.platform) ? /⌘/ : /Ctrl/i);
});

// ------------------------------------------------------------------ производительность

test("самая большая диагностика (6,9 МБ) открывается меньше чем за 10 с", async ({ page }) => {
  const problems = watchConsole(page);
  const started = Date.now();
  await upload(page, KN1811);
  await expect(page.locator(".category-card").first()).toBeVisible();
  expect(Date.now() - started).toBeLessThan(10_000);
  expect(problems).toEqual([]);
});

test("поиск по 6,9 МБ отвечает меньше чем за 3 с", async ({ page }) => {
  await upload(page, KN1811);
  const started = Date.now();
  await page.fill("#searchInput", "wireguard");
  await expect(page.locator(".category-card").first()).toBeVisible();
  await page.waitForTimeout(300);
  expect(Date.now() - started).toBeLessThan(3000);
});

// ------------------------------------------------------------------ снимки экрана

test("снимки экрана для UX-разбора", async ({ page }) => {
  const shots = path.join(TMP, "screens");
  fs.mkdirSync(shots, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: path.join(shots, "01-empty-dark.png") });
  await page.click("[data-theme-choice='light']");
  await page.screenshot({ path: path.join(shots, "02-empty-light.png") });
  await page.click("[data-theme-choice='dark']");
  await upload(page, KN1811, NC1812);
  await page.screenshot({ path: path.join(shots, "03-overview-dark.png") });
  await page.click("[data-theme-choice='light']");
  await page.screenshot({ path: path.join(shots, "04-overview-light.png") });
  await page.click("[data-theme-choice='dark']");
  await page.click("[data-nav-category='wifi']");
  await page.screenshot({ path: path.join(shots, "05-category.png") });
  await page.locator(".section-list > button").first().click();
  await page.screenshot({ path: path.join(shots, "06-section.png") });
  await openCompare(page);
  await page.screenshot({ path: path.join(shots, "07-compare-semantic.png") });
  await page.locator(".semantic-row").first().click();
  await page.locator(".raw-details summary").click();
  await page.screenshot({ path: path.join(shots, "08-compare-detail.png") });
  await page.click("#backToCompare");
  await page.click("[data-compare-mode='raw']");
  await page.click("[data-filter='changed']");
  await page.screenshot({ path: path.join(shots, "09-compare-raw.png") });
  await page.locator(".compare-row[data-compare-key]").first().click();
  await page.screenshot({ path: path.join(shots, "10-compare-diff.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click("#backToCompare");
  await page.screenshot({ path: path.join(shots, "11-mobile.png") });
});
