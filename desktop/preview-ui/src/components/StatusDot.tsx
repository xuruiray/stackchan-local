export type StatusKind = "available" | "unavailable" | "warning" | "unknown" | "online";

export function StatusDot({ status }: { status: StatusKind }): JSX.Element {
  return <span className={`status-dot status-${status}`} aria-hidden="true" />;
}
