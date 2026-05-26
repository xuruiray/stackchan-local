import { ModulePage } from "../../components/ModulePage";
import { availabilityText, dash } from "../../model/format";
import { deviceUpdated, ModuleProps, p } from "./module-utils";

export function RtcModule({ snapshot }: ModuleProps): JSX.Element {
  const rtc = p(snapshot).rtc;
  return (
    <ModulePage
      title="RTC"
      chip="PCF8563"
      value={rtc}
      updated={deviceUpdated(snapshot)}
      metrics={[
        { label: "Status", value: availabilityText(rtc) },
        { label: "Timestamp", value: dash(rtc?.timestamp) },
        { label: "Timezone", value: dash(rtc?.timezone) }
      ]}
    />
  );
}
