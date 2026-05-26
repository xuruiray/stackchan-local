import type { ReactNode } from "react";

import { telemetryConfig } from "../api/client";
import { useCommand } from "../hooks/useCommand";
import { availabilityOf, reasonOf } from "../model/snapshot";
import { Button } from "./Button";
import { CommandPanel } from "./CommandPanel";
import { CommandStatus } from "./CommandStatus";
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
  const command = useCommand();
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
      <CommandPanel title="Telemetry">
        <div className="button-row">
          <Button
            disabled={command.pending}
            onClick={() => void command.run(() => telemetryConfig({ sensorSnapshotHz: 2, imuHz: 10, reason: "preview-ui" }))}
          >
            Refresh telemetry
          </Button>
          <Button
            disabled={command.pending}
            onClick={() =>
              void command.run(() =>
                telemetryConfig({ sensorSnapshotHz: 1, imuHz: 10, includeI2cScan: true, reason: "preview-ui i2c scan" })
              )
            }
          >
            I2C scan
          </Button>
        </div>
        <CommandStatus status={command.status} />
      </CommandPanel>
      <RawPanel value={value} />
    </div>
  );
}
