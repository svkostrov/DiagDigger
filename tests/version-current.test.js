import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("видимая версия совпадает с major.minor версии пакета", () => {
  const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const visible = html.match(/class="app-version"[^>]*>v([\d.]+)</)?.[1];
  assert.ok(visible, "в верхней панели нет видимого номера версии");
  assert.equal(visible, packageJson.version.split(".").slice(0, 2).join("."));
});
