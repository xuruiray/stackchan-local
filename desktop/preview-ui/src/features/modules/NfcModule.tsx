import { ModulePage } from "../../components/ModulePage";
import { ageText, availabilityText, dash, integerText } from "../../model/format";
import { deviceUpdated, ModuleProps, nfc, p } from "./module-utils";

export function NfcModule({ snapshot }: ModuleProps): JSX.Element {
  const status = p(snapshot).nfc;
  const event = nfc(snapshot);
  return (
    <ModulePage
      title="NFC Probe"
      chip="NFC front-end"
      value={{ available: status?.available, reason: status?.reason, status, latestEvent: event }}
      updated={deviceUpdated(snapshot)}
      metrics={[
        { label: "Status", value: availabilityText(status) },
        { label: "Last action", value: dash(event.action) },
        { label: "UID", value: dash(event.uid) },
        { label: "Tech", value: dash(event.tech) },
        { label: "SAK", value: integerText(event.sak) },
        { label: "Reason", value: dash(event.reason) },
        { label: "Event age", value: ageText(event.receivedAt) }
      ]}
    />
  );
}
