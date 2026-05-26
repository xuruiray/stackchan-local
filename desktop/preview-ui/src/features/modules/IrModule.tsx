import { ModulePage } from "../../components/ModulePage";
import { availabilityText, dash, integerText } from "../../model/format";
import { deviceUpdated, ModuleProps, p } from "./module-utils";

export function IrModule({ snapshot }: ModuleProps): JSX.Element {
  const ir = p(snapshot).ir;
  return (
    <ModulePage
      title="IR"
      chip="IR TX/RX"
      value={ir}
      updated={deviceUpdated(snapshot)}
      metrics={[
        { label: "Status", value: availabilityText(ir) },
        { label: "Driver", value: dash(ir?.driver) },
        { label: "TX GPIO", value: integerText(ir?.txPin) },
        { label: "RX GPIO", value: integerText(ir?.rxPin) }
      ]}
    />
  );
}
