import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type FaceTrackingCameraPreset = "fast" | "accurate" | "debug";

export interface DesktopConfig {
  host: string;
  port: number;
  pairingToken: string;
  heartbeatIntervalMs: number;
  advertiseMdns: boolean;
  codexStatusEnabled: boolean;
  codexSessionsRoot: string;
  codexWatchPollMs: number;
  codexLatestScanMs: number;
  faceTrackingEnabled: boolean;
  faceTrackingFps: number;
  faceTrackingMirrorX: boolean;
  faceTrackingSpeed: number;
  faceTrackingDeadband: number;
  faceTrackingYawKp: number;
  faceTrackingYawKi: number;
  faceTrackingYawKd: number;
  faceTrackingPitchKp: number;
  faceTrackingPitchKi: number;
  faceTrackingPitchKd: number;
  faceTrackingIntegralLimit: number;
  faceTrackingOutputLimitDeg: number;
  faceTrackingPython: string;
  faceTrackingDetectorScript: string;
  faceLandmarkerModel: string;
  faceTrackingMaxFaces: number;
  faceTrackingMinDetectionConfidence: number;
  faceTrackingMinPresenceConfidence: number;
  faceTrackingMinTrackingConfidence: number;
  faceTrackingCameraPreset: FaceTrackingCameraPreset;
  volcengineTtsEnabled: boolean;
  volcengineTtsApiKey?: string;
  volcengineTtsEndpoint: string;
  volcengineTtsResourceId: string;
  volcengineTtsVoiceId: string;
  volcengineTtsSampleRate: 16000 | 24000;
  volcengineTtsCompletionText: string;
  volcengineTtsCompletionVolume: number;
  volcengineTtsDebounceMs: number;
  volcengineTtsTimeoutMs: number;
  previewEnabled: boolean;
  previewHost: string;
  previewPort: number;
  logLevel: LogLevel;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface LogEntryInput {
  time: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

export type LogSink = (entry: LogEntryInput) => void;

const LOG_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function parseLogLevel(value: string | undefined): LogLevel {
  if (value === "debug" || value === "info" || value === "warn" || value === "error") {
    return value;
  }
  return "info";
}

function parseTtsSampleRate(value: string | undefined): 16000 | 24000 {
  return value === "24000" ? 24000 : 16000;
}

function resolveProjectPath(projectRoot: string, configuredPath: string | undefined, fallbackPath: string): string {
  const candidate = configuredPath || fallbackPath;
  return path.isAbsolute(candidate) ? candidate : path.join(projectRoot, candidate);
}

function parseCameraPreset(value: string | undefined): FaceTrackingCameraPreset {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "accurate" || normalized === "debug" || normalized === "fast") {
    return normalized;
  }
  return "fast";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): DesktopConfig {
  const initialProjectRoot = env.STACKCHAN_PROJECT_ROOT ?? defaultProjectRoot(process.cwd());
  loadDotEnv(initialProjectRoot, env);
  const home = env.HOME ?? process.cwd();
  const projectRoot = path.resolve(env.STACKCHAN_PROJECT_ROOT ?? initialProjectRoot);
  return {
    host: env.STACKCHAN_LOCAL_HOST ?? "0.0.0.0",
    port: parseInteger(env.STACKCHAN_LOCAL_PORT, 8787),
    pairingToken: env.STACKCHAN_PAIRING_TOKEN ?? "dev-local-token",
    heartbeatIntervalMs: parseInteger(env.STACKCHAN_HEARTBEAT_INTERVAL_MS, 15_000),
    advertiseMdns: parseBoolean(env.STACKCHAN_ADVERTISE_MDNS, true),
    codexStatusEnabled: parseBoolean(env.STACKCHAN_CODEX_STATUS, true),
    codexSessionsRoot: env.STACKCHAN_CODEX_SESSIONS_ROOT ?? `${home}/.codex/sessions`,
    codexWatchPollMs: parseInteger(env.STACKCHAN_CODEX_WATCH_POLL_MS, 1000),
    codexLatestScanMs: parseInteger(env.STACKCHAN_CODEX_LATEST_SCAN_MS, 30_000),
    faceTrackingEnabled: parseBoolean(env.STACKCHAN_FACE_TRACKING, false),
    faceTrackingFps: Math.min(15, Math.max(1, parseInteger(env.STACKCHAN_FACE_TRACKING_FPS, 4))),
    faceTrackingMirrorX: parseBoolean(env.STACKCHAN_FACE_TRACKING_MIRROR_X, false),
    faceTrackingSpeed: clampNumber(parseInteger(env.STACKCHAN_FACE_TRACKING_SPEED, 700), 0, 1000),
    faceTrackingDeadband: clampNumber(parseNumber(env.STACKCHAN_FACE_TRACKING_DEADBAND, 0.018), 0, 0.3),
    faceTrackingYawKp: clampNumber(parseNumber(env.STACKCHAN_FACE_TRACKING_YAW_KP, 44), 0, 150),
    faceTrackingYawKi: clampNumber(parseNumber(env.STACKCHAN_FACE_TRACKING_YAW_KI, 0), 0, 50),
    faceTrackingYawKd: clampNumber(parseNumber(env.STACKCHAN_FACE_TRACKING_YAW_KD, 6), 0, 80),
    faceTrackingPitchKp: clampNumber(parseNumber(env.STACKCHAN_FACE_TRACKING_PITCH_KP, 32), 0, 150),
    faceTrackingPitchKi: clampNumber(parseNumber(env.STACKCHAN_FACE_TRACKING_PITCH_KI, 0), 0, 50),
    faceTrackingPitchKd: clampNumber(parseNumber(env.STACKCHAN_FACE_TRACKING_PITCH_KD, 5), 0, 80),
    faceTrackingIntegralLimit: clampNumber(parseNumber(env.STACKCHAN_FACE_TRACKING_INTEGRAL_LIMIT, 0.25), 0, 2),
    faceTrackingOutputLimitDeg: clampNumber(parseNumber(env.STACKCHAN_FACE_TRACKING_OUTPUT_LIMIT_DEG, 20), 1, 45),
    faceTrackingPython: env.STACKCHAN_FACE_TRACKING_PYTHON ?? defaultFaceTrackingPython(),
    faceTrackingDetectorScript: resolveProjectPath(
      projectRoot,
      env.STACKCHAN_FACE_TRACKING_DETECTOR,
      "desktop/scripts/face_detector.py"
    ),
    faceLandmarkerModel: resolveProjectPath(
      projectRoot,
      env.STACKCHAN_FACE_LANDMARKER_MODEL,
      "desktop/models/face_landmarker.task"
    ),
    faceTrackingMaxFaces: clampNumber(parseInteger(env.STACKCHAN_FACE_TRACKING_MAX_FACES, 1), 1, 4),
    faceTrackingMinDetectionConfidence: clampNumber(
      parseNumber(env.STACKCHAN_FACE_TRACKING_MIN_DETECTION_CONFIDENCE, 0.18),
      0,
      1
    ),
    faceTrackingMinPresenceConfidence: clampNumber(
      parseNumber(env.STACKCHAN_FACE_TRACKING_MIN_PRESENCE_CONFIDENCE, 0.18),
      0,
      1
    ),
    faceTrackingMinTrackingConfidence: clampNumber(
      parseNumber(env.STACKCHAN_FACE_TRACKING_MIN_TRACKING_CONFIDENCE, 0.18),
      0,
      1
    ),
    faceTrackingCameraPreset: parseCameraPreset(env.STACKCHAN_FACE_TRACKING_CAMERA_PRESET),
    volcengineTtsEnabled: parseBoolean(env.STACKCHAN_VOLCENGINE_TTS_ENABLED, Boolean(env.VOLCENGINE_TTS_API_KEY)),
    volcengineTtsApiKey: env.VOLCENGINE_TTS_API_KEY,
    volcengineTtsEndpoint:
      env.VOLCENGINE_TTS_ENDPOINT ?? "https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse",
    volcengineTtsResourceId: env.VOLCENGINE_TTS_RESOURCE_ID ?? "seed-tts-2.0",
    volcengineTtsVoiceId:
      env.VOLCENGINE_TTS_VOICE_ID ?? "zh_male_liangsangmengzai_uranus_bigtts",
    volcengineTtsSampleRate: parseTtsSampleRate(env.VOLCENGINE_TTS_SAMPLE_RATE),
    volcengineTtsCompletionText: env.STACKCHAN_CODEX_COMPLETION_TTS_TEXT ?? "Codex 任务执行完毕。",
    volcengineTtsCompletionVolume: clampNumber(parseInteger(env.STACKCHAN_CODEX_COMPLETION_TTS_VOLUME, 80), 0, 100),
    volcengineTtsDebounceMs: parseInteger(env.STACKCHAN_CODEX_COMPLETION_TTS_DEBOUNCE_MS, 8000),
    volcengineTtsTimeoutMs: clampNumber(parseInteger(env.VOLCENGINE_TTS_TIMEOUT_MS, 8000), 1000, 30000),
    previewEnabled: parseBoolean(env.STACKCHAN_PREVIEW_ENABLED, true),
    previewHost: env.STACKCHAN_PREVIEW_HOST ?? "127.0.0.1",
    previewPort: parseInteger(env.STACKCHAN_PREVIEW_PORT, 8788),
    logLevel: parseLogLevel(env.STACKCHAN_LOG_LEVEL)
  };
}

function loadDotEnv(projectRoot: string, env: NodeJS.ProcessEnv): void {
  const envPath = path.join(projectRoot, ".env");
  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    if (typeof env[key] !== "undefined") {
      continue;
    }
    env[key] = parseDotEnvValue(rawValue);
  }
}

function parseDotEnvValue(rawValue: string): string {
  const value = rawValue.trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  const commentIndex = value.search(/\s#/);
  return commentIndex >= 0 ? value.slice(0, commentIndex).trim() : value;
}

function defaultProjectRoot(cwd: string): string {
  return path.basename(cwd) === "desktop" ? path.dirname(cwd) : cwd;
}

function defaultFaceTrackingPython(): string {
  const candidates = [
    "/Library/Frameworks/Python.framework/Versions/3.11/bin/python3",
    "/opt/homebrew/opt/python@3.11/bin/python3.11",
    "/usr/local/opt/python@3.11/bin/python3.11",
    "/opt/homebrew/bin/python3",
    "/usr/local/bin/python3"
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? "python3";
}

export function createLogger(level: LogLevel, sink?: LogSink): Logger {
  const minimum = LOG_ORDER[level];

  function write(entryLevel: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (LOG_ORDER[entryLevel] < minimum) {
      return;
    }
    const entry = {
      time: new Date().toISOString(),
      level: entryLevel,
      message,
      ...(context ? { context } : {})
    };
    sink?.(entry);
    process.stderr.write(`${JSON.stringify(entry)}\n`);
  }

  return {
    debug: (message, context) => write("debug", message, context),
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: (message, context) => write("error", message, context)
  };
}
