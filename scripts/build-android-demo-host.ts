import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const hostRoot = resolve(root, "examples/android-demo-host");
const supportedAbis = new Set(["arm64-v8a", "x86_64"]);
const options = process.argv.slice(2);
const release = options.includes("--release");
const dryRun = options.includes("--dry-run");
const abiArguments = options.filter((option) => option.startsWith("--abis="));
const unknown = options.filter((option) =>
  option !== "--release" && option !== "--dry-run" && !option.startsWith("--abis="),
);

if (unknown.length) throw new Error(`Unsupported argument: ${unknown.join(", ")}`);
if (abiArguments.length > 1) throw new Error("--abis may only be specified once");

const abis = [...new Set((abiArguments[0]?.slice("--abis=".length) ?? "arm64-v8a,x86_64")
  .split(",")
  .map((abi) => abi.trim())
  .filter(Boolean))];
if (abis.length === 0) throw new Error("--abis must contain at least one ABI");
const unsupportedAbis = abis.filter((abi) => !supportedAbis.has(abi));
if (unsupportedAbis.length) {
  throw new Error(
    `Unsupported Android ABI: ${unsupportedAbis.join(", ")}; supported ABIs: ${[...supportedAbis].join(", ")}`,
  );
}

const gradle = process.platform === "win32"
  ? resolve(hostRoot, "gradlew.bat")
  : resolve(hostRoot, "gradlew");
const task = release ? ":app:assembleRelease" : ":app:logcatDebug";
const args = ["-p", hostRoot, task, `-PruneweaveAbis=${abis.join(",")}`];

console.log(`Android demo: ${release ? "release build" : "debug install, launch, and logcat"}`);
console.log(`Android ABIs: ${abis.join(", ")}`);
console.log(`Gradle task: ${task}`);
if (!dryRun) {
  execFileSync(gradle, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
}
