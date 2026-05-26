import { ModulePage } from "../../components/ModulePage";
import { Metric, MetricGrid } from "../../components/MetricGrid";
import { integerText, numberText, percentText, boolText, availabilityText, hexAddress } from "../../model/format";
import { deviceUpdated, ModuleProps, p, pow } from "./module-utils";

export function PowerModule({ snapshot }: ModuleProps): JSX.Element {
  const power = pow(snapshot);
  const monitor = p(snapshot).powerMonitor;
  const metrics: Metric[] = [
    { label: "Battery", value: percentText(power.batteryLevel) },
    { label: "Charging", value: boolText(power.charging) },
    { label: "Backlight", value: percentText(power.backlight) },
    { label: "Speaker", value: percentText(power.speakerVolume) },
    { label: "Servo power", value: boolText(power.servoPower) },
    { label: "Power monitor", value: availabilityText(monitor) }
  ];
  return (
    <ModulePage title="Power / PMIC" chip="AXP2101 + power rails" value={power} updated={deviceUpdated(snapshot)} metrics={metrics}>
      <section className="panel-block">
        <h3>INA226 摘要</h3>
        <MetricGrid
          metrics={[
            { label: "Address", value: hexAddress(monitor?.address) },
            { label: "Bus voltage", value: numberText(monitor?.busVoltage, 3, " V") },
            { label: "Current", value: numberText(monitor?.current, 3, " A") },
            { label: "Power", value: numberText(monitor?.power, 3, " W") }
          ]}
        />
      </section>
    </ModulePage>
  );
}
