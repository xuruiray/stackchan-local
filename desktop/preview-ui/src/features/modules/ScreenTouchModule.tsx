import { ModulePage } from "../../components/ModulePage";
import { boolText, integerText } from "../../model/format";
import { deviceUpdated, inter, ModuleProps } from "./module-utils";

export function ScreenTouchModule({ snapshot }: ModuleProps): JSX.Element {
  const touch = inter(snapshot).screenTouch;
  return (
    <ModulePage
      title="Screen Touch"
      chip="FT6336"
      value={touch}
      updated={deviceUpdated(snapshot)}
      metrics={[
        { label: "Pressed", value: boolText(touch?.pressed) },
        { label: "X", value: integerText(touch?.x) },
        { label: "Y", value: integerText(touch?.y) },
        { label: "Points", value: integerText(touch?.points) }
      ]}
    />
  );
}
