import { ModulePage } from "../../components/ModulePage";
import { availabilityText, hexAddress, numberText } from "../../model/format";
import { deviceUpdated, ModuleProps, p } from "./module-utils";

export function Ina226Module({ snapshot }: ModuleProps): JSX.Element {
  const monitor = p(snapshot).powerMonitor;
  return (
    <ModulePage
      title="Power Monitor"
      chip="INA226"
      value={monitor}
      updated={deviceUpdated(snapshot)}
      metrics={[
        { label: "Status", value: availabilityText(monitor) },
        { label: "Address", value: hexAddress(monitor?.address) },
        { label: "Bus voltage", value: numberText(monitor?.busVoltage, 3, " V") },
        { label: "Shunt voltage", value: numberText(monitor?.shuntVoltage, 3, " V") },
        { label: "Current", value: numberText(monitor?.current, 3, " A") },
        { label: "Power", value: numberText(monitor?.power, 3, " W") }
      ]}
    />
  );
}
