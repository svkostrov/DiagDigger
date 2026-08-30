// Тесты парсера на реальных диагностиках из tests/fixtures/.
// Регрессионные тесты BUG-xxx фиксируют ожидаемое поведение после исправлений.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATEGORY_INFO, compareSections, compareSemantic, extractFiles,
  groupSections, lineDiff, parseDiagnostic, parseFilename,
} from "../parser.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const names = fs.readdirSync(FIXTURES).filter(name => name.endsWith(".txt")).sort();

const cache = new Map();
function load(name) {
  if (!cache.has(name)) {
    const text = fs.readFileSync(path.join(FIXTURES, name), "utf8");
    cache.set(name, parseDiagnostic(name, text));
  }
  return cache.get(name);
}
const pick = fragment => names.find(name => name.includes(fragment));

const KN1811 = pick("KN1811");            // router, 6,9 МБ, L2TP + 3×WireGuard + ZeroTier
const KN1912_A = names.filter(n => n.includes("KN1912"))[0];
const KN1912_B = names.filter(n => n.includes("KN1912"))[1];
const NC1812 = pick("NC1812");            // extender, роль без WAN
const KN2110 = pick("KN2110");            // nightly, часы не выставлены (1970)

test("в наборе фикстур есть все опорные случаи", () => {
  assert.equal(names.length, 8, "ожидается 8 диагностик в tests/fixtures/");
  assert.ok(KN1811 && KN1912_A && KN1912_B && NC1812 && KN2110);
  assert.ok(names.some(n => n.includes("_extender_")), "нужен хотя бы один ретранслятор");
  assert.ok(names.some(n => n.includes("_router_")), "нужен хотя бы один роутер");
});

// ---------------------------------------------------------------- базовый разбор

test("каждая диагностика разбирается без исключения", () => {
  for (const name of names) {
    const diagnostic = load(name);
    assert.ok(diagnostic.sections.length > 0, `${name}: нет секций`);
    assert.ok(diagnostic.semantic.length > 0, `${name}: нет смысловых объектов`);
    assert.ok(diagnostic.text.length > 0);
  }
});

test("модель и hostname извлекаются из ndm:sharing-config", () => {
  for (const name of names) {
    const { meta } = load(name);
    assert.notEqual(meta.model, "—", `${name}: не определена модель`);
    assert.notEqual(meta.hostname, "—", `${name}: не определён hostname`);
  }
});

test("каждая секция попадает в известную категорию", () => {
  for (const name of names) {
    for (const section of load(name).sections) {
      assert.ok(CATEGORY_INFO[section.category], `${name}: неизвестная категория ${section.category}`);
    }
  }
});

test("ndm:sharing-config всегда разложен на смысловые группы", () => {
  for (const name of names) {
    const virtual = load(name).sections.filter(section => section.virtual);
    assert.ok(virtual.length >= 3, `${name}: конфигурация не разбита (${virtual.length} групп)`);
    assert.ok(virtual.some(section => section.name === "Wi‑Fi и точки доступа"));
  }
});

test("ключи секций уникальны внутри одной диагностики", () => {
  for (const name of names) {
    const keys = load(name).sections.map(section => section.key);
    assert.equal(new Set(keys).size, keys.length, `${name}: дублирующиеся ключи секций`);
  }
});

test("ключи смысловых объектов уникальны внутри одной диагностики", () => {
  for (const name of names) {
    const keys = load(name).semantic.map(object => object.key);
    assert.equal(new Set(keys).size, keys.length, `${name}: дублирующиеся ключи объектов`);
  }
});

test("роль extender не даёт WAN-подключений, роль router даёт", () => {
  assert.equal(load(NC1812).semantic.filter(o => o.key.startsWith("internet:")).length, 0);
  assert.ok(load(KN1811).semantic.some(o => o.key.startsWith("internet:")));
});

test("KN1811: разобраны все туннели из конфигурации", () => {
  const keys = load(KN1811).semantic.map(o => o.key);
  for (const expected of ["l2tp:0", "wireguard:1", "wireguard:3", "wireguard:5", "zerotier:0"]) {
    assert.ok(keys.includes(expected), `не найден объект ${expected}`);
  }
});

test("Wi-Fi диапазоны определяются по WifiMaster", () => {
  for (const name of names) {
    const bands = load(name).semantic.filter(o => o.key.startsWith("wifi:")).map(o => o.key);
    assert.ok(bands.some(k => k.startsWith("wifi:2,4 ГГц")), `${name}: нет 2,4 ГГц`);
    assert.ok(bands.some(k => k.startsWith("wifi:5 ГГц")), `${name}: нет 5 ГГц`);
  }
});

// ---------------------------------------------------------------- имя файла и мета

test(
  "parseFilename понимает реальный формат имени self-test",
  () => {
    const meta = parseFilename("selftest_KN1811_stable_5.01.C.4.01_router_20260830T173511.961Z.txt");
    assert.equal(meta.device, "KN1811");
    assert.equal(meta.channel, "stable");
    assert.equal(meta.version, "5.01.C.4.01");
    assert.equal(meta.role, "router");
    assert.equal(meta.timestamp, "20260830T173511.961Z");
  },
);

test(
  "мета реальной диагностики содержит устройство, канал, версию и роль",
  () => {
    const { meta } = load(KN1811);
    assert.equal(meta.device, "KN1811");
    assert.equal(meta.role, "router");
    assert.equal(meta.version, "5.01.C.4.01");
  },
);

test("регрессия BUG-001: имя файла не подставляется вместо кода устройства", () => {
  const { meta } = load(KN1811);
  assert.equal(meta.device, "KN1811");
  assert.equal(meta.version, "5.01.C.4.01");
  assert.equal(meta.role, "router");
});

test(
  "две диагностики одной модели и прошивки не считаются разными устройствами",
  () => {
    const row = compareSemantic(load(KN1912_A), load(KN1912_B)).find(r => r.key === "system:device");
    assert.equal(row.status, "same");
  },
);

test("регрессия BUG-002: одинаковые модели не различаются по timestamp", () => {
  const row = compareSemantic(load(KN1912_A), load(KN1912_B)).find(r => r.key === "system:device");
  assert.equal(row.status, "same");
  const device = row.fields.find(f => f.name === "Код устройства");
  assert.equal(device.changed, false);
});

test(
  "часы устройства не выставлены (1970) — метка времени всё равно читается",
  () => {
    assert.equal(load(KN2110).meta.timestamp, "19700101T061022.403Z");
  },
);

// ---------------------------------------------------------------- полнота извлечения

test(
  "self-test содержит не только <file>: остальные данные не теряются",
  () => {
    for (const name of names) {
      const diagnostic = load(name);
      const extracted = diagnostic.sections
        .filter(section => !section.virtual)
        .reduce((sum, section) => sum + section.content.length, 0);
      const ratio = extracted / diagnostic.text.length;
      assert.ok(ratio > 0.6, `${name}: извлечено только ${(ratio * 100).toFixed(1)}% содержимого`);
    }
  },
);

test("регрессия BUG-003: структурированные XML-данные сохранены в секциях", () => {
  const diagnostic = load(KN1811);
  const extracted = diagnostic.sections
    .filter(section => !section.virtual)
    .reduce((sum, section) => sum + section.content.length, 0);
  assert.ok(extracted / diagnostic.text.length > 0.6);
  assert.match(diagnostic.text, /<process>/);
  assert.ok(diagnostic.sections.some(section => section.content.includes("<process>")));
});

test(
  "сообщения <error> из self-test видны пользователю",
  () => {
    const diagnostic = load(NC1812);
    assert.match(diagnostic.text, /<error>file not found/);
    assert.ok(
      diagnostic.sections.some(section => section.content.includes("file not found")),
      "не собрано ни одной записи об ошибках сбора",
    );
  },
);

// ---------------------------------------------------------------- сравнение

test("сравнение секций различает все четыре состояния", () => {
  const rows = compareSections(load(KN1811), load(NC1812));
  const statuses = new Set(rows.map(row => row.status));
  for (const expected of ["same", "changed", "left-only", "right-only"]) {
    assert.ok(statuses.has(expected), `нет состояния ${expected}`);
  }
});

test("смысловое сравнение router vs extender показывает отсутствующие объекты", () => {
  const rows = compareSemantic(load(KN1811), load(NC1812));
  const wan = rows.find(row => row.key.startsWith("internet:"));
  assert.equal(wan.status, "left-only");
  const tunnels = rows.filter(row => /^(l2tp|wireguard|zerotier):/.test(row.key));
  assert.ok(tunnels.length >= 5);
  assert.ok(tunnels.every(row => row.status === "left-only"));
});

test("сравнение самой с собой не даёт ни одного отличия", () => {
  for (const name of names) {
    const diagnostic = load(name);
    assert.ok(compareSemantic(diagnostic, diagnostic).every(row => row.status === "same"), `${name}: объекты`);
    assert.ok(compareSections(diagnostic, diagnostic).every(row => row.status === "same"), `${name}: секции`);
  }
});

test("отсутствующая сторона отображается как «Нет», а не пустым значением", () => {
  const row = compareSemantic(load(KN1811), load(NC1812)).find(r => r.key === "l2tp:0");
  assert.equal(row.status, "left-only");
  assert.ok(row.fields.every(field => field.right === "Нет"));
});

test(
  "сравнение секций сообщает, собрана ли секция из конфигурации",
  () => {
    const row = compareSections(load(KN1811), load(NC1812)).find(r => r.name === "Wi‑Fi и точки доступа");
    assert.equal(row.virtual, true);
  },
);

test("регрессия BUG-005: флаг virtual сохраняется при сравнении", () => {
  const row = compareSections(load(KN1811), load(NC1812)).find(r => r.name === "Wi‑Fi и точки доступа");
  assert.equal(row.left.virtual, true);
  assert.equal(row.virtual, true);
});

test(
  "переименование WAN-интерфейса не ломает сопоставление объектов",
  async () => {
    const { extractSemanticConfig } = await import("../parser.js");
    const wan = rename => `interface GigabitEthernet1\n    rename ${rename}\n    description "Broadband connection"\n    ip address dhcp\n    ip global 700\n    up\n!`;
    const left = { semantic: extractSemanticConfig(wan("ISP")) };
    const right = { semantic: extractSemanticConfig(wan("Provider")) };
    const rows = compareSemantic(left, right).filter(row => row.key.startsWith("internet:"));
    assert.equal(rows.length, 1, "один и тот же WAN распался на два объекта");
    assert.equal(rows[0].status, "same");
  },
);

// ---------------------------------------------------------------- секреты

test("ключи и пароли не попадают в поля смыслового сравнения", () => {
  for (const name of names) {
    for (const object of load(name).semantic) {
      const dump = JSON.stringify(object.fields);
      assert.doesNotMatch(dump, /preshared-key|private-key|password/i, `${name}/${object.key}`);
      assert.doesNotMatch(dump, /[A-Za-z0-9+/]{42}=/, `${name}/${object.key}: похоже на ключ base64`);
    }
  }
});

test(
  "исходный блок объекта не содержит ключевого материала",
  () => {
    for (const object of load(KN1811).semantic) {
      assert.doesNotMatch(object.raw, /preshared-key\s+\S/i, object.key);
    }
  },
);

test("регрессия BUG-007: ключевой материал отсутствует в raw", () => {
  const server = load(KN1811).semantic.find(object => object.key === "wireguard:5");
  assert.doesNotMatch(server.raw, /preshared-key\s+\S+/i);
});

test(
  "у L2TP/PPTP/SSTP показывается имя пользователя подключения",
  () => {
    const l2tp = load(KN1811).semantic.find(object => object.key === "l2tp:0");
    assert.ok(l2tp.fields["Имя пользователя"], "имя пользователя не разобрано в смысловые поля");
    assert.doesNotMatch(l2tp.raw, /authentication identity/i, "имя пользователя не должно дублироваться в raw");
  },
);

// ---------------------------------------------------------------- устойчивость

test("файл без секций <file> даёт понятную ошибку", () => {
  assert.throws(() => parseDiagnostic("empty.txt", "<selftest></selftest>"), /не найдены секции/i);
  assert.throws(() => parseDiagnostic("plain.txt", "просто текст"), /не найдены секции/i);
});

test("обрезанный файл не роняет парсер", () => {
  const text = fs.readFileSync(path.join(FIXTURES, KN1912_A), "utf8").slice(0, 120_000);
  const diagnostic = parseDiagnostic("truncated.txt", text);
  assert.ok(diagnostic.sections.length > 0);
});

test("KN1811 не является валидным XML — парсер обязан работать на регулярных выражениях", () => {
  // в ndm:log встречается тег <_NDM_OGDN_4_@domain-list0>, который ломает XML-парсер
  assert.match(load(KN1811).text, /<_NDM_OGDN_4_@domain-list0>/);
  assert.ok(load(KN1811).sections.length > 0);
});

test("поиск по содержимому работает на реальном файле", () => {
  const diagnostic = load(KN1811);
  const found = groupSections(diagnostic, "wireguard");
  assert.ok(found.length > 0);
  const nothing = groupSections(diagnostic, "строка-которой-точно-нет-в-диагностике");
  assert.equal(nothing.length, 0);
});

test("extractFiles не теряет секции: число открывающих и закрывающих тегов совпадает", () => {
  for (const name of names) {
    const text = load(name).text;
    const opens = (text.match(/<file\s+name=/g) || []).length;
    assert.equal(extractFiles(text).length, opens, `${name}: извлечено не всё`);
  }
});

// ---------------------------------------------------------------- производительность

test("разбор самой большой диагностики укладывается в 3 с", () => {
  const text = fs.readFileSync(path.join(FIXTURES, KN1811), "utf8");
  const started = Date.now();
  parseDiagnostic(KN1811, text);
  const spent = Date.now() - started;
  assert.ok(spent < 3000, `разбор занял ${spent} мс`);
});

test("построчное сравнение больших логов не зависает и не съедает память", () => {
  const left = load(KN1811).sections.find(section => section.name === "ndm:log");
  const right = load(NC1812).sections.find(section => section.name === "ndm:log");
  const started = Date.now();
  const diff = lineDiff(left.content, right.content);
  const spent = Date.now() - started;
  assert.ok(diff.length > 0);
  assert.ok(spent < 5000, `сравнение заняло ${spent} мс`);
});

test(
  "построчное сравнение больших логов сохраняет порядок строк",
  () => {
    const left = load(KN1811).sections.find(section => section.name === "ndm:log");
    const right = load(NC1812).sections.find(section => section.name === "ndm:log");
    const diff = lineDiff(left.content, right.content);
    const removedAfterAdded = diff.findIndex(row => row.type === "added") <
      diff.map(row => row.type).lastIndexOf("removed");
    assert.ok(removedAfterAdded, "результат разбит на два монолитных блока — это не diff");
  },
);

test(
  "поле «Версия NDM» отражает версию прошивки, а не версию формата конфигурации",
  () => {
    const device = load(KN1811).semantic.find(object => object.key === "system:device");
    assert.notEqual(device.fields["Версия NDM"], "2.06.1");
  },
);

test("регрессия BUG-022: версии прошивки различаются между диагностиками", () => {
  const versions = new Set(names.map(name =>
    load(name).semantic.find(object => object.key === "system:device").fields["Версия NDM"]));
  assert.ok(versions.size > 1);
  assert.ok(!versions.has("2.06.1"));
});
