import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function benchmarkCommand(args: string[]) {
  const positional = args.filter((argument) => argument !== "--release");
  const [mode = "compare", threshold = ""] = positional;
  if (positional.length > 2 || !["compare", "save"].includes(mode)) {
    throw new Error("Usage: just bench [compare|save] [percent] [--release]");
  }
  if (threshold !== "" && (!Number.isFinite(Number(threshold)) || Number(threshold) < 0)) {
    throw new Error("Regression percent must be a finite, non-negative number");
  }
  return {
    args: ["test", ...(args.includes("--release") ? ["--release"] : []),
      "-p", "bevy-runeweave", "--lib", "perf_baseline", "--", "--ignored", "--nocapture", "--test-threads=1"],
    env: { RUNEWEAVE_PERF_BASELINE: mode, RUNEWEAVE_PERF_MAX_REGRESSION: threshold },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const command = benchmarkCommand(process.argv.slice(2));
  execFileSync("cargo", command.args, {
    cwd: resolve(import.meta.dirname, ".."),
    stdio: "inherit",
    env: { ...process.env, ...command.env },
  });
}
