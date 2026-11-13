export interface CoreDevice {
  connectionProperties?: { tunnelState?: string };
  deviceProperties?: { ddiServicesAvailable?: boolean; developerModeStatus?: string; name?: string };
  hardwareProperties?: { marketingName?: string; platform?: string; reality?: string; udid?: string };
  identifier: string;
}

export function selectPhysicalDevice(devices: readonly CoreDevice[], requested?: string): CoreDevice | undefined {
  const available = devices.filter((device) => device.hardwareProperties?.platform === "iOS"
    && device.hardwareProperties.reality === "physical"
    && ["connected", "disconnected"].includes(device.connectionProperties?.tunnelState ?? "")
    && device.deviceProperties?.developerModeStatus === "enabled");
  // CoreDevice opens an available paired device's tunnel on demand. Before that,
  // ddiServicesAvailable can be false; excluding it incorrectly selects a simulator.
  return requested ? available.find((device) => [device.identifier, device.hardwareProperties?.udid,
    device.deviceProperties?.name].includes(requested)) : available[0];
}
