import type { PreviewSnapshot } from "../../../../src/preview/public-types";
import { ageText } from "../../model/format";
import {
  activeDevice,
  ambientLight,
  bmi270,
  irEvent,
  interaction,
  magnetometer,
  motion,
  network,
  nfcEvent,
  peripherals,
  power,
  proximity,
  hardwareStatus
} from "../../model/snapshot";

export type ModuleProps = {
  snapshot: PreviewSnapshot | null;
};

export type AnyRecord = Record<string, any>;

export function record(value: unknown): AnyRecord {
  return value && typeof value === "object" ? (value as AnyRecord) : {};
}

export function deviceUpdated(snapshot: PreviewSnapshot | null): string {
  return ageText(
    bmi270(snapshot)?.updatedAt ??
      proximity(snapshot)?.updatedAt ??
      ambientLight(snapshot)?.updatedAt ??
      nfcEvent(snapshot)?.updatedAt ??
      irEvent(snapshot)?.updatedAt ??
      hardwareStatus(snapshot)?.updatedAt ??
      activeDevice(snapshot)?.lastSeenAt
  );
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

export function bmi(snapshot: PreviewSnapshot | null): AnyRecord {
  return record(bmi270(snapshot));
}

export function mag(snapshot: PreviewSnapshot | null): AnyRecord {
  return record(magnetometer(snapshot));
}

export function prox(snapshot: PreviewSnapshot | null): AnyRecord {
  return record(proximity(snapshot));
}

export function als(snapshot: PreviewSnapshot | null): AnyRecord {
  return record(ambientLight(snapshot));
}

export function nfc(snapshot: PreviewSnapshot | null): AnyRecord {
  return record(nfcEvent(snapshot));
}

export function ir(snapshot: PreviewSnapshot | null): AnyRecord {
  return record(irEvent(snapshot));
}

export function inter(snapshot: PreviewSnapshot | null): AnyRecord {
  return record(interaction(snapshot));
}

export function net(snapshot: PreviewSnapshot | null): AnyRecord {
  return record(network(snapshot));
}
