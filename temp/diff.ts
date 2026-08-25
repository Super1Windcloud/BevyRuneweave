#!/usr/bin/env npx tsx

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const repo = "/Users/super/super/blockman-go-android";
const appConfig = join(repo, "Librarys/libBaseRes/src/main/java/com/sandboxol/center/entity/AppConfig.java");
const output = join(process.cwd(), "temp/rg_match_delete");
const source = readFileSync(appConfig, "utf8");

type SymbolKind = "field" | "getter" | "setter";
type Symbol = { name: string; kind: SymbolKind; line: number };

const symbols: Symbol[] = [];
for (const [index, line] of source.split("\n").entries()) {
    const field = line.match(/^\s*private\s+(?:static\s+)?(?:final\s+)?[^;=]+\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:[=;])/);
    if (field) symbols.push({ name: field[1], kind: "field", line: index + 1 });
    const method = line.match(/^\s*public\s+(?:static\s+)?[^\s(]+(?:<[^>]+>)?\s+(get|is|set)([A-Z][A-Za-z0-9_]*)\s*\(/);
    if (method) symbols.push({ name: method[1] + method[2], kind: method[1] === "set" ? "setter" : "getter", line: index + 1 });
}

const unique = [...new Map(symbols.map((symbol) => [`${symbol.kind}:${symbol.name}`, symbol])).values()];
const matches = new Map<string, string[]>();
for (const [index, symbol] of unique.entries()) {
    console.error(`[${index + 1}/${unique.length}] rg ${symbol.kind} ${symbol.name}`);
    let result = "";
    try {
        result = execFileSync("rg", ["-n", "--hidden", "--glob", "!build/**", "--glob", "!.git/**", "--glob", "*.{java,kt,groovy}", `\b${symbol.name}\b`, `${repo}/Blockymods`, `${repo}/Librarys`], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
    } catch (error) {
        if ((error as { status?: number }).status !== 1) throw error;
    }
    const external = result.split("\n").filter((line) => line && !line.includes("/AppConfig.java:") && !line.includes("/temp/diff.ts:"));
    if (external.length) matches.set(`${symbol.kind}:${symbol.name}`, external);
}

mkdirSync(join(process.cwd(), "temp"), { recursive: true });
const report: string[] = [];
for (const symbol of unique) {
    const key = `${symbol.kind}:${symbol.name}`;
    const references = matches.get(key) ?? [];
    report.push(`${symbol.kind} ${symbol.name} ${references.length ? "保留（存在外部引用）" : "可移除（无外部引用）"}`);
    for (const reference of references) report.push(`  ${reference}`);
}
writeFileSync(output, report.join("\n") + "\n");
console.log(report.join("\n"));
