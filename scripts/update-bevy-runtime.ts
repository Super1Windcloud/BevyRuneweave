import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

interface CratesIoResponse {
  crate: {
    name: string;
    max_version: string;
    max_stable_version: string;
  };
}

interface GitHubReleaseResponse {
  name?: string;
  tag_name?: string;
  html_url?: string;
  body?: string;
}

const root = resolve(import.meta.dirname, "..");
const changelogPath = resolve(root, "CHANGELOG.md");

function getOption(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((v) => v.startsWith(prefix));
  if (arg) return arg.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && index + 1 < process.argv.length && !process.argv[index + 1].startsWith("--")) {
    return process.argv[index + 1];
  }
  return undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function run(command: string, args: string[], cwd = root) {
  console.log(`> ${command} ${args.join(" ")}`);
  execFileSync(command, args, { cwd, stdio: "inherit", env: process.env });
}

async function fetchLatestBevyVersion(includePrerelease: boolean): Promise<string> {
  const url = "https://crates.io/api/v1/crates/bevy";
  console.log(`Fetching latest Bevy version information from ${url}...`);
  const response = await fetch(url, {
    headers: {
      "User-Agent": "bevy-runeweave-runtime-updater/1.0",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to query crates.io (status ${response.status}: ${response.statusText})`);
  }

  const data = (await response.json()) as CratesIoResponse;
  const version = includePrerelease ? data.crate.max_version : data.crate.max_stable_version;
  if (!version) {
    throw new Error("Unable to parse version from crates.io response");
  }
  return version;
}

function readEnvironmentToken(): string | undefined {
  if (process.env.GITHUB_TOKEN?.trim()) return process.env.GITHUB_TOKEN.trim();
  if (process.env.GH_TOKEN?.trim()) return process.env.GH_TOKEN.trim();
  const envPath = resolve(root, ".env");
  if (existsSync(envPath)) {
    try {
      const content = readFileSync(envPath, "utf8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq > 0) {
          const key = trimmed.slice(0, eq).trim();
          if (key === "GITHUB_TOKEN" || key === "GH_TOKEN") {
            return trimmed.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
          }
        }
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}

interface CompareResponse {
  total_commits?: number;
  commits?: Array<{
    commit: {
      message: string;
      author?: { name?: string };
    };
  }>;
}

interface ReleaseInfo {
  releaseUrl: string;
  compareUrl: string;
  notesSummary: string;
  totalCommits: number;
  internalChangesMarkdown: string;
}

async function fetchReleaseNotes(
  currentVersion: string,
  targetVersion: string,
): Promise<ReleaseInfo> {
  const releaseUrl = `https://github.com/bevyengine/bevy/releases/tag/v${targetVersion}`;
  const compareUrl = `https://github.com/bevyengine/bevy/compare/v${currentVersion}...v${targetVersion}`;
  let notesSummary = "";
  let totalCommits = 0;
  let internalChangesMarkdown = "";

  const token = readEnvironmentToken();
  const headers: Record<string, string> = {
    "User-Agent": "bevy-runeweave-runtime-updater/1.0",
    Accept: "application/vnd.github.v3+json",
  };
  if (token) {
    headers["Authorization"] = `token ${token}`;
  }

  // 1. Fetch GitHub Release info
  try {
    const apiUrl = `https://api.github.com/repos/bevyengine/bevy/releases/tags/v${targetVersion}`;
    const response = await fetch(apiUrl, { headers });

    if (response.ok) {
      const data = (await response.json()) as GitHubReleaseResponse;
      if (data.body) {
        const trimmed = data.body.trim();
        // Ignore generic one-liners pointing to compare URL
        if (!trimmed.toLowerCase().includes("a full diff of what's in this release can be seen here")) {
          const lines = trimmed.split(/\r?\n/).filter(Boolean);
          notesSummary = lines.slice(0, 15).join("\n");
        }
      }
    }
  } catch {
    // Gracefully handle network / rate limiting errors
  }

  // 2. Fetch detailed commits and PR changes from GitHub Compare API
  try {
    const compareApiUrl = `https://api.github.com/repos/bevyengine/bevy/compare/v${currentVersion}...v${targetVersion}`;
    const response = await fetch(compareApiUrl, { headers });
    if (response.ok) {
      const data = (await response.json()) as CompareResponse;
      totalCommits = data.total_commits ?? 0;
      const commits = data.commits ?? [];

      const categories: Record<string, string[]> = {
        "渲染与着色器 (Rendering & Shaders)": [],
        "UI 与文本排版 (UI & Text)": [],
        "ECS 架构与场景系统 (ECS, Scenes & Observers)": [],
        "平台与窗口输入 (Platform, Window & Input)": [],
        "资源与音视频 (Assets & Audio)": [],
        "通用修复与优化 (General Fixes & Optimizations)": [],
      };

      for (const c of commits) {
        const rawMsg = c.commit.message.split(/\r?\n/)[0].trim();
        if (!rawMsg || /^release bevy/i.test(rawMsg)) continue;

        // Convert PR #12345 to Markdown link
        const linkified = rawMsg.replace(
          /#(\d+)/g,
          "[#$1](https://github.com/bevyengine/bevy/pull/$1)",
        );
        const lower = rawMsg.toLowerCase();

        if (
          /render|shader|shadow|light|fog|ssao|mesh|batch|solari|irradiance|draw|2d flicker|color|wgsl|clearcoat/i.test(
            lower,
          )
        ) {
          categories["渲染与着色器 (Rendering & Shaders)"].push(linkified);
        } else if (/ui|text|font|border radius|overlay|diagnostics|radio/i.test(lower)) {
          categories["UI 与文本排版 (UI & Text)"].push(linkified);
        } else if (/ecs|observer|subapp|entity|bsn|scene/i.test(lower)) {
          categories["ECS 架构与场景系统 (ECS, Scenes & Observers)"].push(linkified);
        } else if (/window|cursor|wayland|ios|wasm|input|osk|resolution/i.test(lower)) {
          categories["平台与窗口输入 (Platform, Window & Input)"].push(linkified);
        } else if (/audio|sound|mp4|asset|handletemplate/i.test(lower)) {
          categories["资源与音视频 (Assets & Audio)"].push(linkified);
        } else {
          categories["通用修复与优化 (General Fixes & Optimizations)"].push(linkified);
        }
      }

      const lines: string[] = [];
      for (const [title, items] of Object.entries(categories)) {
        if (items.length > 0) {
          lines.push(`#### ${title}`);
          for (const item of items) {
            lines.push(`- ${item}`);
          }
          lines.push("");
        }
      }
      internalChangesMarkdown = lines.join("\n").trim();
    }
  } catch {
    // Gracefully handle network / rate limiting errors
  }

  return { releaseUrl, compareUrl, notesSummary, totalCommits, internalChangesMarkdown };
}

function updateRootCargoToml(
  content: string,
  targetVersion: string,
  majorMinor: string,
  isPrerelease: boolean,
): string {
  const subcrateVersion = isPrerelease ? targetVersion : majorMinor;

  // Replace bevy_* subcrates in [workspace.dependencies]
  let updated = content.replace(
    /^([ \t]*bevy_[a-z0-9_]+\s*=\s*\{[ \t]*version\s*=\s*")[^"]+(")/gm,
    `$1${subcrateVersion}$2`,
  );

  // Replace bevy in [dependencies]
  updated = updated.replace(
    /^([ \t]*bevy\s*=\s*\{[ \t]*version\s*=\s*")[^"]+(")/gm,
    `$1${targetVersion}$2`,
  );

  return updated;
}

function updateHostCargoToml(content: string, targetVersion: string): string {
  return content.replace(
    /^([ \t]*bevy\s*=\s*\{[ \t]*version\s*=\s*")[^"]+(")/gm,
    `$1${targetVersion}$2`,
  );
}

function writeOrUpdateChangelog(
  currentVersion: string,
  targetVersion: string,
  majorMinor: string,
  isPrerelease: boolean,
  releaseInfo: ReleaseInfo,
  verificationStatus: string,
) {
  const today = new Date().toISOString().slice(0, 10);
  const versionTitle = `## [Bevy ${targetVersion}] - ${today}`;

  let notesSection = "";
  if (releaseInfo.notesSummary) {
    const quoteLines = releaseInfo.notesSummary
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    notesSection = `\n### 上游版本核心说明\n${quoteLines}\n`;
  }

  let internalChangesSection = "";
  if (releaseInfo.internalChangesMarkdown) {
    const countText = releaseInfo.totalCommits > 0 ? ` (共 ${releaseInfo.totalCommits} 项变更)` : "";
    internalChangesSection = `\n### Bevy 引擎内部更新详情${countText}\n${releaseInfo.internalChangesMarkdown}\n`;
  }

  const entryContent = `${versionTitle}

### 底层 Bevy 运行时同步更新
- **版本升级**：将底层 Bevy 引擎版本由 \`${currentVersion}\` 升级至 \`${targetVersion}\`。
- **上游版本发布**：[Bevy v${targetVersion}](${releaseInfo.releaseUrl})
- **代码对比与变更**：[\`v${currentVersion}...v${targetVersion}\`](${releaseInfo.compareUrl})
- **已同步更新的项目配置**：
  - \`Cargo.toml\`：\`bevy\` 依赖升级至 \`${targetVersion}\`（工作区 \`bevy_*\` 子模块依赖：\`${isPrerelease ? targetVersion : majorMinor}\`）
  - \`crates/runtime-cdylib/Cargo.toml\`：\`bevy\` 依赖升级至 \`${targetVersion}\`
  - \`examples/android-demo-host/runtime/Cargo.toml\`：\`bevy\` 依赖升级至 \`${targetVersion}\`
  - \`Cargo.lock\` 与 \`examples/android-demo-host/runtime/Cargo.lock\`：锁文件依赖版本同步锁定
- **自动化验证**：${verificationStatus}
${notesSection}${internalChangesSection}`;

  const header = `# 更新日志 (Changelog)

本文件用于记录本项目底层 Bevy 运行时及引擎依赖的同步更新历史。

`;

  let existing = "";
  if (existsSync(changelogPath)) {
    existing = readFileSync(changelogPath, "utf8");
  }

  if (!existing.trim()) {
    writeFileSync(changelogPath, `${header}${entryContent}\n`, "utf8");
    console.log(`Created ${changelogPath} with Bevy ${targetVersion} entry.`);
    return;
  }

  // If section for this version already exists, replace it
  const escapedTitle = `## \\[Bevy ${targetVersion.replace(/\./g, "\\.")}\\][^\n]*`;
  const existingRegex = new RegExp(`${escapedTitle}[\\s\\S]*?(?=(\\n## |$))`);
  if (existingRegex.test(existing)) {
    existing = existing.replace(existingRegex, entryContent.trim());
    writeFileSync(changelogPath, existing, "utf8");
    console.log(`Updated existing Bevy ${targetVersion} section in ${changelogPath}.`);
    return;
  }

  // Otherwise, insert after header / before first entry
  const firstSectionIndex = existing.indexOf("\n## ");
  if (firstSectionIndex !== -1) {
    const before = existing.slice(0, firstSectionIndex + 1);
    const after = existing.slice(firstSectionIndex + 1);
    const result = `${before}${entryContent}\n${after}`;
    writeFileSync(changelogPath, result, "utf8");
  } else {
    writeFileSync(changelogPath, `${existing.trimEnd()}\n\n${entryContent}\n`, "utf8");
  }
  console.log(`Appended Bevy ${targetVersion} section to ${changelogPath}.`);
}

function inferPreviousVersion(targetVersion: string): string | undefined {
  const cleanVersion = targetVersion.split("-")[0];
  const parts = cleanVersion.split(".");
  if (parts.length === 3) {
    const major = parseInt(parts[0], 10);
    const minor = parseInt(parts[1], 10);
    const patch = parseInt(parts[2], 10);
    if (!isNaN(patch) && patch > 0) {
      return `${major}.${minor}.${patch - 1}`;
    }
  }
  return undefined;
}

async function main() {
  const isDryRun = hasFlag("dry-run");
  const isForce = hasFlag("force");
  const skipCheck = hasFlag("no-check");
  const includePrerelease = hasFlag("include-prerelease");
  const requestedVersion = getOption("version");
  const requestedFromVersion = getOption("from") ?? getOption("from-version");

  const rootCargoPath = join(root, "Cargo.toml");
  const cdylibCargoPath = join(root, "crates", "runtime-cdylib", "Cargo.toml");
  const androidHostCargoPath = join(root, "examples", "android-demo-host", "runtime", "Cargo.toml");

  if (!existsSync(rootCargoPath)) {
    throw new Error(`Root Cargo.toml not found at: ${rootCargoPath}`);
  }

  const rootCargoContent = readFileSync(rootCargoPath, "utf8");
  const currentMatch = rootCargoContent.match(/^[ \t]*bevy\s*=\s*\{[ \t]*version\s*=\s*"([^"]+)"/m);
  if (!currentMatch) {
    throw new Error("Could not detect current Bevy version from root Cargo.toml");
  }

  const currentVersion = currentMatch[1];
  console.log(`Current Bevy runtime version: ${currentVersion}`);

  const targetVersion = requestedVersion ?? (await fetchLatestBevyVersion(includePrerelease));
  console.log(`Target Bevy runtime version:  ${targetVersion}`);

  let baseVersion = currentVersion;
  if (targetVersion === currentVersion) {
    baseVersion = requestedFromVersion ?? inferPreviousVersion(targetVersion) ?? currentVersion;
  } else if (requestedFromVersion) {
    baseVersion = requestedFromVersion;
  }

  if (targetVersion === currentVersion && !isForce) {
    console.log(`\nBevy runtime is already at the target version (${currentVersion}).`);
    console.log("To re-run update, lockfile sync, and changelog generation anyway, specify --force.");
    return;
  }

  const isPrerelease = targetVersion.includes("-");
  const semverParts = targetVersion.split(".");
  const majorMinor = semverParts.length >= 2 ? `${semverParts[0]}.${semverParts[1]}` : targetVersion;

  console.log(`\nPlanned updates:`);
  console.log(`- Base (previous) version for diff: ${baseVersion}`);
  console.log(`- Root Cargo.toml: bevy -> ${targetVersion}, workspace dependencies -> ${isPrerelease ? targetVersion : majorMinor}`);
  console.log(`- crates/runtime-cdylib/Cargo.toml: bevy -> ${targetVersion}`);
  console.log(`- examples/android-demo-host/runtime/Cargo.toml: bevy -> ${targetVersion}`);

  const releaseInfo = await fetchReleaseNotes(baseVersion, targetVersion);

  if (isDryRun) {
    console.log("\n[DRY RUN] Would update Cargo manifests and lockfiles, and write to CHANGELOG.md.");
    console.log(`Upstream release URL: ${releaseInfo.releaseUrl}`);
    console.log(`Compare diff URL:     ${releaseInfo.compareUrl}`);
    return;
  }

  // 1. Update Cargo.toml files
  const newRootCargo = updateRootCargoToml(rootCargoContent, targetVersion, majorMinor, isPrerelease);
  writeFileSync(rootCargoPath, newRootCargo, "utf8");

  if (existsSync(cdylibCargoPath)) {
    const cdylibContent = readFileSync(cdylibCargoPath, "utf8");
    writeFileSync(cdylibCargoPath, updateHostCargoToml(cdylibContent, targetVersion), "utf8");
  }

  if (existsSync(androidHostCargoPath)) {
    const androidContent = readFileSync(androidHostCargoPath, "utf8");
    writeFileSync(androidHostCargoPath, updateHostCargoToml(androidContent, targetVersion), "utf8");
  }

  // 2. Update lockfile
  console.log("\nUpdating Cargo.lock dependencies...");
  run("cargo", ["update", "-p", "bevy"]);

  if (existsSync(androidHostCargoPath)) {
    console.log("\nUpdating android-demo-host Cargo.lock dependencies...");
    run("cargo", ["update", "-p", "bevy", "--manifest-path", androidHostCargoPath]);
  }

  // 3. Verification check
  let verificationStatus = "已跳过（指定了 `--no-check` 参数）。";
  if (!skipCheck) {
    console.log("\nRunning project verification checks (`just check`)...");
    try {
      run("just", ["check"]);
      verificationStatus = "`just check` 校验通过（Lua、JavaScript 与 TypeScript 各项目编译及类型检查均正常）。";
      console.log("Verification checks succeeded!");
    } catch (error) {
      console.error("\nVerification checks failed after updating Bevy version!");
      console.error(`Check upstream migration notes at: ${releaseInfo.compareUrl}`);
      verificationStatus = `校验未通过：编译或测试失败，可能存在不兼容的重大变更，需要手动进行迁移。`;
      writeOrUpdateChangelog(
        baseVersion,
        targetVersion,
        majorMinor,
        isPrerelease,
        releaseInfo,
        verificationStatus,
      );
      throw error;
    }
  }

  // 4. Update CHANGELOG.md
  writeOrUpdateChangelog(
    baseVersion,
    targetVersion,
    majorMinor,
    isPrerelease,
    releaseInfo,
    verificationStatus,
  );

  console.log(`\nSuccessfully updated Bevy runtime version: ${baseVersion} -> ${targetVersion}!`);
}

main().catch((err: unknown) => {
  console.error("\nError updating Bevy runtime version:", err instanceof Error ? err.message : err);
  process.exit(1);
});
