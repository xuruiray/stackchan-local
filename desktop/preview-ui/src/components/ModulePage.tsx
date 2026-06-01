import type { ReactNode } from "react";

import { availabilityOf, reasonOf } from "../model/snapshot";
import { ModuleHeader } from "./ModuleHeader";
import { MetricGrid, type Metric } from "./MetricGrid";
import { RawPanel } from "./RawPanel";

export function ModulePage({
  title,
  chip,
  value,
  updated,
  metrics,
  children
}: {
  title: string;
  chip: string;
  value: unknown;
  updated?: string;
  metrics: Metric[];
  children?: ReactNode;
}): JSX.Element {
  return (
    <div className="content-stack">
      <ModuleHeader
        title={title}
        chip={chip}
        status={availabilityOf(value)}
        updated={updated}
        reason={reasonOf(value)}
      />
      <section className="panel-block">
        <h3>当前数据</h3>
        <MetricGrid metrics={metrics} />
      </section>
      {children}
      <RawPanel value={value} />
    </div>
  );
}
