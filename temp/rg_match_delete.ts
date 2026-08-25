import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const libraryRoot = "/Users/super/super/blockman-go-android/Librarys";
const appConfig = join(libraryRoot, "libBaseRes/src/main/java/com/sandboxol/center/entity/AppConfig.java");
const record = join(process.cwd(), "temp/@rg_match_delete");
const diff = execFileSync("git", ["-C", libraryRoot, "diff", "HEAD^", "HEAD", "--unified=0", "--", "libBaseRes/src/main/java/com/sandboxol/center/entity/AppConfig.java"], { encoding: "utf8" });
const deleted = diff.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---")).map((line) => line.slice(1)).join("\n") + "\n";
mkdirSync(dirname(record), { recursive: true });
writeFileSync(record, deleted);
const deletedLines = deleted.split("\n");
const methodNames = deletedLines.flatMap((line) => [...line.matchAll(/\b(?:public|private|protected)\s+(?:static\s+)?[^\s(]+(?:<[^>]+>)?\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)].map((match) => match[1]));
const fieldNames = deletedLines.flatMap((line) => [...line.matchAll(/\bprivate\s+(?:final\s+)?[^\n;=]+\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:[=;])/g)].map((match) => match[1]));
const unique = [...new Set([...methodNames, ...fieldNames])];
const pattern = unique.map((name) => String.raw`\b${name}\b`).join("|");
const roots = ["/Users/super/super/blockman-go-android/Blockymods", libraryRoot];
let matches = "";
if (pattern) {
  try { matches = execFileSync("rg", ["-n", "--hidden", "--glob", "!build/**", "--glob", "!.git/**", "--glob", "*.{java,kt}", pattern, ...roots], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }); }
  catch (error) { if ((error as { status?: number }).status !== 1) throw error; }
}
const external = matches.split("\n").filter((line) => line && !line.includes("AppConfig.java") && !line.includes("rg_match_delete.ts") && /AppConfig|appConfig|getAppConfig/.test(line));
for (const line of external) {
  const symbols = unique.filter((symbol) => new RegExp(String.raw`\b${symbol}\b`).test(line));
  console.log(`${symbols.join(",")} -> ${line}`);
}
