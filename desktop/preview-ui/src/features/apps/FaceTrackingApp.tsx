import { useMemo } from "react";

import { postTracking } from "../../api/client";
import { Button } from "../../components/Button";
import { CameraPreview } from "../../components/CameraPreview";
import { CameraStreamControls, cameraSelectionFromValue } from "../../components/CameraStreamControls";
import { CommandPanel } from "../../components/CommandPanel";
import { CommandStatus } from "../../components/CommandStatus";
import { MetricGrid } from "../../components/MetricGrid";
import { RawPanel } from "../../components/RawPanel";
import { useCommand } from "../../hooks/useCommand";
import { boolText, dash, latencyText, numberText, ratioPercent } from "../../model/format";
import type { PreviewSnapshot } from "../../../../src/preview/public-types";

export function FaceTrackingApp({
  snapshot,
  setSnapshot
}: {
  snapshot: PreviewSnapshot | null;
  setSnapshot?: (snapshot: PreviewSnapshot) => void;
}): JSX.Element {
  const status = snapshot?.status;
  const control = status?.control;
  const command = useCommand();
  const dropRate = status?.framesReceived ? status.framesDropped / status.framesReceived : 0;
  const target = snapshot?.target;
  const targetCenter = target ? `${numberText(target.x + target.width / 2, 2)}, ${numberText(target.y + target.height / 2, 2)}` : "-";
  const targetSize = target ? `${numberText(target.width, 2)} x ${numberText(target.height, 2)}` : "-";
  const firmwareControl = status?.faceTrackingControl;
  const firmwareYaw = firmwareControl
    ? `${dash(firmwareControl.currentYaw)} -> ${dash(firmwareControl.nextYaw)} (${dash(firmwareControl.yawDelta)})`
    : "-";
  const firmwarePitch = firmwareControl
    ? `${dash(firmwareControl.currentPitch)} -> ${dash(firmwareControl.nextPitch)} (${dash(firmwareControl.pitchDelta)})`
    : "-";
  const activeSelection = useMemo(
    () =>
      cameraSelectionFromValue({
        width: control?.camera?.width,
        height: control?.camera?.height,
        fps: control?.camera?.fps,
        quality: control?.camera?.quality
    }),
    [control?.camera?.fps, control?.camera?.height, control?.camera?.quality, control?.camera?.width]
  );
  const updateTracking = async (payload: unknown): Promise<PreviewSnapshot> => {
    const next = await postTracking(payload);
    setSnapshot?.(next);
    return next;
  };
  const updateControl = (patch: unknown): void => {
    void command.run(() => updateTracking({ control: patch }));
  };

  return (
    <div className="content-stack">
      <header className="module-header">
        <div>
          <div className="module-kicker">Application</div>
          <h2>人脸位置追踪</h2>
          <p>摄像头、人脸位置检测和舵机追踪的应用层状态。</p>
        </div>
      </header>
      <CameraPreview snapshot={snapshot} streamKind="processed" showTrackingOverlay />
      <section className="panel-block">
        <h3>状态</h3>
        <MetricGrid
          metrics={[
            { label: "Enabled", value: boolText(status?.enabled), tone: status?.enabled ? "ok" : "warn" },
            { label: "Faces", value: String(snapshot?.faces.length ?? 0) },
            { label: "Detector", value: status?.detectorAvailable ? "ready" : "down", tone: status?.detectorAvailable ? "ok" : "bad" },
            { label: "FPS", value: dash(status?.fps) },
            { label: "Drops", value: `${dash(status?.framesDropped)} / ${ratioPercent(dropRate)}` },
            { label: "Latency", value: latencyText(status?.detectorLatencyMs) },
            { label: "Target center", value: targetCenter },
            { label: "Target size", value: targetSize },
            { label: "Target detector", value: target?.detector ?? "-" },
            { label: "FW action", value: firmwareControl?.action ?? "-" },
            { label: "FW yaw", value: firmwareYaw },
            { label: "FW pitch", value: firmwarePitch },
            {
              label: "Media credit",
              value: status?.mediaCredit
                ? `${status.mediaCredit.grantedFrames} granted / ${status.mediaCredit.outstandingFrames} open`
                : "-"
            }
          ]}
        />
      </section>
      <CommandPanel title="参数输入">
        <div className="button-row">
          <Button disabled={command.pending} onClick={() => void command.run(() => updateTracking({ enabled: !status?.enabled }))}>
            {status?.enabled ? "Disable tracking" : "Enable tracking"}
          </Button>
        </div>
        <CameraStreamControls
          value={activeSelection}
          pending={command.pending}
          onChange={(selection) => void command.run(() => updateTracking({ control: { camera: selection } }))}
        />
        <div className="form-grid">
          <NumberField
            label="Speed"
            value={control?.speed}
            min={0}
            max={1000}
            step={10}
            onChange={(speed) => updateControl({ speed })}
          />
          <NumberField
            label="Deadband"
            value={control?.control?.deadband}
            min={0}
            max={0.3}
            step={0.005}
            onChange={(deadband) => updateControl({ control: { deadband } })}
          />
          <NumberField
            label="Yaw P"
            value={control?.control?.yaw?.kp}
            min={0}
            max={150}
            step={0.01}
            onChange={(kp) => updateControl({ control: { yaw: { kp } } })}
          />
          <NumberField
            label="Yaw I"
            value={control?.control?.yaw?.ki}
            min={0}
            max={50}
            step={0.01}
            onChange={(ki) => updateControl({ control: { yaw: { ki } } })}
          />
          <NumberField
            label="Yaw D"
            value={control?.control?.yaw?.kd}
            min={0}
            max={80}
            step={0.01}
            onChange={(kd) => updateControl({ control: { yaw: { kd } } })}
          />
          <SelectField
            label="Yaw direction"
            value={String(control?.control?.yaw?.direction ?? 1)}
            options={[
              { value: "1", label: "1" },
              { value: "-1", label: "-1" }
            ]}
            onChange={(direction) => updateControl({ control: { yaw: { direction: Number(direction) } } })}
          />
          <NumberField
            label="Pitch P"
            value={control?.control?.pitch?.kp}
            min={0}
            max={150}
            step={0.01}
            onChange={(kp) => updateControl({ control: { pitch: { kp } } })}
          />
          <NumberField
            label="Pitch I"
            value={control?.control?.pitch?.ki}
            min={0}
            max={50}
            step={0.01}
            onChange={(ki) => updateControl({ control: { pitch: { ki } } })}
          />
          <NumberField
            label="Pitch D"
            value={control?.control?.pitch?.kd}
            min={0}
            max={80}
            step={0.01}
            onChange={(kd) => updateControl({ control: { pitch: { kd } } })}
          />
          <SelectField
            label="Pitch direction"
            value={String(control?.control?.pitch?.direction ?? 1)}
            options={[
              { value: "1", label: "1" },
              { value: "-1", label: "-1" }
            ]}
            onChange={(direction) => updateControl({ control: { pitch: { direction: Number(direction) } } })}
          />
          <NumberField
            label="Integral"
            value={control?.control?.integralLimit}
            min={0}
            max={2}
            step={0.01}
            onChange={(integralLimit) => updateControl({ control: { integralLimit } })}
          />
          <NumberField
            label="Output limit"
            value={control?.control?.outputLimitDeg}
            min={1}
            max={45}
            step={0.1}
            onChange={(outputLimitDeg) => updateControl({ control: { outputLimitDeg } })}
          />
        </div>
        <CommandStatus status={command.status} />
      </CommandPanel>
      <RawPanel value={status} />
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <label className="field">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange
}: {
  label: string;
  value: number | undefined;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}): JSX.Element {
  return (
    <label className="field">
      {label}
      <input
        type="number"
        value={value ?? ""}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) {
            onChange(next);
          }
        }}
      />
    </label>
  );
}
