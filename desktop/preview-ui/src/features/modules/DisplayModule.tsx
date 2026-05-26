import { ModulePage } from "../../components/ModulePage";
import { availabilityText, percentText } from "../../model/format";
import { deviceUpdated, ModuleProps, p, pow } from "./module-utils";

export function DisplayModule({ snapshot }: ModuleProps): JSX.Element {
  const display = { available: true, driver: "ili9342", backlight: pow(snapshot).backlight };
  return (
    <ModulePage
      title="Display"
      chip="ILI9342 panel"
      value={display}
      updated={deviceUpdated(snapshot)}
      metrics={[
        { label: "Panel", value: availabilityText(display) },
        { label: "Backlight", value: percentText(pow(snapshot).backlight) },
        { label: "Touch binding", value: availabilityText(p(snapshot).screenTouch) }
      ]}
    />
  );
}
