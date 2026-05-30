import { ModulePage } from "../../components/ModulePage";
import { availabilityText, numberText } from "../../model/format";
import { deviceUpdated, mag, ModuleProps } from "./module-utils";

export function MagnetometerModule({ snapshot }: ModuleProps): JSX.Element {
  const magnetometer = mag(snapshot);
  return (
    <ModulePage
      title="Magnetometer"
      chip="BMI270 aux magnetometer"
      value={magnetometer}
      updated={deviceUpdated(snapshot)}
      metrics={[
        { label: "Status", value: availabilityText(magnetometer) },
        { label: "X", value: numberText(magnetometer?.x, 2) },
        { label: "Y", value: numberText(magnetometer?.y, 2) },
        { label: "Z", value: numberText(magnetometer?.z, 2) },
        { label: "Heading", value: numberText(magnetometer?.headingDeg, 1, " deg") }
      ]}
    />
  );
}
