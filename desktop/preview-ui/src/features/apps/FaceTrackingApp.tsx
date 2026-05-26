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
  const activeSelection = useMemo(
    () =>
      cameraSelectionFromValue({
        width: control?.camera.width,
        height: control?.camera.height,
        fps: control?.camera.fps,
        quality: control?.camera.quality
    }),
    [control?.camera.fps, control?.camera.height, control?.camera.quality, control?.camera.width]
  );
  const updateTracking = async (payload: unknown): Promise<PreviewSnapshot> => {
    const next = await postTracking(payload);
    setSnapshot?.(next);
    return next;
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
        <CommandStatus status={command.status} />
      </CommandPanel>
      <RawPanel value={status} />
    </div>
  );
}
