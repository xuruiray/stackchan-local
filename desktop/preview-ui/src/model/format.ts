export function dash(value: unknown): string {
  if (value === undefined || value === null || value === "") return "-";
  return String(value);
}

export function boolText(value: unknown): string {
  if (typeof value !== "boolean") return "-";
  return value ? "yes" : "no";
}

export function numberText(value: unknown, digits = 2, unit = ""): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(digits)}${unit}` : "-";
}

export function integerText(value: unknown, unit = ""): string {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}${unit}` : "-";
}

export function percentText(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}%` : "-";
}

export function ratioPercent(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value * 100)}%` : "-";
}

export function ageText(value: unknown): string {
  if (typeof value !== "string" || !value) return "-";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "-";
  const delta = Date.now() - time;
  if (delta < 0) return "now";
  if (delta < 1000) return "now";
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  return new Date(time).toLocaleTimeString();
}

export function latencyText(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
}

export function hexAddress(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? `0x${value.toString(16).padStart(2, "0")}` : "-";
}

export function joinValues(values: Array<string | undefined | null | false>): string {
  const parts = values.filter(Boolean);
  return parts.length ? parts.join(" / ") : "-";
}

export function availabilityText(value: unknown): string {
  if (!value || typeof value !== "object") return "-";
  const item = value as { available?: boolean; reason?: string; driver?: string; address?: number };
  if (item.available === false) {
    return joinValues(["unavailable", item.reason, item.driver, hexAddress(item.address) !== "-" && hexAddress(item.address)]);
  }
  if (item.available === true) {
    return joinValues(["available", item.driver, hexAddress(item.address) !== "-" && hexAddress(item.address)]);
  }
  return "-";
}

export function safeJson(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}
