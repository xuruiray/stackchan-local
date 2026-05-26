export type Metric = {
  label: string;
  value: string | number | JSX.Element;
  tone?: "ok" | "warn" | "bad" | "muted";
};

export function MetricGrid({ metrics }: { metrics: Metric[] }): JSX.Element {
  return (
    <div className="metric-grid">
      {metrics.map((metric) => (
        <div className="metric-row" key={metric.label}>
          <span>{metric.label}</span>
          <strong className={metric.tone ? `tone-${metric.tone}` : undefined}>{metric.value}</strong>
        </div>
      ))}
    </div>
  );
}
