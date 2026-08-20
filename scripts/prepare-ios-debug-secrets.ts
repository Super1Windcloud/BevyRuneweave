import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const environmentPath = resolve(root, ".env");
const outputPath = resolve(root, "examples/ios-demo-host/Config/DebugSecrets.xcconfig");

function readGitHubToken() {
  const fromProcess = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  if (fromProcess) return fromProcess;
  try {
    for (const sourceLine of readFileSync(environmentPath, "utf8").split(/\r?\n/)) {
      const line = sourceLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator < 0) continue;
      const name = line.slice(0, separator).trim();
      if (name !== "GITHUB_TOKEN" && name !== "GH_TOKEN") continue;
      return line.slice(separator + 1).trim().replace(/^(['\"])(.*)\1$/, "$2");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return "";
}

const token = readGitHubToken();
if (token && !/^[A-Za-z0-9_]+$/.test(token)) {
  throw new Error("GitHub token contains characters that cannot be stored safely in xcconfig");
}
writeFileSync(outputPath, `RUNEWEAVE_GITHUB_TOKEN = ${token}\n`, { mode: 0o600 });
console.log(`Prepared iOS Debug secrets (${token ? "token configured" : "no token configured"})`);
