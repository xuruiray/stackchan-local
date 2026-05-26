import { safeJson } from "../model/format";

export function RawPanel({ value }: { value: unknown }): JSX.Element {
  return (
    <section className="panel-block">
      <h3>Raw</h3>
      <pre className="raw-json">{safeJson(value)}</pre>
    </section>
  );
}
