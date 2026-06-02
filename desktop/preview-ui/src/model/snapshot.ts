import type { DeviceSnapshot } from "../../../src/device/registry";
import type { PreviewSnapshot } from "../../../src/preview/public-types";

export function activeDevice(snapshot: PreviewSnapshot | null | undefined): DeviceSnapshot | undefined {
  return snapshot?.devices?.find((device) => device.status === "online") ?? snapshot?.devices?.[0];
}

export function hardwareStatus(snapshot: PreviewSnapshot | null | undefined) {
  return activeDevice(snapshot)?.sensors.hardwareStatus;
}

export function bmi270(snapshot: PreviewSnapshot | null | undefined) {
  return activeDevice(snapshot)?.sensors.bmi270;
}

export function proximity(snapshot: PreviewSnapshot | null | undefined) {
  return activeDevice(snapshot)?.sensors.proximity;
}

export function ambientLight(snapshot: PreviewSnapshot | null | undefined) {
  return activeDevice(snapshot)?.sensors.ambientLight;
}

export function nfcEvent(snapshot: PreviewSnapshot | null | undefined) {
  return activeDevice(snapshot)?.sensors.nfc;
}

export function irEvent(snapshot: PreviewSnapshot | null | undefined) {
  return activeDevice(snapshot)?.sensors.ir;
}

export function peripherals(snapshot: PreviewSnapshot | null | undefined) {
  return hardwareStatus(snapshot)?.peripherals ?? {};
}

export function power(snapshot: PreviewSnapshot | null | undefined) {
  return hardwareStatus(snapshot)?.power ?? {};
}

export function motion(snapshot: PreviewSnapshot | null | undefined) {
  const device = activeDevice(snapshot);
  return {
    ...(hardwareStatus(snapshot)?.motion ?? {}),
    ...(device?.sensors.bmi270 ? { bmi270: device.sensors.bmi270 } : {})
  };
}

export function interaction(snapshot: PreviewSnapshot | null | undefined) {
  const touch = activeDevice(snapshot)?.sensors.touch;
  const screenTouchTelemetry = hardwareStatus(snapshot)?.peripherals?.screenTouch;
  const screenTouchEvent = touch?.surface === "screen" ? touch : undefined;
  const headTouchTelemetry = hardwareStatus(snapshot)?.peripherals?.headTouch;
  const headTouchEvent = touch?.surface === "head" ? touch : undefined;
  return {
    screenTouch: screenTouchTelemetry || screenTouchEvent
      ? { ...(screenTouchTelemetry ?? {}), ...(screenTouchEvent ?? {}) }
      : undefined,
    headTouch: headTouchTelemetry || headTouchEvent ? { ...(headTouchTelemetry ?? {}), ...(headTouchEvent ?? {}) } : undefined
  };
}

export function network(snapshot: PreviewSnapshot | null | undefined) {
  return hardwareStatus(snapshot)?.network ?? {};
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
