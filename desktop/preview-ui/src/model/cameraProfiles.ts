export type CameraPresetId = "fast" | "accurate" | "debug";

export type CameraProfile = {
  id: string;
  label: string;
  preset: CameraPresetId;
  width: number;
  height: number;
  fps: number;
  quality: number;
};

export const cameraFpsOptions = [15, 10, 8, 6] as const;

export const defaultCameraSettings = {
  width: 320,
  height: 240,
  fps: 10,
  quality: 14
};

export const cameraProfiles: CameraProfile[] = [
  { id: "qvga-10fps", label: "320 x 240 · 10 FPS", preset: "fast", width: 320, height: 240, fps: 10, quality: 14 },
  { id: "qvga-6fps", label: "320 x 240 · 6 FPS", preset: "accurate", width: 320, height: 240, fps: 6, quality: 28 },
  { id: "qvga-2fps", label: "320 x 240 · 2 FPS", preset: "debug", width: 320, height: 240, fps: 2, quality: 35 }
];

export const defaultCameraProfile = cameraProfiles[0];

export function cameraProfileByPreset(preset: unknown): CameraProfile | undefined {
  return cameraProfiles.find((profile) => profile.preset === preset);
}

export function cameraProfileByStream(value: {
  width?: unknown;
  height?: unknown;
  fps?: unknown;
  quality?: unknown;
}): CameraProfile | undefined {
  const fps = typeof value.fps === "number" && Number.isFinite(value.fps) ? Math.round(value.fps) : undefined;
  return cameraProfiles.find(
    (profile) =>
      profile.width === value.width &&
      profile.height === value.height &&
      (fps === undefined || profile.fps === fps) &&
      (value.quality === undefined || profile.quality === value.quality)
  );
}

export function numberSetting(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
