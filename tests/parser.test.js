import test from "node:test";
import assert from "node:assert/strict";
import { compareSections, compareSemantic, extractFiles, extractSemanticConfig, extractTemperatures, lineDiff, parseDiagnostic, parseFilename, searchDiagnostic } from "../parser.js";

test("parses diagnostic filename", () => {
  const meta = parseFilename("self-test_KN-1811_stable_5.01.C.4.0-1_router_2026-08-30T17-35-11.961Z.txt");
  assert.equal(meta.device, "KN-1811"); assert.equal(meta.version, "5.01.C.4.0-1"); assert.equal(meta.role, "router");
});

test("extracts CDATA sections and derived configuration", () => {
  const input = `<selftest><file name="ndm:sharing-config"><![CDATA[! $$$ Model: Test\ninterface WifiMaster0\n    up\n!\ninterface Wireguard0\n    up\n]]></file><file name="ndm:log"><![CDATA[hello]]></file></selftest>`;
  assert.equal(extractFiles(input).length, 2);
  const result = parseDiagnostic("self-test_KN-1_testing_1_router_now.txt", input);
  assert.ok(result.sections.some(s => s.name === "Wi‑Fi и точки доступа"));
  assert.ok(result.sections.some(s => s.name === "VPN и туннели"));
});

test("compares missing and changed sections", () => {
  const base = name => parseDiagnostic(name, `<selftest><file name="ndm:log"><![CDATA[${name}]]></file></selftest>`);
  const rows = compareSections(base("a.txt"), base("b.txt"));
  assert.equal(rows[0].status, "changed");
});

test("creates readable line diff", () => {
  assert.deepEqual(lineDiff("a\nb", "a\nc").map(x => x.type), ["same", "removed", "added"]);
});

test("extracts semantic Wi-Fi bands and VPN objects", () => {
  const config = `interface WifiMaster0\n    compatibility BGN\n    up\n!\ninterface WifiMaster0/AccessPoint0\n    ssid Home\n    encryption wpa2\n    up\n!\ninterface WifiMaster1\n    compatibility AN+AC\n    up\n!\ninterface WifiMaster1/AccessPoint0\n    description "5GHz Wi-Fi access point"\n    ssid Home-5G\n    up\n!\ninterface Wireguard3\n    description Work\n    ip address 10.0.0.2 255.255.255.0\n    wireguard peer secret\n        endpoint vpn.example:1234\n        allow-ips 10.1.0.0 255.255.0.0\n    !\n    up\n!`;
  const objects = extractSemanticConfig(config);
  assert.ok(objects.some(item => item.key.startsWith("wifi:2,4 ГГц")));
  assert.ok(objects.some(item => item.key.startsWith("wifi:5 ГГц")));
  const wg = objects.find(item => item.key === "wireguard:3");
  assert.equal(wg.fields.Endpoint, "vpn.example:1234");
  assert.equal(wg.fields.Пиры, "1");
  assert.doesNotMatch(JSON.stringify(wg.fields), /secret/);
});

test("semantic comparison marks missing band and changed settings", () => {
  const left = { semantic: [{ key:"wifi:5 ГГц:0", category:"Wi‑Fi", title:"Wi‑Fi 5 ГГц", fields:{SSID:"A"} }] };
  const right = { semantic: [] };
  assert.equal(compareSemantic(left, right)[0].status, "left-only");
  right.semantic = [{ key:"wifi:5 ГГц:0", category:"Wi‑Fi", title:"Wi‑Fi 5 ГГц", fields:{SSID:"B"} }];
  assert.equal(compareSemantic(left, right)[0].status, "changed");
});

test("extracts configured PPPoE connection", () => {
  const objects = extractSemanticConfig(`interface PPPoE0\n    description Provider\n    over GigabitEthernet0/Vlan2\n    authentication identity user@example\n    ip mtu 1492\n    up\n!`);
  const pppoe = objects.find(item => item.key === "pppoe:0");
  assert.equal(pppoe.category, "Интернет-подключения");
  assert.equal(pppoe.fields["Интерфейс провайдера"], "GigabitEthernet0/Vlan2");
  assert.equal(pppoe.fields["Состояние"], "Включено");
});

test("extracts WAN connection and LAN segment using CLI interface hierarchy", () => {
  const objects = extractSemanticConfig(`interface GigabitEthernet0/Vlan2\n    rename ISP\n    description "Broadband connection"\n    ip address dhcp\n    ip global 700\n    up\n!\ninterface Bridge0\n    rename Home\n    description "Home network"\n    include AccessPoint\n    ip address 192.168.1.1 255.255.255.0\n    up\n!`);
  const wan = objects.find(item => item.key === "internet:gigabitethernet0/vlan2");
  const bridge = objects.find(item => item.key === "bridge:0");
  assert.equal(wan.fields["Тип адреса"], "DHCP");
  assert.equal(bridge.fields["Участники"], "AccessPoint");
});

test("extracts interface temperatures and exposes them in search and Wi-Fi semantics", () => {
  const xml = `<selftest><file name="ndm:sharing-config"><![CDATA[interface WifiMaster0
    compatibility BGN
    up
!
interface WifiMaster0/AccessPoint0
    ssid Home
    up
!]]></file><interface name="WifiMaster0"><temperature>71</temperature></interface></selftest>`;
  assert.deepEqual(extractTemperatures(xml), [{ id: "WifiMaster0", value: 71 }]);
  const diagnostic = parseDiagnostic("self-test_KN-1_testing_1_router_now.txt", xml);
  const temperatureSection = diagnostic.sections.find(section => section.key === "derived:temperatures");
  assert.match(temperatureSection.content, /WifiMaster0: 71 °C/);
  assert.equal(diagnostic.meta.maxTemperature, 71);
  assert.equal(diagnostic.semantic.find(item => item.key.startsWith("wifi:2,4 ГГц")).fields["Температура"], "71 °C");
  assert.equal(searchDiagnostic(diagnostic, "Температура").length, 1);
  assert.equal(searchDiagnostic(diagnostic, "WifiMaster").length, 3);
});

test("search returns every occurrence with file section and line location", () => {
  const text = `<selftest>\n<file name="ndm:test">\nSKUenable=0\nWifiMaster0 WifiMaster1\n</file>\n<interface name="WifiMaster0">\n<id>WifiMaster0</id>\n</interface>\n</selftest>`;
  const sku = searchDiagnostic(text, "SKU");
  assert.equal(sku.length, 1);
  assert.equal(sku[0].section, "ndm:test");
  assert.equal(sku[0].line, 3);
  const wifi = searchDiagnostic(text, "WifiMaster");
  assert.equal(wifi.length, 4);
  assert.equal(wifi.at(-1).section, "Интерфейс · WifiMaster0");
  assert.equal(wifi[1].column, 13);
});
