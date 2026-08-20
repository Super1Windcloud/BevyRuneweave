import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

interface CoreDevice {
  connectionProperties?: { tunnelState?: string };
  deviceProperties?: {
    ddiServicesAvailable?: boolean;
    developerModeStatus?: string;
    name?: string;
  };
  hardwareProperties?: {
    marketingName?: string;
    platform?: string;
    reality?: string;
    udid?: string;
  };
  identifier: string;
}

interface CoreDeviceList {
  result?: { devices?: CoreDevice[] };
}

const root = resolve(import.meta.dirname, "..");
const release = process.argv.includes("--release");
const dryRun = process.argv.includes("--dry-run");
const project = resolve(root, "examples/ios-demo-host/BevyRuneweaveHost.xcodeproj");
const derivedData = resolve(root, "dist/ios-demo-derived-data");
const bundleIdentifier = "io.github.super1windcloud.runeweave.demo";

function run(command: string, args: string[]) {
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}

function output(command: string, args: string[]) {
  return execFileSync(command, args, { cwd: root, encoding: "utf8" });
}

function connectedPhysicalDevice() {
  const directory = mkdtempSync(join(tmpdir(), "runeweave-ios-devices-"));
  const jsonPath = join(directory, "devices.json");
  try {
    run("xcrun", ["devicectl", "list", "devices", "--json-output", jsonPath, "--quiet"]);
    const devices = (JSON.parse(readFileSync(jsonPath, "utf8")) as CoreDeviceList).result?.devices ?? [];
    const available = devices.filter((device) =>
      device.hardwareProperties?.platform === "iOS"
      && device.hardwareProperties.reality === "physical"
      && device.connectionProperties?.tunnelState === "connected"
      && device.deviceProperties?.ddiServicesAvailable === true
      && device.deviceProperties.developerModeStatus === "enabled"
    );
    const requested = process.env.RUNEWEAVE_IOS_DEVICE?.trim();
    return requested
      ? available.find((device) => [
          device.identifier,
          device.hardwareProperties?.udid,
          device.deviceProperties?.name,
        ].includes(requested))
      : available[0];
  } catch (error) {
    console.warn(`Could not enumerate physical iOS devices: ${String(error)}`);
    return undefined;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function configuredDevelopmentTeam() {
  const configured = process.env.RUNEWEAVE_IOS_DEVELOPMENT_TEAM?.trim();
  if (configured) return configured;
  try {
    const source = readFileSync(
      resolve(root, "examples/ios-demo-host/Config/DebugSecrets.xcconfig"),
      "utf8",
    );
    return source.match(/^DEVELOPMENT_TEAM\s*=\s*([A-Z0-9]{10})\s*$/m)?.[1];
  } catch {
    return undefined;
  }
}

function signingIdentityAvailable() {
  try {
    const result = output("security", ["find-identity", "-v", "-p", "codesigning"]);
    const count = result.match(/(\d+) valid identities found/)?.[1];
    return Number(count ?? 0) > 0;
  } catch {
    return false;
  }
}

function xcodebuild(
  configuration: "Debug" | "Release",
  sdk: string,
  destination: string,
  developmentTeam?: string,
) {
  const args = [
    "-project", project,
    "-scheme", "BevyRuneweaveHost",
    "-sdk", sdk,
    "-destination", destination,
    "-configuration", configuration,
    "-derivedDataPath", derivedData,
    "ARCHS=arm64",
    "ONLY_ACTIVE_ARCH=YES",
  ];
  if (developmentTeam) {
    args.push("-allowProvisioningUpdates", `DEVELOPMENT_TEAM=${developmentTeam}`);
  } else {
    args.push("CODE_SIGNING_ALLOWED=NO");
  }
  args.push("build");
  run("xcodebuild", args);
}

if (release) {
  if (dryRun) {
    console.log("Release builds target the simulator without installing or launching the app.");
    process.exit(0);
  }
  xcodebuild("Release", "iphonesimulator", "generic/platform=iOS Simulator");
  process.exit(0);
}

const physical = connectedPhysicalDevice();
const developmentTeam = configuredDevelopmentTeam();
const hasSigningIdentity = signingIdentityAvailable();
if (physical && developmentTeam && hasSigningIdentity) {
  const udid = physical.hardwareProperties?.udid ?? physical.identifier;
  const name = physical.deviceProperties?.name ?? physical.hardwareProperties?.marketingName ?? udid;
  console.log(`Using physical iOS device: ${name} (${udid})`);
  if (dryRun) process.exit(0);
  xcodebuild("Debug", "iphoneos", `id=${udid}`, developmentTeam);
  const app = join(derivedData, "Build/Products/Debug-iphoneos/BevyRuneweave.app");
  if (!existsSync(app)) throw new Error(`iOS device app does not exist: ${app}`);
  run("xcrun", ["devicectl", "device", "install", "app", "--device", physical.identifier, app]);
  console.log("Streaming app stdout and stderr. Close the app or press Ctrl-C to stop.");
  run("xcrun", [
    "devicectl", "device", "process", "launch",
    "--device", physical.identifier,
    "--terminate-existing",
    "--console",
    bundleIdentifier,
  ]);
} else {
  if (physical) {
    const reason = !developmentTeam
      ? "RUNEWEAVE_IOS_DEVELOPMENT_TEAM is not configured"
      : "no valid Apple Development signing identity is installed";
    console.warn(`Connected iPhone found, but ${reason}; falling back to the simulator.`);
  } else {
    const requested = process.env.RUNEWEAVE_IOS_DEVICE?.trim();
    console.warn(requested
      ? `Requested physical iOS device '${requested}' is not available; falling back to the simulator.`
      : "No available physical iOS device was found; falling back to the simulator.");
  }
  if (dryRun) process.exit(0);
  xcodebuild("Debug", "iphonesimulator", "generic/platform=iOS Simulator");
  run("npm", ["exec", "--", "tsx", "scripts/launch-ios-demo.ts"]);
}
