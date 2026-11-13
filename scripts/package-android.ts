import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
execFileSync(process.execPath, [
  "--import", "tsx", resolve(root, "scripts/build-android-demo-host.ts"),
  "--apk-only", ...process.argv.slice(2),
], { cwd: root, stdio: "inherit", env: process.env });
