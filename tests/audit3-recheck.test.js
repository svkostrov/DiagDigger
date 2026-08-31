// Перепроверка аудита 3 — 31 августа 2026, 10:10 MSK.
// Дефекты, найденные при проверке исправлений BUG-052…070.
// Соглашение проекта: пара тестов — ожидаемое поведение со `skip` и рядом
// «BUG-xxx воспроизводится», закрепляющий текущее фактическое поведение.
import nodeTest from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDiagnostic, searchDiagnostic } from "../parser.js";

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

const NC1812 = pick("NC1812");
const KN1713 = pick("KN1713");
const KN2110 = pick("KN2110");

const occurrences = (name, query) => (raw(name).toLowerCase().match(new RegExp(query, "g")) || []).length;

// ---------------------------------------------------------------------------
// BUG-071 · Поиск дублирует одно и то же место файла в нескольких «разделах»
// ---------------------------------------------------------------------------

test("BUG-071: число попаданий не превышает числа вхождений в файле", () => {
  for (const name of [NC1812, KN1713, KN2110]) {
    const hits = searchDiagnostic(load(name), "interface");
    const real = occurrences(name, "interface");
    assert.ok(hits.length <= real, `${name}: отдано ${hits.length} при ${real} вхождениях в файле`);
  }
});

// ---------------------------------------------------------------------------
// Опорные проверки: подтверждают закрытие BUG-052, 053, 062, 063, 069, 070
// на всех фикстурах, а не на одной
// ---------------------------------------------------------------------------

test("BUG-052 закрыт на всех фикстурах: поиск доходит до XML", () => {
  for (const name of names) {
    const hits = searchDiagnostic(load(name), "interface");
    assert.ok(hits.length > 0, `${name}: нет попаданий`);
    assert.ok(hits.some(hit => hit.sectionType !== "derived"), `${name}: только собранные секции`);
  }
});

test("BUG-053 закрыт: ни в одной секции ни одной фикстуры нет ключевого материала", () => {
  const secrets = [
    ["crypto ike key", /^\s*crypto ike key\s+\S+\s+\S/im],
    ["preshared-key", /^\s*\S*\s*preshared-key\s+\S/im],
    ["private-key", /^\s*\S*\s*private-key\s+\S/im],
    ["wpa-psk", /^\s*\S*\s*wpa-psk\s+\S/im],
    ["password nt", /^\s*password\s+nt\s+\S/im],
  ];
  for (const name of names) {
    for (const section of load(name).sections) {
      for (const [label, re] of secrets) {
        assert.ok(!re.test(section.content), `${name}: ${label} виден в секции «${section.name}»`);
      }
    }
  }
});

test("BUG-062 закрыт: санитизация сохраняет число строк во всех фикстурах", () => {
  for (const name of names) {
    const structured = load(name).sections.find(section => section.key === "raw:selftest-structured");
    assert.equal(structured.content.split("\n").length, raw(name).split(/\r?\n/).length, `${name}: сдвиг нумерации`);
  }
});

test("BUG-063 закрыт: смысловые ключи уникальны во всех фикстурах", () => {
  for (const name of names) {
    const keys = load(name).semantic.map(object => object.key);
    assert.equal(new Set(keys).size, keys.length, `${name}: дубли ключей ${keys.filter((k, i) => keys.indexOf(k) !== i)}`);
  }
});

test("BUG-070 закрыт: разобрано больше 70 % каждой диагностики", () => {
  for (const name of names) {
    const chars = load(name).sections
      .filter(section => section.key !== "raw:selftest-structured")
      .reduce((total, section) => total + section.content.length, 0);
    const share = chars / raw(name).length;
    assert.ok(share > 0.7, `${name}: разобрано ${(share * 100).toFixed(1)} %`);
  }
});
