import { ModulePage } from "../../components/ModulePage";
import { availabilityText } from "../../model/format";
import { deviceUpdated, ModuleProps, p } from "./module-utils";

export function AudioModule({ snapshot }: ModuleProps): JSX.Element {
  const mic = p(snapshot).mic;
  return (
    <ModulePage
      title="Audio"
      chip="ES7210 / AW88298"
      value={mic}
      updated={deviceUpdated(snapshot)}
      metrics={[
        { label: "Mic", value: availabilityText(mic) }
      ]}
    />
  );
}
