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
import { boolText, dash, integerText } from "../../model/format";
import { deviceUpdated, ModuleProps, p } from "./module-utils";
import type { PreviewSnapshot } from "../../../../src/preview/public-types";

export function CameraModule({
  snapshot,
  setSnapshot
}: ModuleProps & { setSnapshot?: (snapshot: PreviewSnapshot) => void }): JSX.Element {
  const camera = p(snapshot).camera;
  const control = snapshot?.status.control.camera;
  const sourceCamera = snapshot?.status.sourceCamera;
  const rawPreviewCamera = snapshot?.status.rawPreview.camera;
  const command = useCommand();
  const activeSelection = useMemo(
    () =>
      cameraSelectionFromValue({
        width: rawPreviewCamera?.width ?? sourceCamera?.width ?? control?.width,
        height: rawPreviewCamera?.height ?? sourceCamera?.height ?? control?.height,
        fps: rawPreviewCamera?.fps ?? sourceCamera?.fps ?? control?.fps,
        quality: rawPreviewCamera?.quality ?? sourceCamera?.quality ?? control?.quality
      }),
    [
      control?.fps,
      control?.height,
      control?.quality,
      control?.width,
      rawPreviewCamera?.fps,
      rawPreviewCamera?.height,
      rawPreviewCamera?.quality,
      rawPreviewCamera?.width,
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
        { label: "Requested", value: `${dash(rawPreviewCamera?.width ?? sourceCamera?.width ?? control?.width)} x ${dash(rawPreviewCamera?.height ?? sourceCamera?.height ?? control?.height)}` },
        { label: "FPS", value: integerText(rawPreviewCamera?.fps ?? sourceCamera?.fps ?? control?.fps) },
        { label: "Quality", value: integerText(rawPreviewCamera?.quality ?? sourceCamera?.quality ?? control?.quality) }
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
