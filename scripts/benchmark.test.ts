import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { benchmarkCommand } from "./benchmark.js";

test("bench defaults to debug while preserving baseline commands", () => {
  for (const args of [[], ["save"], ["compare", "25"]]) {
    const command = benchmarkCommand(args);
    assert.equal(command.args.includes("--release"), false);
    assert.deepEqual(command.env, {
      RUNEWEAVE_PERF_BASELINE: args[0] ?? "compare",
      RUNEWEAVE_PERF_MAX_REGRESSION: args[1] ?? "",
    });
  }
});

test("bench only enables release when explicitly requested", () => {
  for (const args of [["--release"], ["save", "--release"], ["compare", "25", "--release"], ["--release", "compare", "25"]]) {
    const command = benchmarkCommand(args);
    assert.equal(command.args[1], "--release");
    assert.equal(command.env.RUNEWEAVE_PERF_BASELINE, args.includes("save") ? "save" : "compare");
  }
});

test("invalid benchmark arguments fail before running cargo", () => {
  for (const args of [["--relese"], ["compare", "NaN"], ["compare", "-1"], ["save", "", "extra"]]) {
    assert.throws(() => benchmarkCommand(args));
  }
});

test("npm desktop packaging leaves the profile choice to the debug-default packager", () => {
  const { scripts } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
  for (const platform of ["windows", "macos"]) {
    const command = scripts[`package:${platform}`].split(" ");
    assert.deepEqual(command, ["tsx", "scripts/package-desktop.ts", platform]);
  }
});
