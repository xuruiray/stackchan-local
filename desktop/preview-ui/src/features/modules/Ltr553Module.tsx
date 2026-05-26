import { ModulePage } from "../../components/ModulePage";
import { MetricGrid } from "../../components/MetricGrid";
import { availabilityText, integerText, numberText } from "../../model/format";
import { deviceUpdated, ModuleProps, p } from "./module-utils";

export function Ltr553Module({ snapshot }: ModuleProps): JSX.Element {
  const proximity = p(snapshot).proximity;
  const ambientLight = p(snapshot).ambientLight;
  return (
    <ModulePage
      title="ALS / Proximity"
      chip="LTR553"
      value={{ proximity, ambientLight, available: proximity?.available || ambientLight?.available }}
      updated={deviceUpdated(snapshot)}
      metrics={[
        { label: "Proximity", value: availabilityText(proximity) },
        { label: "Ambient light", value: availabilityText(ambientLight) }
      ]}
    >
      <section className="panel-block">
        <h3>LTR553 Readings</h3>
        <MetricGrid
          metrics={[
            { label: "Proximity value", value: numberText(proximity?.value, 2) },
            { label: "Proximity raw", value: integerText(proximity?.raw) },
            { label: "ALS lux", value: numberText(ambientLight?.lux, 1, " lux") },
            { label: "ALS raw", value: integerText(ambientLight?.raw) }
          ]}
        />
      </section>
    </ModulePage>
  );
}
