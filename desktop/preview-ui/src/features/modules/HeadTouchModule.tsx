import { ModulePage } from "../../components/ModulePage";
import { boolText, dash, joinValues } from "../../model/format";
import { deviceUpdated, inter, ModuleProps } from "./module-utils";

export function HeadTouchModule({ snapshot }: ModuleProps): JSX.Element {
  const touch = inter(snapshot).headTouch;
  return (
    <ModulePage
      title="Head Touch"
      chip="SI12T"
      value={touch}
      updated={deviceUpdated(snapshot)}
      metrics={[
        { label: "Pressed", value: boolText(touch?.pressed) },
        { label: "Gesture", value: dash(touch?.gesture) },
        { label: "Zones", value: Array.isArray(touch?.zones) ? joinValues(touch.zones.map(String)) : "-" }
      ]}
    />
  );
}
