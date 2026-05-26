import { ModulePage } from "../../components/ModulePage";
import { MetricGrid } from "../../components/MetricGrid";
import { availabilityText, dash, joinValues } from "../../model/format";
import { deviceUpdated, ModuleProps, p } from "./module-utils";

export function IOExpanderModule({ snapshot }: ModuleProps): JSX.Element {
  const io = p(snapshot).ioExpander;
  const scans = p(snapshot).i2cScan;
  return (
    <ModulePage title="IO Expander" chip="AW9523 / PY32 body IO" value={io} updated={deviceUpdated(snapshot)} metrics={[{ label: "Status", value: availabilityText(io) }]}>
      <section className="panel-block">
        <h3>I2C Scan</h3>
        <MetricGrid
          metrics={(Array.isArray(scans) ? scans : []).map((scan) => ({
            label: dash(scan.stage),
            value: joinValues([(scan.addresses ?? []).map((address: number) => `0x${address.toString(16).padStart(2, "0")}`).join(", "), scan.reason])
          }))}
        />
      </section>
    </ModulePage>
  );
}
