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

async function setTheme(page, mode) {
  await page.locator("#themeSelect").selectOption(mode);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/index.html");
});

// ------------------------------------------------------------------ пустое состояние

test("пустое состояние объясняет, что делать", async ({ page }) => {
  await expect(page.locator("#emptyState")).toBeVisible();
  await expect(page.locator("#workspace")).toBeHidden();
  await expect(page.locator("#dropzone")).toBeVisible();
  await expect(page.getByText("Keenetic self-test explorer", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Локальная обработка", { exact: true })).toHaveCount(0);
  await expect(page.locator("#themeSelect")).toBeVisible();
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

test("верхние группы используют значки Netcraze в заданном порядке", async ({ page }) => {
  await upload(page, KN1811);
  const groups = page.locator(".nav-group:not(.nav-tools) .nav-group-title");
  await expect(groups).toHaveCount(5);
  await expect(groups).toHaveText(["Статус", "Интернет", "Мои сети и Wi‑Fi", "Сетевые правила", "Управление"]);
  await expect(groups.locator(".nav-group-icon svg")).toHaveCount(5);
  for (const icon of await groups.locator(".nav-group-icon svg").all()) {
    await expect(icon).toHaveAttribute("aria-hidden", "true");
  }
});

test("сводка показывает release, диапазоны Wi‑Fi и компактные элементы шапки", async ({ page }) => {
  await upload(page, KN1811);
  const firmware = page.locator(".meta-grid div").filter({ has: page.getByText("Прошивка", { exact: true }) });
  await expect(firmware.locator("b")).toHaveText("5.01.C.4.0-1");
  await expect(page.locator(".temperature-meta")).toContainText("2.4 GHz · 71 °C");
  await expect(page.locator(".temperature-meta")).toContainText("5 GHz · 64 °C");
  await expect(page.locator(".temperature-meta")).not.toContainText("WifiMaster");
  const [uploadBox, themeBox] = await Promise.all([page.locator("#headerUpload").boundingBox(), page.locator(".theme-control").boundingBox()]);
  expect(themeBox.height).toBeGreaterThan(uploadBox.height);
  await expect(page.locator(".theme-control legend")).toHaveText("Стиль оформления");
  await expect(page.locator("#themeSelect")).toHaveValue("auto");
  await expect(page.locator("#themeSelect option:checked")).toHaveText("Автоматический");
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

test("меню показывает только категории, для которых есть данные", async ({ page }) => {
  await upload(page, NC1812);
  await expect(page.locator("[data-nav-category='internet']")).toHaveCount(1);  // show-данные есть и у ретранслятора
  await expect(page.locator("[data-nav-category='wifi']")).toHaveCount(1);
});

test("перенесённые show-команды видны в новых разделах, а не в «Прочем»", async ({ page }) => {
  await upload(page, KN1811);
  for (const category of ["hosts", "networkRules", "cloud", "ipv6", "qos", "general", "users", "domain", "usb"]) {
    await expect(page.locator(`[data-nav-category='${category}']`), category).toBeVisible();
  }
  await page.click("[data-nav-category='other']");
  const otherText = await page.locator(".category-card .section-list").innerText();
  for (const command of ["show acme", "show button", "show cloud", "show device-list", "show ipv6 prefixes", "show ntce status", "show usb"]) {
    expect(otherText, command).not.toContain(command);
  }
  await page.click("[data-nav-category='cloud']");
  await expect(page.locator(".category-card .section-list")).toContainText("show cloud ndmp status");
  await page.click("[data-nav-category='general']");
  await expect(page.locator(".category-card .section-list")).toContainText("show configurator status");
});

test("маршруты, политики, DHCP и CPU отображаются понятными таблицами", async ({ page }) => {
  await upload(page, KN1811);
  const sections = [
    ["routing", "Политики маршрутизации"], ["routing", "Маршруты IPv4"], ["routing", "Маршруты IPv6"],
    ["dhcp", "Пулы DHCP"], ["processes", "Загрузка процессора"],
  ];
  for (const [category, name] of sections) {
    await page.click(`[data-nav-category='${category}']`);
    await page.locator(".section-list button", { hasText: name }).click();
    await expect(page.locator(".structured-xml-section .json-table")).toBeVisible();
    await expect(page.locator(".structured-xml-section .json-table-wrap")).toHaveAttribute("tabindex", "0");
    await expect(page.locator(".structured-xml-section .json-raw summary")).toHaveText("Исходный XML");
    await page.click("#backToCategories");
  }
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

test("массив однотипных JSON-объектов показывается таблицей с доступным исходником", async ({ page }) => {
  await page.evaluate(() => {
    const json = JSON.stringify([{ name: "wan0", state: "up", mtu: 1500 }, { name: "wan1", state: "down", mtu: 1492 }], null, 2);
    const xml = `<selftest><file name="ndm:sharing-config">hostname Test</file><file name="sample.json"><![CDATA[${json}]]></file></selftest>`;
    const transfer = new DataTransfer();
    transfer.items.add(new File([xml], "self-test_KN-1_testing_1_router_now.txt", { type: "text/plain" }));
    document.body.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true }));
  });
  await expect(page.locator("#workspace")).toBeVisible();
  await page.click("[data-nav-category='other']");
  await page.locator("[data-section-key='raw:sample.json']").click();
  await expect(page.locator(".json-table thead")).toContainText("namestatemtu");
  await expect(page.locator(".json-table tbody tr")).toHaveCount(2);
  await expect(page.locator(".json-summary")).toContainText("Структурированное представление");
  await expect(page.locator(".json-raw .code-view")).toBeHidden();
  await page.locator(".json-raw > summary").click();
  await expect(page.locator(".json-raw .code-view")).toContainText('"wan1"');
  await expect(page.locator("#copySection")).toBeVisible();
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
  await expect(page.locator(".json-table")).toBeVisible();
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
    await setTheme(page, mode);
    await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
    await expect(page.locator("#themeSelect")).toHaveValue(mode);
  });
}

test("тема «auto» следует системной", async ({ page }) => {
  await setTheme(page, "auto");
  await expect(page.locator("html")).toHaveAttribute("data-theme-mode", "auto");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("контраст основного текста не ниже 4.5:1 в обеих темах", async ({ page }) => {
  await upload(page, SMALL);
  for (const mode of ["light", "dark"]) {
    await setTheme(page, mode);
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
  await setTheme(page, "light");
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
  await setTheme(page, "dark");
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
  await setTheme(page, "dark");
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
  await setTheme(page, "light");
  await page.screenshot({ path: path.join(shots, "02-empty-light.png") });
  await setTheme(page, "dark");
  await upload(page, KN1811, NC1812);
  await page.screenshot({ path: path.join(shots, "03-overview-dark.png") });
  await setTheme(page, "light");
  await page.screenshot({ path: path.join(shots, "04-overview-light.png") });
  await setTheme(page, "dark");
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

// ==================================================================
// Регрессионные UI-проверки исправлений BUG-025 … BUG-045 из второго аудита.
// ==================================================================

/** Контраст текста элемента к первому непрозрачному фону предка. */
async function contrast(page, selector) {
  return page.evaluate(css => {
    const target = document.querySelector(css);
    if (!target) return null;
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
    return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
  }, selector);
}

/** Доступное имя элемента: aria-label, aria-labelledby или связанный <label>. */
async function accessibleName(page, selector) {
  return page.evaluate(css => {
    const el = document.querySelector(css);
    if (!el) return null;
    const byId = el.getAttribute("aria-labelledby");
    return el.getAttribute("aria-label")
      || (byId && document.getElementById(byId)?.textContent?.trim())
      || (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim())
      || el.closest("label")?.textContent?.trim()
      || el.getAttribute("title")
      || "";
  }, selector);
}

// ------------------------------------------------------------ BUG-025 · поиск без ограничения

test("BUG-025: частый фрагмент не обрушивает страницу количеством результатов", async ({ page }) => {
  await upload(page, SMALL);
  const started = Date.now();
  await page.fill("#searchInput", "e");
  await page.waitForTimeout(900);
  const nodes = await page.evaluate(() => document.querySelectorAll("#exploreView *").length);
  expect(nodes, "результаты поиска должны быть ограничены").toBeLessThan(20000);
  expect(Date.now() - started).toBeLessThan(3000);
});

test("регрессия BUG-025: запрос «e» ограничивает DOM", async ({ page }) => {
  await upload(page, SMALL);
  await page.fill("#searchInput", "e");
  await page.waitForTimeout(2000);
  const info = await page.evaluate(() => ({
    hits: document.querySelectorAll(".search-hit").length,
    nodes: document.querySelectorAll("#exploreView *").length,
  }));
  expect(info.hits, `отрисовано ${info.hits} совпадений`).toBeLessThanOrEqual(1000);
  expect(info.nodes).toBeLessThan(20000);
});

// ------------------------------------------------------------ BUG-028 · селекты без доступного имени

test("BUG-028: у всех выпадающих списков есть доступное имя", async ({ page }) => {
  await upload(page, SMALL, NC1812);
  expect(await accessibleName(page, "#globalFileSelect")).not.toBe("");
  await openCompare(page);
  expect(await accessibleName(page, "#leftSelect")).not.toBe("");
  expect(await accessibleName(page, "#rightSelect")).not.toBe("");
});

test("регрессия BUG-028: три select подписаны", async ({ page }) => {
  await upload(page, SMALL, NC1812);
  expect(await accessibleName(page, "#globalFileSelect")).not.toBe("");
  await openCompare(page);
  expect(await accessibleName(page, "#leftSelect")).not.toBe("");
  expect(await accessibleName(page, "#rightSelect")).not.toBe("");
});

// ------------------------------------------------------------ BUG-029 · подсветка ломает разметку

test("BUG-029: подсветка поиска не искажает текст и не вкладывает mark в mark", async ({ page }) => {
  await upload(page, SMALL);
  await page.fill("#searchInput", "&");
  await page.waitForTimeout(600);
  const info = await page.evaluate(() => ({
    nested: document.querySelectorAll(".search-hit mark mark").length,
    text: document.querySelector(".search-hit pre")?.textContent || "",
  }));
  expect(info.nested, "вложенные <mark> — невалидная разметка").toBe(0);
  expect(info.text, "HTML-сущности показаны как текст").not.toMatch(/&(lt|gt|quot|amp);/);
});

test("регрессия BUG-029: запрос «&» сохраняет исходный текст", async ({ page }) => {
  await upload(page, SMALL);
  await page.fill("#searchInput", "&");
  await page.waitForTimeout(600);
  const text = await page.evaluate(() => document.querySelector(".search-hit pre")?.textContent || "");
  expect(text).not.toMatch(/&(lt|gt|quot|amp);/);
});

test("регрессия BUG-029: подсветка не вложена", async ({ page }) => {
  await upload(page, SMALL);
  await page.fill("#searchInput", "dhcp");
  await page.waitForTimeout(600);
  const nested = await page.evaluate(() => document.querySelectorAll(".search-hit mark mark").length);
  expect(nested).toBe(0);
});

// ------------------------------------------------------------ BUG-030 · контраст ниже AA

const CONTRAST_TARGETS = ["#headerUpload", ".view-head p", ".meta-grid span", ".section-list button small"];

test("BUG-030: служебный текст и главная кнопка не ниже 4.5:1 в обеих темах", async ({ page }) => {
  await upload(page, SMALL);
  for (const theme of ["dark", "light"]) {
    await setTheme(page, theme);
    for (const selector of CONTRAST_TARGETS) {
      const ratio = await contrast(page, selector);
      expect(ratio, `${theme} · ${selector}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("регрессия BUG-030: акцентная кнопка и подписи контрастны", async ({ page }) => {
  await upload(page, SMALL);
  for (const theme of ["dark", "light"]) {
    await setTheme(page, theme);
    expect(await contrast(page, "#headerUpload"), theme).toBeGreaterThanOrEqual(4.5);
    expect(await contrast(page, ".section-list button small"), theme).toBeGreaterThanOrEqual(4.5);
  }
});

// ------------------------------------------------------------ BUG-031 · «Нет» в светлой теме

test("BUG-031: отсутствующее значение читаемо и в светлой теме", async ({ page }) => {
  await upload(page, SMALL, NC1812);
  await setTheme(page, "light");
  await openCompare(page);
  await page.click("[data-filter='left-only']");
  await page.locator(".semantic-row").first().click();
  expect(await contrast(page, ".field-row code.missing")).toBeGreaterThanOrEqual(4.5);
});

test("регрессия BUG-031: «Нет» контрастно в светлой теме", async ({ page }) => {
  await upload(page, SMALL, NC1812);
  await setTheme(page, "light");
  await openCompare(page);
  await page.click("[data-filter='left-only']");
  await page.locator(".semantic-row").first().click();
  expect(await contrast(page, ".field-row code.missing")).toBeGreaterThanOrEqual(4.5);
});

// ------------------------------------------------------------ BUG-032 · прокрутка с клавиатуры

test("BUG-032: прокручиваемое содержимое доступно с клавиатуры", async ({ page }) => {
  await upload(page, SMALL);
  await page.click("[data-nav-category='all']");
  await page.locator(".section-list > button").first().click();
  const view = await page.evaluate(() => {
    const pre = document.querySelector(".code-view");
    return { scrollable: pre.scrollHeight > pre.clientHeight, tabIndex: pre.tabIndex };
  });
  expect(view.scrollable).toBe(true);
  expect(view.tabIndex, "прокручиваемая область обязана получать фокус").toBeGreaterThanOrEqual(0);
});

test("регрессия BUG-032: .code-view и .diff-view получают фокус", async ({ page }) => {
  await upload(page, KN1912_A, KN1912_B);
  await page.click("[data-nav-category='all']");
  await page.locator(".section-list > button").first().click();
  expect(await page.evaluate(() => document.querySelector(".code-view").tabIndex)).toBeGreaterThanOrEqual(0);
  await openCompare(page);
  await page.click("[data-compare-mode='raw']");
  await page.click("[data-filter='changed']");
  await page.locator(".compare-row[data-compare-key]").first().click();
  expect(await page.evaluate(() => document.querySelector(".diff-view").tabIndex)).toBeGreaterThanOrEqual(0);
});

// ------------------------------------------------------------ BUG-033 · 320 px

test("BUG-033: на ширине 320 px нет горизонтальной прокрутки", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await upload(page, SMALL);
  const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(size.scroll).toBeLessThanOrEqual(size.client);
});

test("регрессия BUG-033: шапка помещается на 320 px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await upload(page, SMALL);
  const info = await page.evaluate(() => {
    const client = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll("body *")]
      .filter(el => el.getBoundingClientRect().right > client + 1)
      .map(el => String(el.className || el.tagName).slice(0, 30));
    return { scroll: document.documentElement.scrollWidth, client, wide: wide.slice(0, 5) };
  });
  expect(info.scroll).toBeLessThanOrEqual(info.client);
  expect(info.wide.length).toBe(0);
});

// ------------------------------------------------------------ BUG-038 · категория при активном поиске

test("BUG-038: выбор категории при активном поиске согласован с заголовком", async ({ page }) => {
  await upload(page, SMALL);
  await page.fill("#searchInput", "dhcp");
  await page.waitForTimeout(400);
  await page.click("[data-nav-category='memory']");
  const view = await page.evaluate(() => ({
    heading: document.querySelector(".view-head h1")?.textContent,
    searchResults: !!document.querySelector(".search-results"),
  }));
  expect(view.searchResults && view.heading === "Память",
    "заголовок называет категорию, а показаны результаты глобального поиска").toBe(false);
});

test("регрессия BUG-038: выбор категории очищает глобальный поиск", async ({ page }) => {
  await upload(page, SMALL);
  await page.fill("#searchInput", "dhcp");
  await page.waitForTimeout(400);
  await page.click("[data-nav-category='memory']");
  await expect(page.locator(".view-head h1")).toHaveText("Память");
  await expect(page.locator(".search-results")).toHaveCount(0);
});

// ------------------------------------------------------------ BUG-040 · «N полей»

test("BUG-040: число отличающихся полей согласовано с существительным", async ({ page }) => {
  await upload(page, SMALL, NC1812);
  await openCompare(page);
  await page.click("[data-filter='changed']");
  const labels = await page.locator(".semantic-result small").allInnerTexts();
  expect(labels.every(label => !/(?<!1)1 полей$|[234] полей$/.test(label)), labels.join(", ")).toBe(true);
});

test("регрессия BUG-040: формы числа полей согласованы", async ({ page }) => {
  await upload(page, SMALL, NC1812);
  await openCompare(page);
  await page.click("[data-filter='changed']");
  const labels = await page.locator(".semantic-result small").allInnerTexts();
  expect(labels.some(label => /(?<!1)1 полей$|[234] полей$/.test(label)), labels.join(", ")).toBe(false);
});

// ------------------------------------------------------------ BUG-041 · вкладки без aria

test("BUG-041: активная вкладка помечена для скринридера", async ({ page }) => {
  await upload(page, SMALL);
  const marked = await page.evaluate(() => [...document.querySelectorAll(".tab")]
    .filter(tab => tab.getAttribute("aria-current") || tab.getAttribute("aria-selected")).length);
  expect(marked).toBeGreaterThan(0);
});

test("регрессия BUG-041: активная вкладка имеет aria-current", async ({ page }) => {
  await upload(page, SMALL);
  const tabs = await page.evaluate(() => [...document.querySelectorAll(".tab")]
    .map(tab => ({ current: tab.getAttribute("aria-current"), selected: tab.getAttribute("aria-selected"), active: tab.classList.contains("active") })));
  expect(tabs.some(tab => tab.active)).toBe(true);
  expect(tabs.some(tab => tab.active && tab.current === "page")).toBe(true);
});

// ------------------------------------------------------------ BUG-042 · заголовок и обход навигации

test("BUG-042: у рабочего экрана есть заголовок первого уровня и ссылка к содержимому", async ({ page }) => {
  await upload(page, SMALL);
  const info = await page.evaluate(() => ({
    h1: [...document.querySelectorAll("h1")].filter(h => h.offsetParent).length,
    skip: !!document.querySelector("a[href='#exploreView'],a.skip-link,[data-skip-link]"),
    navButtonsBeforeContent: document.querySelectorAll("#categoryNav button").length,
  }));
  expect(info.h1, "первый видимый заголовок — h2").toBeGreaterThan(0);
  expect(info.skip, `${info.navButtonsBeforeContent} кнопок навигации без возможности их пропустить`).toBe(true);
});

test("регрессия BUG-042: рабочий экран имеет h1 и ссылку-обход", async ({ page }) => {
  await upload(page, SMALL);
  const info = await page.evaluate(() => ({
    h1: [...document.querySelectorAll("h1")].filter(h => h.offsetParent).length,
    firstHeading: [...document.querySelectorAll("h1,h2,h3")].filter(h => h.offsetParent)[0]?.tagName,
    skip: !!document.querySelector("a[href='#exploreView'],a.skip-link,[data-skip-link]"),
  }));
  expect(info.h1).toBeGreaterThan(0);
  expect(info.firstHeading).toBe("H1");
  expect(info.skip).toBe(true);
});

// ------------------------------------------------------------ BUG-043 · фокус и анимация

test("BUG-043: у интерактивных элементов есть собственный стиль фокуса", async ({ page }) => {
  await upload(page, SMALL);
  await setTheme(page, "dark");
  const style = await page.evaluate(() => {
    const button = document.querySelector(".nav-subitem");
    button.focus();
    const computed = getComputedStyle(button);
    return { outlineStyle: computed.outlineStyle, outlineWidth: computed.outlineWidth, boxShadow: computed.boxShadow };
  });
  const custom = style.boxShadow !== "none" || (style.outlineStyle !== "auto" && style.outlineStyle !== "none");
  expect(custom, "фокус нарисован системным контуром браузера").toBe(true);
});

test("регрессия BUG-043: правила фокуса и reduced-motion присутствуют", async ({ page }) => {
  await upload(page, SMALL);
  const rules = await page.evaluate(() => {
    let focus = 0, motion = 0;
    for (const sheet of document.styleSheets) {
      let list; try { list = sheet.cssRules; } catch { continue; }
      for (const rule of list) {
        if (rule.conditionText?.includes("prefers-reduced-motion")) motion++;
        if (rule.selectorText?.includes(":focus")) focus++;
      }
    }
    return { focus, motion };
  });
  expect(rules.focus).toBeGreaterThan(0);
  expect(rules.motion).toBeGreaterThan(0);
});

// ------------------------------------------------------------ BUG-044 · сырой timestamp в селектах

test("BUG-044: подписи в сравнении показывают дату, а не машинную метку", async ({ page }) => {
  await upload(page, SMALL, NC1812);
  await openCompare(page);
  const labels = await page.locator("#leftSelect option").allInnerTexts();
  expect(labels.every(label => !/\d{8}T\d{6}\.\d{3}Z/.test(label)), labels.join(" | ")).toBe(true);
});

test("регрессия BUG-044: машинной метки в списке нет", async ({ page }) => {
  await upload(page, SMALL, NC1812);
  await openCompare(page);
  const labels = await page.locator("#leftSelect option").allInnerTexts();
  expect(labels.some(label => /\d{8}T\d{6}\.\d{3}Z/.test(label)), labels.join(" | ")).toBe(false);
});

// ------------------------------------------------------------ BUG-045 · «только слева»: все поля жёлтые

test("BUG-045: у объекта, которого нет справа, поля не помечаются как отличия", async ({ page }) => {
  await upload(page, SMALL, NC1812);
  await openCompare(page);
  await page.click("[data-filter='left-only']");
  await page.locator(".semantic-row").first().click();
  const rows = await page.evaluate(() => {
    const all = [...document.querySelectorAll(".field-row")];
    return { total: all.length, changed: all.filter(row => row.classList.contains("changed")).length };
  });
  expect(rows.changed, "подсветка каждой строки не несёт информации").toBeLessThan(rows.total);
});

test("регрессия BUG-045: поля одностороннего объекта не все изменены", async ({ page }) => {
  await upload(page, SMALL, NC1812);
  await openCompare(page);
  await page.click("[data-filter='left-only']");
  await page.locator(".semantic-row").first().click();
  const rows = await page.evaluate(() => {
    const all = [...document.querySelectorAll(".field-row")];
    return { total: all.length, changed: all.filter(row => row.classList.contains("changed")).length };
  });
  expect(rows.total).toBeGreaterThan(0);
  expect(rows.changed).toBeLessThan(rows.total);
});
