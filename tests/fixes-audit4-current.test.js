import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDiagnostic, searchDiagnostic } from "../parser.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "fixtures");
const names = fs.readdirSync(FIXTURES).filter(name => name.endsWith(".txt"));
const diagnosticName = "selftest_TEST_stable_5.01.C.9.99_router_20260831T120000.000Z.txt";

test("BUG-074: поиск видит вычисленные температуры и не дублирует физические совпадения", () => {
  const text = `<selftest><!-- show interface --><response><interface name="WifiMaster1"><temperature>88</temperature></interface></response><file name="ndm:sharing-config">interface Bridge0\n    up\n!</file></selftest>`;
  const diagnostic = parseDiagnostic(diagnosticName, text);
  assert.equal(searchDiagnostic(diagnostic, "88 °C").length, 1);
  assert.equal(searchDiagnostic(diagnostic, "GHz").length, 1);
  const physical = (diagnostic.searchText.match(/interface/gi) || []).length;
  assert.equal(searchDiagnostic(diagnostic, "interface").length, physical);
});

test("BUG-079: один разбор пропускает через санитизацию не больше 2,2× размера файла", async () => {
  const source = fs.readFileSync(path.join(HERE, "..", "parser.js"), "utf8");
  const counter = "globalThis.__fixAudit4San = { bytes: 0 };\nconst sanitizeRaw = raw => (globalThis.__fixAudit4San.bytes += String(raw || '').length, 0) ||";
  const temporary = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fix-audit4-")), "parser.mjs");
  fs.writeFileSync(temporary, source.replace("const sanitizeRaw = raw =>", counter));
  const instrumented = await import(`file://${temporary}`);
  const name = names.find(item => item.includes("KN1811")) || names[0];
  const text = fs.readFileSync(path.join(FIXTURES, name), "utf8");
  globalThis.__fixAudit4San = { bytes: 0 };
  instrumented.parseDiagnostic(name, text);
  assert.ok(globalThis.__fixAudit4San.bytes / text.length <= 2.2);
});

test("BUG-087: словарь show раскладывает доступ, логи, сервисы и служебные подсистемы", () => {
  const expected = new Map([
    ["show ip http lockout-policy", "security"], ["show ssh fingerprint", "security"],
    ["show authentication session", "security"], ["show log", "logs"],
    ["show mws log", "logs"], ["show nvox active-calls", "services"],
    ["show ntce applications", "qos"], ["show cifs", "services"],
    ["show nextdns profiles", "networkRules"], ["show interface dsl status", "internet"],
  ]);
  const markers = [...expected].map(([command]) => `<!-- ${command} --><response><ok>yes</ok></response>`).join("\n");
  const diagnostic = parseDiagnostic(diagnosticName, `<selftest>${markers}<file name="ndm:sharing-config">system\n!</file></selftest>`);
  const categories = new Map(diagnostic.sections.filter(section => section.source === "show").map(section => [section.name, section.category]));
  for (const [command, category] of expected) assert.equal(categories.get(command), category, command);
});

test("BUG-088: IAPP, FT IAPP и MWS WPA PSK скрываются во всех представлениях", () => {
  const secrets = ["SyntheticIappKey", "SyntheticFtKey", "SyntheticWpaKey"];
  const config = `interface Bridge0\n    iapp key ${secrets[0]}\n    ft iapp key ${secrets[1]}\n!\nmws wlan Home\n    wpa psk ${secrets[2]}\n!`;
  const diagnostic = parseDiagnostic(diagnosticName, `<selftest><file name="ndm:sharing-config">${config}</file></selftest>`);
  const output = `${diagnostic.searchText}\n${diagnostic.sections.map(section => section.content).join("\n")}`;
  for (const secret of secrets) assert.doesNotMatch(output, new RegExp(secret));
});
