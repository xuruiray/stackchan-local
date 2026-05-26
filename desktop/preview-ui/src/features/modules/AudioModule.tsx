import { ModulePage } from "../../components/ModulePage";
import { dash, integerText, numberText, ratioPercent } from "../../model/format";
import { deviceUpdated, ModuleProps, p, pow } from "./module-utils";

export function AudioModule({ snapshot }: ModuleProps): JSX.Element {
  const mic = p(snapshot).mic;
  const audio = { available: mic?.available, mic, speakerVolume: pow(snapshot).speakerVolume };
  return (
    <ModulePage
      title="Audio"
      chip="ES7210 / AW88298"
      value={audio}
      updated={deviceUpdated(snapshot)}
      metrics={[
        { label: "Mic available", value: dash(mic?.available) },
        { label: "Channels", value: integerText(mic?.channels) },
        { label: "Mode", value: dash(mic?.mode) },
        { label: "Level", value: ratioPercent(mic?.level) },
        { label: "RMS", value: numberText(mic?.rms, 3) },
        { label: "Peak", value: numberText(mic?.peak, 3) },
        { label: "dBFS", value: numberText(mic?.dbfs, 1, " dBFS") },
        { label: "Speaker", value: `${dash(pow(snapshot).speakerVolume)}%` }
      ]}
    />
  );
}
