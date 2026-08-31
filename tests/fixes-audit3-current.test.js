// Регрессионные проверки текущего исправления BUG-052/053/059/062/069/070.
// Файл добавлен отдельно, чтобы не смешивать тесты исправления с тестами аудита 3.
import test from "node:test";
import assert from "node:assert/strict";
import { parseDiagnostic, searchDiagnostic } from "../parser.js";

const diagnosticText = `<selftest>
<!-- show version -->
<version><release>stable</release></version>
<!-- show custom diagnostics -->
<custom>needle</custom>
<file name="ndm:sharing-config"><![CDATA[! $$$ Model: Test
! $$$ Version: 1
crypto ike key Profile top-secret
interface GigabitEthernet0
 ip global 1
]]></file>
</selftest>`;

test("текущая правка: секрет заменён без изменения числа строк", () => {
  const parsed = parseDiagnostic("selftest_TEST_stable_1_router_20260831T120000.000Z.txt", diagnosticText);
  const structured = parsed.sections.find(section => section.key === "raw:selftest-structured");
  assert.equal(structured.content.split("\n").length, diagnosticText.split("\n").length);
  assert.doesNotMatch(structured.content, /top-secret/);
  assert.match(structured.content, /crypto ike \[скрыто: ключ\]/);
});

test("текущая правка: неизвестный show выделен и доступен поиску вместе с XML", () => {
  const parsed = parseDiagnostic("selftest_TEST_stable_1_router_20260831T120000.000Z.txt", diagnosticText);
  assert.ok(parsed.sections.some(section => section.source === "show" && section.name === "show custom diagnostics"));
  const first = searchDiagnostic(parsed, "needle");
  const second = searchDiagnostic(parsed, "needle");
  assert.ok(first.some(hit => hit.sectionType === "derived"));
  assert.ok(first.some(hit => hit.sectionType !== "derived"));
  assert.equal(second, first, "повторный запрос должен возвращаться из кэша");
});
