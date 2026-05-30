import { ModulePage } from "../../components/ModulePage";
import { ageText, availabilityText, boolText, dash } from "../../model/format";
import { deviceUpdated, ir, ModuleProps, p } from "./module-utils";

export function IrModule({ snapshot }: ModuleProps): JSX.Element {
  const status = p(snapshot).ir;
  const event = ir(snapshot);
  return (
    <ModulePage
      title="IR"
      chip="IR TX/RX"
      value={{ available: status?.available, reason: status?.reason, status, latestEvent: event }}
      updated={deviceUpdated(snapshot)}
      metrics={[
        { label: "Status", value: availabilityText(status) },
        { label: "Last action", value: dash(event.action) },
        { label: "Protocol", value: dash(event.protocol) },
        { label: "Address", value: dash(event.address) },
        { label: "Command", value: dash(event.command) },
        { label: "Repeat", value: boolText(event.repeat) },
        { label: "Reason", value: dash(event.reason) },
        { label: "Event age", value: ageText(event.receivedAt) }
      ]}
    />
  );
}
