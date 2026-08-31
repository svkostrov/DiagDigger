// Тесты парсера на реальных диагностиках из tests/fixtures/.
// Регрессионные тесты BUG-xxx фиксируют ожидаемое поведение после исправлений.
import nodeTest from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATEGORY_INFO, compareSections, compareSemantic, extractFiles,
  groupSections, lineDiff, parseDiagnostic, parseFilename, searchDiagnostic,
} from "../parser.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const hasFixtures = fs.existsSync(FIXTURES);
const names = hasFixtures ? fs.readdirSync(FIXTURES).filter(name => name.endsWith(".txt")).sort() : [];
const test = hasFixtures ? nodeTest : nodeTest.skip;

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
    assert.equal(rows[0].status, "changed", "переименование видно как изменение, но ключ объекта остаётся стабильным");
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

// ==================================================================
// Регрессионные проверки исправлений BUG-025 … BUG-051 из второго аудита.
// ==================================================================

/** Синтетический конфиг: в реальных фикстурах ключевой материал уже обезличен устройством. */
const SECRET_CONFIG = `! $$$ Model: Keenetic Giga
! $$$ Version: 2.06.1
interface Wireguard0
    description HQ tunnel
    ip address 0.0.0.0 0.0.0.0
    wireguard private-key SECRETPRIVKEY_aaaaaaaaaaaaaaaaaaaaaaaa=
    wireguard peer PEERPUBKEY_bbbbbbbbbbbbbbbbbbbbbbbbbbbb=
        endpoint vpn.example.com:51820
        preshared-key PSKSECRET_cccccccccccccccccccccccc=
    !
    up
!
interface L2TP0
    description Office
    peer l2tp.example.com
    authentication identity operator
    authentication password SUPERSECRETPASS
    up
!
interface WifiMaster0/AccessPoint0
    ssid HomeNet
    authentication wpa-psk ODUwODM4NGE5MTk4YTA4YzYxMjIzMTIw
    encryption wpa2
    up
!
user admin
    password nt 8846f7eaee8fb117ad06bdd830b7586c
!
`;
const SECRETS = ["SECRETPRIVKEY", "SUPERSECRETPASS", "ODUwODM4NGE5MTk4YTA4YzYxMjIzMTIw", "8846f7eaee8fb117ad06bdd830b7586c"];
const wrap = config => `<selftest><file name="ndm:sharing-config"><![CDATA[\n${config}\n]]></file></selftest>`;
const synth = (config, name = "selftest_KN1010_stable_1.00.A.1.00_router_20260101T000000.000Z.txt") =>
  parseDiagnostic(name, wrap(config));

// ------------------------------------------------------------ BUG-025 · поиск без ограничения

test("BUG-025: результат поиска ограничен по размеру", () => {
  const diagnostic = load(KN2110);
  const hits = searchDiagnostic(diagnostic, "e");
  assert.ok(hits.length <= 1000, `однобуквенный запрос вернул ${hits.length} попаданий — интерфейс не выдержит отрисовки`);
});

test("регрессия BUG-025: однобуквенный запрос ограничен", () => {
  const hits = searchDiagnostic(load(KN2110), "e");
  assert.ok(hits.length <= 1000, `получено ${hits.length}`);
});

// ------------------------------------------------------------ BUG-026 · секреты в секциях

test("BUG-026: содержимое секций не содержит ключевого материала", () => {
  const diagnostic = synth(SECRET_CONFIG);
  for (const section of diagnostic.sections) {
    for (const secret of SECRETS) {
      assert.ok(!section.content.includes(secret), `${section.key} показывает ${secret}`);
    }
  }
});

test("регрессия BUG-026: секции санитизированы единообразно", () => {
  const diagnostic = synth(SECRET_CONFIG);
  const leaking = diagnostic.sections.filter(section => SECRETS.some(secret => section.content.includes(secret)));
  assert.equal(leaking.length, 0, `найдено секций с секретами: ${leaking.length}`);
});

// ------------------------------------------------------------ BUG-027 · неполный sanitizeRaw

test("BUG-027: raw смыслового объекта не содержит префиксных форм секретов", () => {
  const diagnostic = synth(SECRET_CONFIG);
  const raws = diagnostic.semantic.map(object => object.raw || "").join("\n");
  assert.ok(!raws.includes("SECRETPRIVKEY"), "wireguard private-key виден");
  assert.ok(!raws.includes("SUPERSECRETPASS"), "authentication password виден");
  assert.ok(!raws.includes("ODUwODM4NGE5MTk4YTA4YzYxMjIzMTIw"), "authentication wpa-psk виден");
});

test("регрессия BUG-027: sanitizeRaw закрывает префиксные формы", () => {
  const diagnostic = synth(SECRET_CONFIG);
  const raws = diagnostic.semantic.map(object => object.raw || "").join("\n");
  assert.ok(!raws.includes("PSKSECRET"), "preshared-key в начале строки должен сниматься");
  assert.ok(!raws.includes("SECRETPRIVKEY"), "wireguard private-key проходит фильтр");
  assert.ok(!raws.includes("SUPERSECRETPASS"), "authentication password проходит фильтр");
});

// ------------------------------------------------------------ BUG-034 · переименование не видно

const RENAME_LEFT = `! $$$ Model: Keenetic Giga
! $$$ Version: 2.06.1
interface GigabitEthernet0/Vlan2
    rename ISP
    description Broadband ISP
    ip global 700
    ip address dhcp
    up
!
`;
const RENAME_RIGHT = RENAME_LEFT.replace("rename ISP", "rename Provider").replace("Broadband ISP", "Broadband OTHER");

test("BUG-034: переименование подключения показывается как отличие", () => {
  const result = compareSemantic(synth(RENAME_LEFT), synth(RENAME_RIGHT))
    .find(item => item.key.startsWith("internet:"));
  assert.equal(result.status, "changed", "смена rename/description должна быть видна в сравнении");
});

test("регрессия BUG-034: разные имена подключения дают изменение", () => {
  const result = compareSemantic(synth(RENAME_LEFT), synth(RENAME_RIGHT))
    .find(item => item.key.startsWith("internet:"));
  assert.equal(result.status, "changed");
  assert.notEqual(result.left.title, result.right.title);
  assert.ok(result.fields.filter(field => field.changed).length > 0);
});

// ------------------------------------------------------------ BUG-035 · WAN на мосту

test("BUG-035: WAN, собранный на мосту, распознаётся как интернет-подключение", () => {
  const bridge = load(KN2110).semantic.find(object => object.key === "bridge:5");
  assert.equal(bridge?.fields["Роль подключения"], "Интернет", "WAN-факт должен сохраняться в единственном объекте Bridge5");
});

test("регрессия BUG-035: WAN на мосту есть в смысловых объектах", () => {
  const diagnostic = load(KN2110);
  const section = diagnostic.sections.find(item => item.key === "config:Интернет-подключения");
  assert.ok(section, "секция «Интернет-подключения» присутствует");
  assert.ok(/ip global/.test(section.content), "в секции есть `ip global`");
  assert.equal(diagnostic.semantic.find(object => object.key === "bridge:5")?.fields["Роль подключения"], "Интернет");
});

// ------------------------------------------------------------ BUG-036 · ключ Wi-Fi зависит от текста

const WIFI_LEFT = `! $$$ Model: Keenetic Giga
! $$$ Version: 2.06.1
interface WifiMaster0
    country-code RU
    compatibility BGN
    up
!
interface WifiMaster0/AccessPoint0
    rename AccessPoint
    ssid Home24
    encryption wpa2
    up
!
interface WifiMaster1
    country-code RU
    compatibility AC
    up
!
interface WifiMaster1/AccessPoint0
    rename AccessPoint_5G
    ssid Home5
    encryption wpa2
    up
!
`;
const WIFI_RIGHT = WIFI_LEFT.replace("rename AccessPoint", "rename Guests-5G");

test("BUG-036: ключ Wi-Fi-объекта не зависит от пользовательского имени", () => {
  const left = synth(WIFI_LEFT).semantic.filter(object => object.key.startsWith("wifi:")).map(object => object.key);
  const right = synth(WIFI_RIGHT).semantic.filter(object => object.key.startsWith("wifi:")).map(object => object.key);
  assert.deepEqual(right, left, "переименование точки доступа сменило диапазон объекта");
});

test("регрессия BUG-036: rename не меняет диапазон Wi-Fi", () => {
  const left = synth(WIFI_LEFT).semantic.filter(object => object.key.startsWith("wifi:")).map(object => object.key);
  const right = synth(WIFI_RIGHT).semantic.filter(object => object.key.startsWith("wifi:")).map(object => object.key);
  assert.ok(left.includes("wifi:2,4 ГГц:0"));
  assert.ok(right.includes("wifi:2,4 ГГц:0"), `ключи справа: ${right.join(", ")}`);
  const comparison = compareSemantic(synth(WIFI_LEFT), synth(WIFI_RIGHT)).filter(item => item.key.startsWith("wifi:"));
  assert.equal(comparison.length, 2, "одно переименование породило лишние строки сравнения");
});

// ------------------------------------------------------------ BUG-037 · фолбэк diff теряет совпадения

const shifted = () => {
  const common = Array.from({ length: 1200 }, (unused, index) => `line ${index}`);
  const left = ["left-head", ...common, "left-tail"].join("\n");
  const inserted = Array.from({ length: 200 }, (unused, index) => `inserted ${index}`);
  const right = ["right-head", ...common.slice(0, 600), ...inserted, ...common.slice(600), "right-tail"].join("\n");
  return { left, right };
};

test("BUG-037: фолбэк построчного сравнения находит совпадения после большой вставки", () => {
  const { left, right } = shifted();
  const diff = lineDiff(left, right);
  const same = diff.filter(row => row.type === "same").length;
  assert.ok(same > 1000, `совпало ${same} строк из 1200 — вставка на 200 строк рассинхронизировала сравнение`);
});

test("регрессия BUG-037: вставка на 200 строк сохраняет совпадения", () => {
  const { left, right } = shifted();
  const diff = lineDiff(left, right);
  const same = diff.filter(row => row.type === "same").length;
  assert.ok(same > 1000, `совпало ${same}`);
});

// ------------------------------------------------------------ BUG-039 · пустое поле «Защита»

test("BUG-039: у точки доступа без шифрования поле «Защита» заполнено", () => {
  const empty = load(NC1812).semantic
    .filter(object => object.key.startsWith("wifi:"))
    .filter(object => object.fields["Защита"] === "");
  assert.equal(empty.length, 0, "пустая строка неотличима от сбоя вёрстки, ожидается «Открытая сеть» или «—»");
});

test("регрессия BUG-039: «Защита» не пустая у выключенного шифрования", () => {
  const empty = load(NC1812).semantic
    .filter(object => object.key.startsWith("wifi:") && object.fields["Защита"] === "");
  assert.equal(empty.length, 0);
});

// ------------------------------------------------------------ BUG-046 · фантомная строка в diff

test("BUG-046: односторонняя секция не даёт пустой строки в diff", () => {
  const diff = lineDiff("line1\nline2\nline3", undefined);
  assert.equal(diff.length, 3, `лишняя строка: ${JSON.stringify(diff.at(-1))}`);
  assert.deepEqual(lineDiff(), []);
});

test("регрессия BUG-046: пустая сторона не добавляет строку", () => {
  const diff = lineDiff("line1\nline2\nline3", undefined);
  assert.equal(diff.length, 3);
  assert.deepEqual(diff.at(-1), { type: "removed", text: "line3" });
});

// ------------------------------------------------------------ BUG-047 · поиск мимо config:*

test("BUG-047: поиск находит совпадения в собранных секциях конфигурации", () => {
  const diagnostic = load(NC1812);
  const section = diagnostic.sections.find(item => item.key.startsWith("config:"));
  const token = section.content.split(/\s+/).find(word => word.length > 6);
  const hits = searchDiagnostic(diagnostic, token);
  assert.ok(hits.some(hit => hit.section === section.name), `«${token}» есть в ${section.name}, но поиск его там не показывает`);
});

test("регрессия BUG-047: поиск включает производные секции", () => {
  const diagnostic = load(NC1812);
  const hits = searchDiagnostic(diagnostic, "mac");
  assert.ok(hits.length > 0);
  assert.ok(hits.filter(hit => hit.sectionType === "derived").length > 0);
});

// ------------------------------------------------------------ BUG-048 · ip http/hotspot/ftp в «Прочем»

test("BUG-048: настройки доступа по HTTP относятся к безопасности", () => {
  const other = load(NC1812).sections.find(section => section.name === "Прочие настройки");
  assert.ok(!/^\s*ip http\b/m.test(other?.content || ""), "`ip http …` попал в «Прочее»");
});

test("регрессия BUG-048: настройки доступа исключены из «Прочего»", () => {
  const other = load(NC1812).sections.find(section => section.name === "Прочие настройки");
  assert.ok(!/^\s*ip http\b/m.test(other?.content || ""));
});

// ------------------------------------------------------------ BUG-049 · «show system» в двух категориях

test("BUG-049: имя секции однозначно определяет секцию", () => {
  for (const name of names) {
    const byName = new Map();
    for (const section of load(name).sections) {
      byName.set(section.name, (byName.get(section.name) || 0) + 1);
    }
    const duplicates = [...byName].filter(([, count]) => count > 1);
    assert.deepEqual(duplicates, [], `${name}: повторяющиеся имена секций ${JSON.stringify(duplicates)}`);
  }
});

test("регрессия BUG-049: «show system» присутствует один раз", () => {
  const sections = load(NC1812).sections.filter(section => section.key.endsWith(":show-system"));
  assert.equal(sections.length, 1);
});

// ------------------------------------------------------------ BUG-050 · коллизия ключей IPsec

const IPSEC_COLLISION = `! $$$ Model: Keenetic Giga
! $$$ Version: 2.06.1
interface IPsecVirtualIpServerIKE2
    description Server IKEv2
    up
!
interface IPsec2
    description Site to site
    up
!
`;

test("BUG-050: разные IPsec-интерфейсы получают разные ключи", () => {
  const keys = synth(IPSEC_COLLISION).semantic.filter(object => object.key.startsWith("ipsec:")).map(object => object.key);
  assert.equal(new Set(keys).size, keys.length, `коллизия ключей: ${keys.join(", ")}`);
});

test("регрессия BUG-050: ключи IPsec уникальны", () => {
  const objects = synth(IPSEC_COLLISION).semantic.filter(object => object.key.startsWith("ipsec:"));
  const keys = objects.map(object => object.key);
  assert.ok(keys.length >= 2);
  assert.equal(new Set(keys).size, keys.length, `получено ${keys.join(", ")}`);
});

// ------------------------------------------------------------ BUG-051 · молчаливые потери в extractFiles

test("BUG-051: `</file>` внутри CDATA не обрезает содержимое", () => {
  const text = `<selftest><file name="ndm:log"><![CDATA[
saw </file> in log
more
]]></file></selftest>`;
  const files = extractFiles(text);
  assert.ok(files[0].content.includes("more"), `содержимое обрезано: ${JSON.stringify(files[0].content)}`);
});

test("регрессия BUG-051: содержимое после литерала `</file>` сохранено", () => {
  const text = `<selftest><file name="ndm:log"><![CDATA[
saw </file> in log
more
]]></file></selftest>`;
  const files = extractFiles(text);
  assert.ok(files[0].content.includes("more"));
});
