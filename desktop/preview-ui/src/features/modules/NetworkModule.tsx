import { ModulePage } from "../../components/ModulePage";
import { boolText, dash, integerText } from "../../model/format";
import { deviceUpdated, ModuleProps, net } from "./module-utils";

export function NetworkModule({ snapshot }: ModuleProps): JSX.Element {
  const wifi = net(snapshot).wifi;
  const ble = net(snapshot).ble;
  return (
    <ModulePage
      title="Network"
      chip="ESP32-S3 Wi-Fi / BLE"
      value={{ wifi, ble, available: Boolean(wifi || ble) }}
      updated={deviceUpdated(snapshot)}
      metrics={[
        { label: "Wi-Fi", value: dash(wifi?.status) },
        { label: "SSID", value: dash(wifi?.ssid) },
        { label: "RSSI", value: integerText(wifi?.rssi, " dBm") },
        { label: "BLE connected", value: boolText(ble?.connected) }
      ]}
    />
  );
}
