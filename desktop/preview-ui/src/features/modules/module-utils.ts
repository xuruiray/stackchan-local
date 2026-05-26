import type { PreviewSnapshot } from "../../../../src/preview/public-types";
import { ageText } from "../../model/format";
import { activeDevice, interaction, motion, network, peripherals, power, sensorSnapshot } from "../../model/snapshot";

export type ModuleProps = {
  snapshot: PreviewSnapshot | null;
};

export type AnyRecord = Record<string, any>;

export function record(value: unknown): AnyRecord {
  return value && typeof value === "object" ? (value as AnyRecord) : {};
}

export function deviceUpdated(snapshot: PreviewSnapshot | null): string {
  return ageText(sensorSnapshot(snapshot)?.updatedAt ?? activeDevice(snapshot)?.lastSeenAt);
}

export function p(snapshot: PreviewSnapshot | null): AnyRecord {
  return record(peripherals(snapshot));
}

export function pow(snapshot: PreviewSnapshot | null): AnyRecord {
  return record(power(snapshot));
}

export function mot(snapshot: PreviewSnapshot | null): AnyRecord {
  return record(motion(snapshot));
}

export function inter(snapshot: PreviewSnapshot | null): AnyRecord {
  return record(interaction(snapshot));
}

export function net(snapshot: PreviewSnapshot | null): AnyRecord {
  return record(network(snapshot));
}
