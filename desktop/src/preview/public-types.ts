import type { DeviceSnapshot } from "../device/registry.js";
import type { VisionPreviewSnapshot } from "../vision/tracking.js";

export type PublicVisionFrame = Omit<NonNullable<VisionPreviewSnapshot["frame"]>, "dataBase64">;

export type CompletionTtsSnapshot = {
  enabled: boolean;
  lightEnabled: boolean;
  volume: number;
};

export type PreviewSnapshot = Omit<VisionPreviewSnapshot, "frame"> & {
  frame?: PublicVisionFrame;
  devices?: DeviceSnapshot[];
  completionTts?: CompletionTtsSnapshot;
};

export type DebugSnapshot = {
  vision: PreviewSnapshot;
  devices: DeviceSnapshot[];
  completionTts: CompletionTtsSnapshot;
  logs: unknown[];
};

export type CommandApiResult = {
  ok: boolean;
  sent?: boolean;
  reason?: string;
  error?: string;
  ack?: unknown;
  completion?: unknown;
  command?: unknown;
  [key: string]: unknown;
};
