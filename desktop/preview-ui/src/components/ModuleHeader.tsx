import { StatusDot, type StatusKind } from "./StatusDot";

export function ModuleHeader({
  title,
  chip,
  status,
  updated,
  reason
}: {
  title: string;
  chip: string;
  status: StatusKind;
  updated?: string;
  reason?: string;
}): JSX.Element {
  return (
    <header className="module-header">
      <div>
        <div className="module-kicker">{chip}</div>
        <h2>{title}</h2>
        {reason ? <p>{reason}</p> : null}
      </div>
      <div className="module-state">
        <StatusDot status={status} />
        <span>{status}</span>
        <small>{updated ?? "-"}</small>
      </div>
    </header>
  );
}
