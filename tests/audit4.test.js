// Аудит 4 — 31 августа 2026. Юнит-часть.
//
// Проверка BUG-001…072 по коду плюс аудит функциональности, добавленной после
// `bugfixed.md`: структурированное представление JSON, перераспределение
// `show`-разделов, выбор темы, показ версии.
//
// Актуализирован 20.10.2026: проверяется исправленное поведение.
// Исторические воспроизведения сохранены в неизменяемом bugreport.md.
import nodeTest from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDiagnostic, searchDiagnostic } from "../parser.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "fixtures");
const hasFixtures = fs.existsSync(FIXTURES);
const names = hasFixtures ? fs.readdirSync(FIXTURES).filter(name => name.endsWith(".txt")).sort() : [];
const test = nodeTest;
const pick = fragment => names.find(name => name.includes(fragment));

const parsedCache = new Map();
function load(name) {
  if (!parsedCache.has(name)) parsedCache.set(name, parseDiagnostic(name, fs.readFileSync(path.join(FIXTURES, name), "utf8")));
  return parsedCache.get(name);
}

const SYNTHETIC_NAME = "selftest_TEST_stable_5.01.C.9.99_router_20260831T120000.000Z.txt";

/** Диагностика с датчиком температуры: секция «Температура» строится приложением,
 *  её текста в исходном файле нет. */
const withTemperature = `<selftest>
<!-- show interface -->
<response><interface name="WifiMaster0"><temperature>64</temperature></interface><interface name="WifiMaster1"><temperature>88</temperature></interface></response>
<file name="ndm:sharing-config">
interface Bridge0
    description Home network
    up
!
</file>
</selftest>`;

/** Диагностика с ключевым материалом, который прошивка НЕ замаскировала.
 *  Значения синтетические. */
const withKeyMaterial = `<selftest>
<file name="ndm:sharing-config">
interface Bridge0
    iapp key SyntheticIappKeyValue01
    ft iapp key SyntheticFtIappKeyValue02
!
mws wlan Home
    wpa psk SyntheticWpaPskValue03
!
crypto ike key SyntheticPeer SyntheticIkeKeyValue04
interface Wireguard0
    wireguard private-key SyntheticPrivateKeyValue05
!
</file>
</selftest>`;

// ── BUG-074 · Содержимое производных секций не находится поиском ───────────────

test("BUG-074: поиск находит значение, которое есть только в производной секции", () => {
  const diagnostic = parseDiagnostic(SYNTHETIC_NAME, withTemperature);
  const section = diagnostic.sections.find(item => item.key === "derived:temperatures");
  assert.ok(section, "секция «Температура» должна быть собрана");
  assert.match(section.content, /88 °C/);
  assert.ok(searchDiagnostic(diagnostic, "88 °C").length > 0, "«88 °C» видно в интерфейсе — поиск обязан его находить");
  assert.ok(searchDiagnostic(diagnostic, "°C").length > 0);
  assert.ok(searchDiagnostic(diagnostic, "GHz").length > 0);
});

test("BUG-074: поиск находит температуры реальных диагностик", t => {
  let checked = 0;
  for (const name of names) {
    const diagnostic = load(name);
    const section = diagnostic.sections.find(item => item.key === "derived:temperatures");
    if (!section) continue;
    checked++;
    assert.match(section.content, /°C/);
    assert.ok(searchDiagnostic(diagnostic, "°C").length > 0);
  }
  if (!checked) t.skip("В локальных fixtures нет датчиков температуры");
});

// ── BUG-079 · Санитизация повторяется на каждой секции и на полном тексте ──────

/** Считает суммарный объём, пропущенный через `sanitizeRaw` за один разбор. */
async function measureSanitize(text) {
  const source = fs.readFileSync(path.join(HERE, "..", "parser.js"), "utf8");
  assert.ok(source.includes("const sanitizeRaw = raw =>"), "форма объявления sanitizeRaw изменилась — обновить измерение");
  const counter = "globalThis.__audit4San = { calls: 0, bytes: 0 };\nconst sanitizeRaw = raw => (globalThis.__audit4San.calls++, globalThis.__audit4San.bytes += String(raw || '').length, 0) ||";
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "audit4-")), "parser.mjs");
  fs.writeFileSync(file, source.replace("const sanitizeRaw = raw =>", counter));
  const module = await import(`file://${file}`);
  globalThis.__audit4San = { calls: 0, bytes: 0 };
  try {
    const diagnostic = module.parseDiagnostic(SYNTHETIC_NAME, text);
    const measured = globalThis.__audit4San;
    return { ratio: measured.bytes / text.length, calls: measured.calls, sections: diagnostic.sections.length };
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
    delete globalThis.__audit4San;
  }
}

test("BUG-079: разбор не санитизирует одни и те же данные повторно", async () => {
  const name = pick("KN1811") || names[0];
  const text = fs.readFileSync(path.join(FIXTURES, name), "utf8");
  const { ratio, calls, sections } = await measureSanitize(text);
  assert.ok(ratio <= 2.2, `через sanitizeRaw прошло ${ratio.toFixed(2)}× размера файла (${calls} вызовов на ${sections} секций); ожидается не больше 2,2×`);
});

// ── BUG-087 · Управление доступом разложено по трём категориям ─────────────────

const ACCESS_CONTROL = ["show ip http lockout-policy", "show ip telnet lockout-policy", "show ssh fingerprint", "show authentication session", "show ip http config-errors"];

function showCategories(diagnostic) {
  return new Map(diagnostic.sections.filter(item => item.source === "show").map(item => [item.name, item.category]));
}

test("BUG-087: show-команды управления доступом попадают в «Пользователи и доступ»", () => {
  const markers = ACCESS_CONTROL.map(command => `<!-- ${command} --><response><ok>yes</ok></response>`).join("\n");
  const found = showCategories(parseDiagnostic(SYNTHETIC_NAME, `<selftest>${markers}<file name="ndm:sharing-config">system\n!</file></selftest>`));
  assert.equal(found.size, ACCESS_CONTROL.length);
  for (const [command, category] of found) {
    assert.equal(category, "users", command);
  }
});

// ── BUG-088 · Чёрный список sanitizeRaw остаётся неполным ─────────────────────
// На восьми доступных диагностиках утечки нет: прошивка сама заменяет значения
// `iapp key`, `ft iapp key` и `wpa psk` на восемь звёзд. Приложение на это
// полагаться не может — список команд, которые маскирует прошивка, ему неизвестен.

const UNMASKED = [
  ["iapp key", /SyntheticIappKeyValue01/],
  ["ft iapp key", /SyntheticFtIappKeyValue02/],
  ["wpa psk", /SyntheticWpaPskValue03/],
  ["crypto ike key", /SyntheticIkeKeyValue04/],
  ["wireguard private-key", /SyntheticPrivateKeyValue05/],
];

test("BUG-088: приложение само скрывает ключевой материал, а не полагается на прошивку", () => {
  const diagnostic = parseDiagnostic(SYNTHETIC_NAME, withKeyMaterial);
  const shown = diagnostic.sections.map(item => item.content).join("\n") + "\n" + diagnostic.searchText + "\n" + JSON.stringify(diagnostic.semantic);
  for (const [command, value] of UNMASKED) {
    assert.doesNotMatch(shown, value, `значение «${command}» видно в интерфейсе`);
  }
});

test("BUG-088: ключи из исходных fixtures отсутствуют в доступных представлениях", t => {
  const pattern = /^\s*(?:ft\s+)?iapp\s+key\s+(.+)$|^\s*wpa\s+psk\s+(.+)$/gmi;
  let checked = 0;
  for (const name of names) {
    const source = fs.readFileSync(path.join(FIXTURES, name), "utf8");
    const values = [...source.matchAll(pattern)].map(match => (match[1] || match[2]).trim());
    checked += values.length;
    const diagnostic = load(name);
    const shown = diagnostic.sections.map(item => item.content).join("\n") + "\n" + diagnostic.searchText + "\n" + JSON.stringify(diagnostic.semantic);
    // Наличие команд проверяется в источнике: санитизация удаляет их из вывода.
    assert.equal([...shown.matchAll(pattern)].length, 0, "команда с ключом осталась в выводе");
    for (const value of values.filter(value => !/^\*+$/.test(value))) {
      assert.ok(!shown.includes(value), "исходное значение ключа осталось в выводе");
    }
  }
  if (!checked) t.skip("В локальных fixtures нет IAPP/WPA-команд; форматы проверены синтетическим тестом");
});

// ── Регрессии: подтверждение того, что закрыто ────────────────────────────────

test("BUG-052/071 остаются закрытыми: выдача поиска совпадает с числом вхождений", () => {
  for (const fragment of ["NC1812", "KN1713", "KN1811"]) {
    const name = pick(fragment);
    if (!name) continue;
    const diagnostic = load(name);
    for (const needle of ["interface", "Bridge0", "mws", "show"]) {
      const lower = diagnostic.searchText.toLowerCase(), target = needle.toLowerCase();
      let real = 0, from = 0;
      while ((from = lower.indexOf(target, from)) !== -1) { real++; from += target.length; }
      const hits = searchDiagnostic(diagnostic, needle);
      if (hits.length >= 1000) continue;
      assert.equal(hits.length, real, `${name}: «${needle}» — выдано ${hits.length}, в файле ${real}`);
    }
  }
});

test("BUG-050/049 остаются закрытыми: ключи и имена секций не сталкиваются", () => {
  for (const name of names) {
    const diagnostic = load(name);
    const keys = new Set(), pairs = new Set();
    for (const section of diagnostic.sections) {
      assert.ok(!keys.has(section.key), `${name}: повтор ключа ${section.key}`);
      keys.add(section.key);
      const pair = `${section.category}\0${section.name}`;
      assert.ok(!pairs.has(pair), `${name}: «${section.name}» дважды в категории ${section.category}`);
      pairs.add(pair);
    }
  }
});

test("новое: JSON-представление включается только для валидного JSON-объекта", () => {
  for (const name of names) {
    for (const section of load(name).sections.filter(item => item.presentation === "json")) {
      const value = JSON.parse(section.content);
      assert.ok(value !== null && typeof value === "object", `${name}: ${section.name}`);
    }
  }
});
