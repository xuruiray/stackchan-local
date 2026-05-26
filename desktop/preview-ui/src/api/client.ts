import type {
  AvatarExpressionPayload,
  CommandApiResult,
  DebugSnapshot,
  PreviewSnapshot,
  RobotEmotion
} from "../../../src/preview/public-types";

export type DebugLogEntry = {
  id: number;
  time: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  type: "system" | "device" | "vision" | "command";
  context?: Record<string, unknown>;
};

export async function fetchStatus(): Promise<PreviewSnapshot> {
  return getJson<PreviewSnapshot>("/status");
}

export async function fetchDebugSnapshot(): Promise<DebugSnapshot> {
  return getJson<DebugSnapshot>("/debug/snapshot");
}

export async function fetchLogs(params: { limit?: number; type?: string; level?: string; search?: string } = {}): Promise<{
  logs: DebugLogEntry[];
}> {
  const search = new URLSearchParams();
  if (params.limit) search.set("limit", String(params.limit));
  if (params.type) search.set("type", params.type);
  if (params.level) search.set("level", params.level);
  if (params.search) search.set("search", params.search);
  const suffix = search.size ? `?${search.toString()}` : "";
  return getJson<{ logs: DebugLogEntry[] }>(`/debug/logs${suffix}`);
}

export function subscribeSnapshots(onSnapshot: (snapshot: PreviewSnapshot) => void, onError: () => void): () => void {
  const source = new EventSource("/events");
  source.onmessage = (event) => onSnapshot(JSON.parse(event.data) as PreviewSnapshot);
  source.onerror = onError;
  return () => source.close();
}

export function subscribeLogs(onLog: (entry: DebugLogEntry) => void): () => void {
  const source = new EventSource("/debug/log-events");
  source.onmessage = (event) => onLog(JSON.parse(event.data) as DebugLogEntry);
  return () => source.close();
}

export async function postTracking(payload: unknown): Promise<PreviewSnapshot> {
  return postJson<PreviewSnapshot>("/api/tracking", payload);
}

export async function setRgb(payload: { enabled: boolean; color?: string; brightness?: number }): Promise<CommandApiResult> {
  return postJson<CommandApiResult>("/api/rgb", payload);
}

export async function setExpression(payload: {
  emotion: RobotEmotion;
  durationMs?: number;
  flash?: boolean;
  rgbColor?: string;
  avatarJson?: AvatarExpressionPayload;
}): Promise<
  CommandApiResult & {
    emotion: RobotEmotion;
    durationMs: number;
    flash: boolean;
    rgbColor?: string;
    avatarJson?: AvatarExpressionPayload;
  }
> {
  return postJson<
    CommandApiResult & {
      emotion: RobotEmotion;
      durationMs: number;
      flash: boolean;
      rgbColor?: string;
      avatarJson?: AvatarExpressionPayload;
    }
  >("/api/expression", payload);
}

export async function setCompletionTts(payload: {
  enabled?: boolean;
  lightEnabled?: boolean;
  volume?: number;
}): Promise<CommandApiResult & { enabled: boolean; lightEnabled: boolean; volume: number }> {
  return postJson<CommandApiResult & { enabled: boolean; lightEnabled: boolean; volume: number }>(
    "/api/completion-tts",
    payload
  );
}

export async function testCompletionTts(): Promise<CommandApiResult & { id?: string }> {
  return postJson<CommandApiResult & { id?: string }>("/api/completion-tts-test", {});
}

export async function moveHead(payload: { yaw: number; pitch: number; speed?: number }): Promise<CommandApiResult> {
  return postJson<CommandApiResult>("/api/hardware/move-head", payload);
}

export async function cameraStream(payload: {
  enabled: boolean;
  fps?: number;
  width?: number;
  height?: number;
  quality?: number;
}): Promise<CommandApiResult> {
  return postJson<CommandApiResult>("/api/hardware/camera-stream", payload);
}

export async function rawPreview(payload: {
  enabled: boolean;
  fps?: number;
  width?: number;
  height?: number;
  quality?: number;
}): Promise<CommandApiResult & { snapshot?: PreviewSnapshot }> {
  return postJson<CommandApiResult & { snapshot?: PreviewSnapshot }>("/api/raw-preview", payload);
}

export async function captureImage(): Promise<CommandApiResult> {
  return postJson<CommandApiResult>("/api/hardware/capture-image", {});
}

export async function telemetryConfig(payload: {
  sensorSnapshotHz?: 0 | 0.5 | 1 | 2;
  imuHz?: 0 | 1 | 2 | 4 | 10;
  includeI2cScan?: boolean;
  reason?: string;
}): Promise<CommandApiResult> {
  return postJson<CommandApiResult>("/api/hardware/telemetry", payload);
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${path} failed with HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`${path} failed with HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}
