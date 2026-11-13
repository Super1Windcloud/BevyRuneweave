import assert from "node:assert/strict";
import { test } from "node:test";
import { selectPhysicalDevice, type CoreDevice } from "./ios-device-selection.js";

const device = (id: string, tunnel: string, enabled = true): CoreDevice => ({ identifier: id,
  connectionProperties: { tunnelState: tunnel }, deviceProperties: { developerModeStatus: enabled ? "enabled" : "disabled", ddiServicesAvailable: false, name: id },
  hardwareProperties: { platform: "iOS", reality: "physical", udid: `${id}-udid` } });
test("a paired on-demand tunnel remains eligible before DDI services start", () => {
  const paired = device("paired", "disconnected");
  assert.equal(selectPhysicalDevice([device("offline", "unavailable"), paired]), paired);
});
test("explicit device selection never chooses another phone", () => {
  const first = device("first", "connected"), second = device("second", "disconnected");
  assert.equal(selectPhysicalDevice([first, second], "second-udid"), second);
  assert.equal(selectPhysicalDevice([first, second], "missing"), undefined);
});
test("unavailable devices, disabled developer mode and simulators are excluded", () => {
  assert.equal(selectPhysicalDevice([device("offline", "unavailable"), device("locked", "connected", false),
    { ...device("simulator", "connected"), hardwareProperties: { platform: "iOS", reality: "virtual" } }]), undefined);
});
