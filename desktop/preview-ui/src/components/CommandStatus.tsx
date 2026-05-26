export function CommandStatus({ status }: { status: string }): JSX.Element {
  const tone = status.startsWith("accepted") ? "ok" : status === "ready" ? "muted" : status === "sending" ? "warn" : "bad";
  return <span className={`command-status tone-${tone}`}>{status}</span>;
}
