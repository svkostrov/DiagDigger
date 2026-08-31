import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATEGORY_INFO, parseDiagnostic } from "../parser.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixtureName = fs.readdirSync(path.join(HERE, "fixtures")).find(name => name.includes("KN1811"));
const fixtureText = fs.readFileSync(path.join(HERE, "fixtures", fixtureName), "utf8");
const diagnostic = parseDiagnostic(fixtureName, fixtureText);

test("рекомендации GROUPING: категории имеют пользовательские названия, IPv6 сохранён", () => {
  assert.equal(CATEGORY_INFO.interfaces.title, "Сегменты");
  assert.equal(CATEGORY_INFO.wifi.title, "Точки доступа");
  assert.equal(CATEGORY_INFO.mws.title, "Wi‑Fi-система");
  assert.equal(CATEGORY_INFO.qos.title, "IntelliQoS");
  assert.equal(CATEGORY_INFO.ipv6.title, "IPv6");
  assert.ok(diagnostic.sections.some(section => section.category === "ipv6"), "IPv6 должен остаться отдельной категорией");
});

test("реальные show-данные KN-1811 получают специальные человекочитаемые представления", () => {
  const expected = new Map([
    ["show device-list", ["hosts", "devices"]],
    ["show ip neighbour", ["hosts", "neighbours"]],
    ["show ntce hosts", ["appTraffic", "traffic-hosts"]],
    ["show ip arp", ["hosts", "arp"]],
    ["show ip http proxy", ["remoteAccess", "proxies"]],
  ]);
  for (const [name, [category, presentation]] of expected) {
    const section = diagnostic.sections.find(item => item.name === name);
    assert.ok(section, `${name}: секция не найдена`);
    assert.equal(section.category, category, `${name}: неверная категория`);
    assert.equal(section.presentation, presentation, `${name}: нет специального представления`);
  }
});

test("XML-выводы остальных show-команд получают общий структурированный fallback", () => {
  const xmlShows = diagnostic.sections.filter(section => section.source === "show" && /^\s*<[\w:-]+[\s>]/.test(section.content));
  assert.ok(xmlShows.length > 20, "в фикстуре недостаточно XML show-секций для проверки");
  assert.ok(xmlShows.every(section => section.presentation), xmlShows.filter(section => !section.presentation).map(section => section.name).join(", "));
  assert.equal(diagnostic.sections.filter(section => section.source === "show" && section.category === "other").length, 0);
});

test("новая группировка разводит фильтры, firewall, доступ, домены и диагностику", () => {
  const names = ["show nextdns profiles", "show netfilter", "show ssh fingerprint", "show cloud ndmp status", "show processes"];
  const markers = names.map(name => `<!-- ${name} --><response><state>ok</state></response>`).join("\n");
  const sample = parseDiagnostic("selftest_TEST_stable_1.0_router_now.txt", `<selftest>${markers}<file name="ndm:sharing-config">system\n!</file></selftest>`);
  const commands = new Map(sample.sections.filter(section => section.source === "show").map(section => [section.name, section.category]));
  assert.equal(commands.get("show nextdns profiles"), "internetFilters");
  assert.equal(commands.get("show netfilter"), "firewall");
  assert.equal(commands.get("show ssh fingerprint"), "users");
  assert.equal(commands.get("show cloud ndmp status"), "remoteAccess");
  assert.equal(commands.get("show processes"), "diagnostics");
});
