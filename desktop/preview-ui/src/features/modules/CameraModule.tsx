import { useEffect, useMemo } from "react";

import { captureImage, rawPreview } from "../../api/client";
import { Button } from "../../components/Button";
import { CameraPreview } from "../../components/CameraPreview";
import { CameraStreamControls, cameraSelectionFromValue } from "../../components/CameraStreamControls";
import { CommandPanel } from "../../components/CommandPanel";
import { CommandStatus } from "../../components/CommandStatus";
import { ModulePage } from "../../components/ModulePage";
import { useCommand } from "../../hooks/useCommand";
import { defaultCameraSettings } from "../../model/cameraProfiles";
import { boolText, dash, integerText, latencyText } from "../../model/format";
import { deviceUpdated, ModuleProps, p } from "./module-utils";
import type { PreviewSnapshot } from "../../../../src/preview/public-types";

export function CameraModule({
  snapshot,
  setSnapshot
}: ModuleProps & { setSnapshot?: (snapshot: PreviewSnapshot) => void }): JSX.Element {
  const camera = p(snapshot).camera;
  const control = snapshot?.status.control.camera;
  const sourceCamera = snapshot?.status.sourceCamera;
  const command = useCommand();
  const activeSelection = useMemo(
    () =>
      cameraSelectionFromValue({
        width: camera?.requestedWidth ?? sourceCamera?.width ?? control?.width,
        height: camera?.requestedHeight ?? sourceCamera?.height ?? control?.height,
        fps: camera?.fps ?? sourceCamera?.fps ?? control?.fps,
        quality: camera?.quality ?? sourceCamera?.quality ?? control?.quality
      }),
    [
      camera?.fps,
      camera?.quality,
      camera?.requestedHeight,
      camera?.requestedWidth,
      control?.fps,
      control?.height,
      control?.quality,
      control?.width,
      sourceCamera?.fps,
      sourceCamera?.height,
      sourceCamera?.quality,
      sourceCamera?.width
    ]
  );

  useEffect(() => {
    void applyRawPreview({
      enabled: true,
      fps: defaultCameraSettings.fps,
      width: defaultCameraSettings.width,
      height: defaultCameraSettings.height,
      quality: defaultCameraSettings.quality
    });
    return () => {
      void applyRawPreview({ enabled: false });
    };
  }, []);

  async function applyRawPreview(payload: Parameters<typeof rawPreview>[0]) {
    const result = await rawPreview(payload);
    if (result.snapshot) {
      setSnapshot?.(result.snapshot);
    }
    return result;
  }

  return (
    <ModulePage
      title="Camera"
      chip="GC0308 DVP"
      value={camera}
      updated={deviceUpdated(snapshot)}
      metrics={[
        { label: "Streaming", value: boolText(camera?.streaming) },
        { label: "Source", value: dash(sourceCamera?.owner) },
        { label: "Requested", value: `${dash(camera?.requestedWidth ?? control?.width)} x ${dash(camera?.requestedHeight ?? control?.height)}` },
        { label: "Actual", value: `${dash(camera?.actualWidth ?? camera?.width)} x ${dash(camera?.actualHeight ?? camera?.height)}` },
        { label: "FPS", value: integerText(camera?.fps ?? control?.fps) },
        { label: "Quality", value: integerText(camera?.quality ?? control?.quality) },
        { label: "Transport", value: dash(camera?.transport) },
        { label: "Frame interval", value: latencyText(camera?.lastFrameIntervalMs) },
        { label: "Capture", value: latencyText(camera?.lastCaptureMs) },
        { label: "Encode", value: latencyText(camera?.lastEncodeMs) },
        { label: "Send", value: latencyText(camera?.lastSendMs) },
        { label: "JPEG", value: integerText(camera?.lastJpegBytes, " B") },
        { label: "Fallback", value: dash(camera?.fallbackReason) }
      ]}
    >
      <CameraPreview snapshot={snapshot} streamKind="raw" showTrackingOverlay={false} />
      <CommandPanel>
        <CameraStreamControls
          value={activeSelection}
          pending={command.pending}
          onChange={(selection) => void command.run(() => applyRawPreview({ enabled: true, ...selection }))}
        />
        <div className="button-row">
          <Button
            disabled={command.pending}
            onClick={() =>
              void command.run(() =>
                applyRawPreview({
                  enabled: true,
                  ...activeSelection
                })
              )
            }
          >
            Stream on
          </Button>
          <Button disabled={command.pending} onClick={() => void command.run(() => applyRawPreview({ enabled: false }))}>
            Stream off
          </Button>
          <Button disabled={command.pending} onClick={() => void command.run(captureImage)}>
            Capture
          </Button>
        </div>
        <CommandStatus status={command.status} />
      </CommandPanel>
    </ModulePage>
  );
}
