import { ModulePage } from "../../components/ModulePage";
import { Metric, MetricGrid } from "../../components/MetricGrid";
import { numberText, percentText, boolText, availabilityText } from "../../model/format";
import { deviceUpdated, ModuleProps, mot, p, pow } from "./module-utils";

export function PowerModule({ snapshot }: ModuleProps): JSX.Element {
  const power = pow(snapshot);
  const monitor = p(snapshot).powerMonitor;
  const servos = mot(snapshot).servos;
  const value = {
    available: power.batteryLevel !== undefined || monitor?.available === true,
    power,
    powerMonitor: monitor,
    servos
  };
  const metrics: Metric[] = [
    { label: "Battery", value: percentText(power.batteryLevel) },
    { label: "Charging", value: boolText(power.charging) },
    { label: "Backlight", value: percentText(power.backlight) },
    { label: "Speaker", value: percentText(power.speakerVolume) },
    { label: "Servo power", value: boolText(servos?.power) },
    { label: "Power monitor", value: availabilityText(monitor) }
  ];
  return (
    <ModulePage title="Power / PMIC" chip="AXP2101 + INA226" value={value} updated={deviceUpdated(snapshot)} metrics={metrics}>
      <section className="panel-block">
        <h3>INA226 Power Monitor</h3>
        <MetricGrid
          metrics={[
            { label: "Status", value: availabilityText(monitor) },
            { label: "Bus voltage", value: numberText(monitor?.busVoltage, 3, " V") },
            { label: "Shunt voltage", value: numberText(monitor?.shuntVoltage, 3, " V") },
            { label: "Current", value: numberText(monitor?.current, 3, " A") },
            { label: "Power", value: numberText(monitor?.power, 3, " W") }
          ]}
        />
      </section>
    </ModulePage>
  );
}
