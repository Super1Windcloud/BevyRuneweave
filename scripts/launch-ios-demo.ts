import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

interface SimulatorDevice {
  deviceTypeIdentifier: string;
  isAvailable: boolean;
  name: string;
  state: string;
  udid: string;
}

interface SimulatorList {
  devices: Record<string, SimulatorDevice[]>;
}

const root = resolve(import.meta.dirname, "..");
const app = resolve(
  root,
  process.argv[2] ?? "dist/ios-demo-derived-data/Build/Products/Debug-iphonesimulator/BevyRuneweave.app",
);
const bundleIdentifier = process.argv[3] ?? "io.github.super1windcloud.runeweave.demo";

if (!existsSync(app)) throw new Error(`iOS demo app does not exist: ${app}`);

function run(command: string, args: string[]) {
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}

function output(command: string, args: string[]) {
  return execFileSync(command, args, { cwd: root, encoding: "utf8" });
}

const simulatorList = JSON.parse(output("xcrun", ["simctl", "list", "devices", "available", "-j"])) as SimulatorList;
const devices = Object.entries(simulatorList.devices)
  .filter(([runtime]) => runtime.includes(".SimRuntime.iOS-"))
  .flatMap(([, runtimeDevices]) => runtimeDevices)
  .filter((device) => device.isAvailable && ["Booted", "Shutdown"].includes(device.state));
const requestedDevice = process.env.RUNEWEAVE_IOS_SIMULATOR?.trim();
const selected = requestedDevice
  ? devices.find((device) => device.udid === requestedDevice || device.name === requestedDevice)
  : devices.find((device) => device.state === "Booted" && device.deviceTypeIdentifier.includes(".iPhone-"))
    ?? devices.find((device) => device.state === "Booted")
    ?? devices.find((device) => device.deviceTypeIdentifier.includes(".iPhone-"));

if (!selected) {
  const detail = requestedDevice ? ` matching '${requestedDevice}'` : "";
  throw new Error(`No available iOS Simulator${detail}`);
}

console.log(`iOS Simulator: ${selected.name} (${selected.udid})`);
if (selected.state === "Shutdown") run("xcrun", ["simctl", "boot", selected.udid]);
run("open", ["-a", "Simulator"]);
run("xcrun", ["simctl", "bootstatus", selected.udid, "-b"]);
run("xcrun", ["simctl", "install", selected.udid, app]);
run("xcrun", ["simctl", "launch", "--terminate-running-process", selected.udid, bundleIdentifier]);
