// Аудит 3 — дефекты парсера и логики, найденные 31 августа 2026.
// Регрессионные тесты исправленных дефектов парсера и логики из аудита 3.
import nodeTest from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFiles, parseDiagnostic, searchDiagnostic } from "../parser.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const hasFixtures = fs.existsSync(FIXTURES);
const names = hasFixtures ? fs.readdirSync(FIXTURES).filter(name => name.endsWith(".txt")).sort() : [];
const test = hasFixtures ? nodeTest : nodeTest.skip;

const textCache = new Map();
const parsedCache = new Map();
const pick = fragment => names.find(name => name.includes(fragment));
function raw(name) {
  if (!textCache.has(name)) textCache.set(name, fs.readFileSync(path.join(FIXTURES, name), "utf8"));
  return textCache.get(name);
}
function load(name) {
  if (!parsedCache.has(name)) parsedCache.set(name, parseDiagnostic(name, raw(name)));
  return parsedCache.get(name);
}

const KN1811 = pick("KN1811");
const KN1621 = pick("KN1621");
const KN2110 = pick("KN2110");
const NC1812 = pick("NC1812");

// ---------------------------------------------------------------------------
// BUG-052 · Поиск не выходит за пределы собранных секций конфигурации
// ---------------------------------------------------------------------------

test("BUG-052: поиск находит совпадения и в XML диагностики, а не только в собранных секциях", () => {
  const diagnostic = load(KN1621);
  const hits = searchDiagnostic(diagnostic, "interface");
  const types = new Set(hits.map(hit => hit.sectionType));
  assert.ok(types.size > 1, `ожидались попадания разных типов, получены только ${[...types]}`);
  assert.ok(hits.some(hit => hit.sectionType !== "derived"), "ни одного попадания вне собранных секций");
});

// ---------------------------------------------------------------------------
// BUG-053 · `crypto ike key` не санитизируется
// ---------------------------------------------------------------------------

const IKE_KEY = /^\s*crypto ike key\s+\S+\s+\S/im;

test("BUG-053: общий ключ IPsec не попадает в секции", () => {
  for (const name of names) {
    for (const section of load(name).sections) {
      assert.ok(!IKE_KEY.test(section.content), `${name}: ключ IPsec виден в секции «${section.name}»`);
    }
  }
});

// ---------------------------------------------------------------------------
// BUG-062 · Номера строк в поиске сдвинуты относительно файла
// ---------------------------------------------------------------------------

test("BUG-062: номер строки в результате поиска совпадает с номером в исходном файле", () => {
  const text = raw(KN1811);
  const lines = text.split(/\r?\n/);
  const structured = load(KN1811).sections.find(section => section.key === "raw:selftest-structured");
  assert.equal(structured.content.split("\n").length, lines.length);
});

// ---------------------------------------------------------------------------
// BUG-063 · Bridge с `ip global` порождает два смысловых объекта
// ---------------------------------------------------------------------------

test("BUG-063: один интерфейс представлен одним смысловым объектом", () => {
  const semantic = load(KN2110).semantic;
  const bridges = semantic.filter(object => /^bridge:/.test(object.key)).map(object => object.key.split(":")[1]);
  for (const index of bridges) {
    assert.ok(
      !semantic.some(object => object.key === `internet:bridge${index}`),
      `Bridge${index} присутствует и как сегмент, и как интернет-подключение`,
    );
  }
});

// ---------------------------------------------------------------------------
// BUG-069 · Полный текст санитизируется повторно на каждом шаге
// ---------------------------------------------------------------------------

test("BUG-069: повторный поиск по той же диагностике не пересчитывает санитизацию заново", () => {
  const diagnostic = load(KN1811);
  searchDiagnostic(diagnostic, "wireguard");
  const started = performance.now();
  searchDiagnostic(diagnostic, "wireguard");
  assert.ok(performance.now() - started < 10, "повторный поиск должен идти по подготовленным данным");
});

// ---------------------------------------------------------------------------
// BUG-070 · Доля разобранного содержимого остаётся низкой
// ---------------------------------------------------------------------------

const extractedShare = name => {
  const diagnostic = load(name);
  const chars = diagnostic.sections
    .filter(section => section.key !== "raw:selftest-structured")
    .reduce((total, section) => total + section.content.length, 0);
  return chars / raw(name).length;
};

test("BUG-070: разбирается больше половины содержимого каждой диагностики", () => {
  for (const name of names) {
    const share = extractedShare(name);
    assert.ok(share > 0.5, `${name}: разобрано ${(share * 100).toFixed(1)} %`);
  }
});

// ---------------------------------------------------------------------------
// Опорные проверки, которые не должны сломаться при исправлениях выше
// ---------------------------------------------------------------------------

test("извлечение секций <file> устойчиво на всех фикстурах", () => {
  for (const name of names) {
    const files = extractFiles(raw(name));
    assert.ok(files.length > 20, `${name}: извлечено всего ${files.length} секций <file>`);
    assert.ok(files.every(file => file.name && typeof file.content === "string"));
  }
});

test("ошибки сбора <error> выделены в отдельную секцию", () => {
  for (const name of names) {
    const diagnostic = load(name);
    const hasErrorNodes = /<error\b[^>]*>[^<]/i.test(raw(name));
    const section = diagnostic.sections.find(item => item.key === "derived:collection-errors");
    if (hasErrorNodes) assert.ok(section, `${name}: есть узлы <error>, но нет секции «Ошибки сбора диагностики»`);
  }
});
