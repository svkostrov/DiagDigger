import test from "node:test";
import assert from "node:assert/strict";
import { parseDiagnostic, searchDiagnostic } from "../parser.js";

const xml = `<selftest><file name="ndm:sharing-config"><![CDATA[interface Bridge0
    description needle
    up
!]]></file></selftest>`;

test("BUG-071: производное представление не дублирует физическое вхождение", () => {
  const diagnostic = parseDiagnostic("selftest_TEST_stable_1_router_20260831T120000.000Z.txt", xml);
  const hits = searchDiagnostic(diagnostic, "needle");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 2);
  assert.ok(hits[0].sections.includes("ndm:sharing-config"));
  assert.ok(hits[0].sections.includes("Интерфейсы и сегменты"));
});

test("BUG-071: кэш сохраняет дедуплицированную выдачу", () => {
  const diagnostic = parseDiagnostic("selftest_TEST_stable_1_router_20260831T120000.000Z.txt", xml);
  const first = searchDiagnostic(diagnostic, "needle");
  assert.equal(searchDiagnostic(diagnostic, "needle"), first);
});
