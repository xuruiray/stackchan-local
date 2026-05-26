import { useEffect, useMemo, useState } from "react";

import { cameraFpsOptions, defaultCameraSettings, numberSetting } from "../model/cameraProfiles";
import { Button } from "./Button";

export type CameraStreamSelection = {
  width: number;
  height: number;
  fps: number;
  quality: number;
};

export function cameraSelectionFromValue(value: {
  width?: unknown;
  height?: unknown;
  fps?: unknown;
  quality?: unknown;
}): CameraStreamSelection {
  return {
    width: defaultCameraSettings.width,
    height: defaultCameraSettings.height,
    fps: numberSetting(value.fps) ?? defaultCameraSettings.fps,
    quality: numberSetting(value.quality) ?? defaultCameraSettings.quality
  };
}

export function CameraStreamControls({
  value,
  pending,
  onChange
}: {
  value: CameraStreamSelection;
  pending?: boolean;
  onChange: (selection: CameraStreamSelection) => void;
}): JSX.Element {
  const normalized = useMemo(
    () => cameraSelectionFromValue(value),
    [value.fps, value.height, value.quality, value.width]
  );
  const [draft, setDraft] = useState(normalized);

  useEffect(() => {
    if (!pending) {
      setDraft(normalized);
    }
  }, [normalized, pending]);

  const apply = (patch: Partial<CameraStreamSelection>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    onChange(next);
  };

  return (
    <div className="camera-control-grid">
      <div className="control-group">
        <div className="control-label">FPS</div>
        <div className="segmented">
          {cameraFpsOptions.map((fps) => (
            <Button
              key={fps}
              disabled={pending}
              variant={Math.round(draft.fps) === fps ? "primary" : "default"}
              onClick={() => apply({ fps })}
            >
              {fps} FPS
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
