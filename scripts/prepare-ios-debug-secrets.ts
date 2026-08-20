import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const environmentPath = resolve(root, ".env");
const outputPath = resolve(root, "examples/ios-demo-host/Config/DebugSecrets.xcconfig");

function readEnvironmentFile() {
  const values = new Map<string, string>();
  try {
    for (const sourceLine of readFileSync(environmentPath, "utf8").split(/\r?\n/)) {
      const line = sourceLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator < 0) continue;
      const name = line.slice(0, separator).trim();
      values.set(name, line.slice(separator + 1).trim().replace(/^(['\"])(.*)\1$/, "$2"));
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return values;
}

const environment = readEnvironmentFile();
const token = process.env.GITHUB_TOKEN?.trim()
  || process.env.GH_TOKEN?.trim()
  || environment.get("GITHUB_TOKEN")
  || environment.get("GH_TOKEN")
  || "";
const developmentTeam = process.env.RUNEWEAVE_IOS_DEVELOPMENT_TEAM?.trim()
  || environment.get("RUNEWEAVE_IOS_DEVELOPMENT_TEAM")
  || "";
if (token && !/^[A-Za-z0-9_]+$/.test(token)) {
  throw new Error("GitHub token contains characters that cannot be stored safely in xcconfig");
}
if (developmentTeam && !/^[A-Z0-9]{10}$/.test(developmentTeam)) {
  throw new Error("RUNEWEAVE_IOS_DEVELOPMENT_TEAM must be a 10-character Apple team ID");
}
writeFileSync(
  outputPath,
  `RUNEWEAVE_GITHUB_TOKEN = ${token}\nDEVELOPMENT_TEAM = ${developmentTeam}\n`,
  { mode: 0o600 },
);
console.log(
  `Prepared iOS Debug secrets (${token ? "token configured" : "no token configured"}, ${developmentTeam ? "team configured" : "no team configured"})`,
);
