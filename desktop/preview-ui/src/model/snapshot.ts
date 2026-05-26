import type { DeviceSnapshot } from "../../../src/device/registry";
import type { PreviewSnapshot } from "../../../src/preview/public-types";

export function activeDevice(snapshot: PreviewSnapshot | null | undefined): DeviceSnapshot | undefined {
  return snapshot?.devices?.find((device) => device.status === "online") ?? snapshot?.devices?.[0];
}

export function sensorSnapshot(snapshot: PreviewSnapshot | null | undefined) {
  return activeDevice(snapshot)?.sensors.sensorSnapshot;
}

export function peripherals(snapshot: PreviewSnapshot | null | undefined) {
  return sensorSnapshot(snapshot)?.peripherals ?? {};
}

export function power(snapshot: PreviewSnapshot | null | undefined) {
  return sensorSnapshot(snapshot)?.power ?? {};
}

export function motion(snapshot: PreviewSnapshot | null | undefined) {
  return sensorSnapshot(snapshot)?.motion ?? {};
}

export function interaction(snapshot: PreviewSnapshot | null | undefined) {
  return sensorSnapshot(snapshot)?.interaction ?? {};
}

export function network(snapshot: PreviewSnapshot | null | undefined) {
  return sensorSnapshot(snapshot)?.network ?? {};
}

export function availabilityOf(value: unknown): "available" | "unavailable" | "unknown" {
  if (typeof value === "object" && value !== null && "available" in value) {
    const available = (value as { available?: unknown }).available;
    if (available === true) return "available";
    if (available === false) return "unavailable";
  }
  return value ? "available" : "unknown";
}

export function reasonOf(value: unknown): string | undefined {
  return typeof value === "object" && value !== null && typeof (value as { reason?: unknown }).reason === "string"
    ? (value as { reason: string }).reason
    : undefined;
}
