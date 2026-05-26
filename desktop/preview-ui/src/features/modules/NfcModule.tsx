import { ModulePage } from "../../components/ModulePage";
import { availabilityText, dash, hexAddress } from "../../model/format";
import { deviceUpdated, ModuleProps, p } from "./module-utils";

export function NfcModule({ snapshot }: ModuleProps): JSX.Element {
  const nfc = p(snapshot).nfc;
  return (
    <ModulePage
      title="NFC Probe"
      chip="NFC front-end"
      value={nfc}
      updated={deviceUpdated(snapshot)}
      metrics={[
        { label: "Status", value: availabilityText(nfc) },
        { label: "Driver", value: dash(nfc?.driver) },
        { label: "Address", value: hexAddress(nfc?.address) },
        { label: "Probe state", value: dash(nfc?.status) }
      ]}
    />
  );
}
