import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const rows = JSON.parse(readFileSync(resolve(root, "examples/host-localization.json"), "utf8")) as [string, string, string][];
test("native and desktop resources match the complete shared catalog", () => {
  execFileSync(process.execPath, ["--import", "tsx", "scripts/prepare-host-locales.ts", "--check"], { cwd: root });
});
test("navigation, recovery and formatted status messages have both host translations", () => {
  const catalog = new Map(rows.map((row) => [row[0], row]));
  for (const id of ["home", "settings", "library", "ready", "latest_release", "valid_https", "runtime_switch_failed", "zip_unsafe", "clear_description"]) {
    const row = catalog.get(id); assert.ok(row, id); assert.match(row[2], /[\u3400-\u9fff]/);
  }
  const android = readFileSync(resolve(root, "examples/android-demo-host/app/src/main/res/values/strings.xml"), "utf8");
  const ios = readFileSync(resolve(root, "examples/ios-demo-host/Resources/en.lproj/Localizable.strings"), "utf8");
  assert.match(android, /Ready to play · v%1\$s · %2\$s/);
  assert.match(ios, /Ready to play · v%1\$@ · %2\$@/);
  assert.ok(!android.includes("%0$")); assert.ok(!ios.includes("%0$"));
});
