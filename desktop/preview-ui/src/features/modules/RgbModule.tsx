import { useState } from "react";

import { setRgb } from "../../api/client";
import { Button } from "../../components/Button";
import { CommandPanel } from "../../components/CommandPanel";
import { CommandStatus } from "../../components/CommandStatus";
import { ModulePage } from "../../components/ModulePage";
import { useCommand } from "../../hooks/useCommand";
import { boolText, dash, integerText, ratioPercent } from "../../model/format";
import { deviceUpdated, ModuleProps, p } from "./module-utils";

export function RgbModule({ snapshot }: ModuleProps): JSX.Element {
  const rgb = p(snapshot).rgb;
  const [color, setColor] = useState(rgb?.color ?? "#43D5B0");
  const [brightness, setBrightness] = useState(Math.round((rgb?.brightness ?? 0.8) * 100));
  const command = useCommand();
  const send = (enabled: boolean, nextColor = color) =>
    command.run(() => setRgb({ enabled, color: nextColor, brightness: brightness / 100 }));
  return (
    <ModulePage
      title="RGB LED"
      chip="Body RGB strip"
      value={rgb}
      updated={deviceUpdated(snapshot)}
      metrics={[
        { label: "Enabled", value: boolText(rgb?.enabled) },
        { label: "Count", value: integerText(rgb?.count) },
        { label: "Color", value: dash(rgb?.color) },
        { label: "Brightness", value: ratioPercent(rgb?.brightness) },
        { label: "Driver", value: dash(rgb?.driver) }
      ]}
    >
      <CommandPanel>
        <label className="field">Color <input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
        <label className="field">Brightness <input type="range" min="0" max="100" value={brightness} onChange={(event) => setBrightness(Number(event.target.value))} /></label>
        <div className="swatches">
          {["#43D5B0", "#6CB6FF", "#E3B341", "#F47067", "#FFFFFF"].map((item) => (
            <button key={item} style={{ background: item }} aria-label={item} onClick={() => { setColor(item); void send(true, item); }} />
          ))}
        </div>
        <div className="button-row">
          <Button variant="primary" disabled={command.pending} onClick={() => void send(true)}>On</Button>
          <Button disabled={command.pending} onClick={() => void send(false)}>Off</Button>
        </div>
        <CommandStatus status={command.status} />
      </CommandPanel>
    </ModulePage>
  );
}
