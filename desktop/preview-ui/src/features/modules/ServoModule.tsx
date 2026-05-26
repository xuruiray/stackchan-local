import { useState } from "react";

import { moveHead } from "../../api/client";
import { Button } from "../../components/Button";
import { CommandPanel } from "../../components/CommandPanel";
import { CommandStatus } from "../../components/CommandStatus";
import { ModulePage } from "../../components/ModulePage";
import { useCommand } from "../../hooks/useCommand";
import { boolText, numberText } from "../../model/format";
import { deviceUpdated, ModuleProps, mot } from "./module-utils";

export function ServoModule({ snapshot }: ModuleProps): JSX.Element {
  const servos = mot(snapshot).servos;
  const command = useCommand();
  const [yaw, setYaw] = useState(0);
  const [pitch, setPitch] = useState(450);
  return (
    <ModulePage
      title="Servo Motion"
      chip="SCS servo bus"
      value={servos}
      updated={deviceUpdated(snapshot)}
      metrics={[
        { label: "Power", value: boolText(servos?.power) },
        { label: "Yaw angle", value: numberText(servos?.yaw?.angle, 1) },
        { label: "Yaw moving", value: boolText(servos?.yaw?.moving) },
        { label: "Yaw torque", value: boolText(servos?.yaw?.torque) },
        { label: "Pitch angle", value: numberText(servos?.pitch?.angle, 1) },
        { label: "Pitch moving", value: boolText(servos?.pitch?.moving) },
        { label: "Pitch torque", value: boolText(servos?.pitch?.torque) }
      ]}
    >
      <CommandPanel>
        <label className="field">Yaw <input type="number" value={yaw} min={-1280} max={1280} onChange={(event) => setYaw(Number(event.target.value))} /></label>
        <label className="field">Pitch <input type="number" value={pitch} min={0} max={900} onChange={(event) => setPitch(Number(event.target.value))} /></label>
        <div className="button-row">
          <Button variant="primary" disabled={command.pending} onClick={() => void command.run(() => moveHead({ yaw, pitch, speed: 420 }))}>
            Move
          </Button>
          <Button disabled={command.pending} onClick={() => void command.run(() => moveHead({ yaw: 0, pitch: 450, speed: 420 }))}>
            Center
          </Button>
        </div>
        <CommandStatus status={command.status} />
      </CommandPanel>
    </ModulePage>
  );
}
