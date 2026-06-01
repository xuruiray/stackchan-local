import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import type {
  FaceTrackingControl,
  NormalizedFaceBox,
  ProtocolTrace,
  RobotEventMessage
} from "@stackchan-local/protocol";

import type { DesktopConfig, FaceTrackingCameraPreset, Logger } from "../config.js";
import type { DeviceRegistry } from "../device/registry.js";
import type { RobotController } from "../robot/controller.js";
import { PythonSidecarFaceDetector, type FaceDetectionResult, type FaceDetector } from "./detector.js";

export type CameraPresetName = FaceTrackingCameraPreset;

export interface CameraStreamSettings {
  preset: CameraPresetName;
  width: number;
  height: number;
  fps: number;
  quality: number;
}

export const CAMERA_STREAM_PRESETS: Record<CameraPresetName, CameraStreamSettings> = {
  fast: { preset: "fast", width: 320, height: 240, fps: 15, quality: 18 },
  accurate: { preset: "accurate", width: 320, height: 240, fps: 6, quality: 28 },
  debug: { preset: "debug", width: 320, height: 240, fps: 2, quality: 35 }
};

export interface VisionTrackingStatus {
  enabled: boolean;
  fps: number;
  mirrorX: boolean;
  control: VisionTrackingSettings;
  sourceCamera: VisionCameraSourceStatus;
  rawPreview: VisionRawPreviewStatus;
  adaptive: VisionAdaptiveStatus;
  detectorAvailable: boolean;
  lastFrameAt?: string;
  lastDetectionAt?: string;
  lastFaceAt?: string;
  lastCommandAt?: string;
  lastTarget?: NormalizedFaceBox;
  lastError?: string;
  framesReceived: number;
  framesDropped: number;
  detectorLatencyMs?: number;
  latency: VisionLatencyStatus;
  mediaCredit: VisionMediaCreditStatus;
}

export interface VisionAdaptiveStatus {
  level: number;
  active: boolean;
  fps: number;
  quality: number;
  dropRate: number;
  reason?: string;
  lastChangedAt?: string;
}

export interface VisionCameraSourceStatus {
  enabled: boolean;
  owner: "rawPreview" | "faceTracking" | "idle";
  fps: number;
  quality: number;
  width: number;
  height: number;
}

export interface VisionRawPreviewStatus {
  enabled: boolean;
  camera: CameraStreamSettings;
  lastChangedAt?: string;
}

export interface VisionFrameSnapshot {
  frameId: string;
  mimeType: "image/jpeg";
  width: number;
  height: number;
  dataBase64: string;
  timestamp: string;
  seq?: number;
  receivedAt: string;
  captureTimestamp?: string;
  sentAt?: string;
  trace?: ProtocolTrace;
}

export interface VisionLatencyStatus {
  frameAgeMs?: number;
  deviceToDaemonMs?: number;
  captureToDaemonMs?: number;
  detectorEndToEndMs?: number;
}

export interface VisionMediaCreditStatus {
  enabled: boolean;
  grantedFrames: number;
  outstandingFrames: number;
  lastGrantedAt?: string;
  reason?: string;
}

export interface VisionPreviewSnapshot {
  status: VisionTrackingStatus;
  frame?: VisionFrameSnapshot;
  faces: NormalizedFaceBox[];
  target?: NormalizedFaceBox;
}

export type VisionPreviewListener = (snapshot: VisionPreviewSnapshot) => void;

export interface VisionTrackingSettings {
  speed: number;
  camera: CameraStreamSettings;
  control: FaceTrackingControl;
}

export interface VisionTrackingSettingsPatch {
  speed?: number;
  cameraPreset?: CameraPresetName;
  camera?: Partial<Pick<CameraStreamSettings, "width" | "height" | "fps" | "quality">>;
  control?: Partial<Omit<FaceTrackingControl, "mode" | "yaw" | "pitch">> & {
    mode?: "pid";
    yaw?: Partial<FaceTrackingControl["yaw"]>;
    pitch?: Partial<FaceTrackingControl["pitch"]>;
  };
}

export interface RawPreviewSettingsPatch {
  enabled: boolean;
  width?: number;
  height?: number;
  fps?: number;
  quality?: number;
}

export interface VisionTrackingOptions {
  commandMaxHz?: number;
  lostTimeoutMs?: number;
  streamRetryMs?: number;
  adaptivePressureMs?: number;
  adaptiveStableMs?: number;
}

type TrackFaceDispatch = Parameters<RobotController["trackFace"]>[0] & {
  target?: NormalizedFaceBox;
};

const DEFAULT_OPTIONS: Required<VisionTrackingOptions> = {
  commandMaxHz: 15,
  lostTimeoutMs: 1500,
  streamRetryMs: 1000,
  adaptivePressureMs: 5000,
  adaptiveStableMs: 15000
};

const CAMERA_STREAM_HEALTHY_REFRESH_MS = Number.POSITIVE_INFINITY;
const CAMERA_STREAM_STALE_MS = 8_000;
const CAMERA_STREAM_MAX_RETRY_MS = 15_000;
const CAMERA_STREAM_RECONNECT_AFTER_FAILURES = 3;
const CAMERA_STREAM_RECONNECT_COOLDOWN_MS = 20_000;
const ADAPTIVE_DROP_RATE_THRESHOLD = 0.08;
const ADAPTIVE_LATENCY_FRAME_RATIO = 0.8;
const ADAPTIVE_WINDOW_MS = 5_000;
const ADAPTIVE_MAX_LEVEL = 2;
const CAMERA_MEDIA_INITIAL_CREDIT_FRAMES = 1;
const CAMERA_MEDIA_STEADY_CREDIT_FRAMES = 1;
const CAMERA_MEDIA_MAX_IN_FLIGHT = 1;
const CAMERA_MEDIA_REFILL_THRESHOLD = 0;
const RAW_PREVIEW_MEDIA_INITIAL_CREDIT_FRAMES = 1;
const RAW_PREVIEW_MEDIA_STEADY_CREDIT_FRAMES = 1;
const RAW_PREVIEW_MEDIA_MAX_IN_FLIGHT = 1;
const RAW_PREVIEW_MEDIA_REFILL_THRESHOLD = 0;
const CAMERA_STREAM_WIDTH = 320;
const CAMERA_STREAM_HEIGHT = 240;
const RAW_PREVIEW_CAMERA: CameraStreamSettings = {
  preset: "fast",
  width: CAMERA_STREAM_WIDTH,
  height: CAMERA_STREAM_HEIGHT,
  fps: 15,
  quality: 14
};
const TRACK_TARGET_STICKINESS_WEIGHT = 0.18;

export interface OneEuroFilterOptions {
  minCutoff: number;
  beta: number;
  dCutoff: number;
}

export class OneEuroFilter {
  private lastTimestampMs?: number;
  private lastRaw?: number;
  private lastValue?: number;
  private lastDerivative?: number;

  constructor(private readonly options: OneEuroFilterOptions) {}

  filter(value: number, timestampMs: number): number {
    if (
      this.lastTimestampMs === undefined ||
      this.lastRaw === undefined ||
      this.lastValue === undefined ||
      this.lastDerivative === undefined
    ) {
      this.lastTimestampMs = timestampMs;
      this.lastRaw = value;
      this.lastValue = value;
      this.lastDerivative = 0;
      return value;
    }

    const dt = Math.max(0.001, (timestampMs - this.lastTimestampMs) / 1000);
    const derivative = (value - this.lastRaw) / dt;
    const filteredDerivative = exponentialSmooth(
      derivative,
      this.lastDerivative,
      smoothingAlpha(this.options.dCutoff, dt)
    );
    const cutoff = this.options.minCutoff + this.options.beta * Math.abs(filteredDerivative);
    const filteredValue = exponentialSmooth(value, this.lastValue, smoothingAlpha(cutoff, dt));

    this.lastTimestampMs = timestampMs;
    this.lastRaw = value;
    this.lastValue = filteredValue;
    this.lastDerivative = filteredDerivative;
    return filteredValue;
  }

  velocity(): number {
    return this.lastDerivative ?? 0;
  }

  reset(): void {
    this.lastTimestampMs = undefined;
    this.lastRaw = undefined;
    this.lastValue = undefined;
    this.lastDerivative = undefined;
  }
}

export class VisionTrackingService {
  private readonly detector: FaceDetector;
  private readonly options: Required<VisionTrackingOptions>;
  private unsubscribe?: () => void;
  private retryTimer?: NodeJS.Timeout;
  private enabled = false;
  private detectorAvailable = true;
  private inFlight = false;
  private lostCommandSent = false;
  private lastStreamCommandAt = 0;
  private lastCommandAt = 0;
  private lastFrameAt?: Date;
  private lastDetectionAt?: Date;
  private lastFaceAt?: Date;
  private lastTarget?: NormalizedFaceBox;
  private lastSentTrackTarget?: NormalizedFaceBox;
  private commandWindowStartedAt = 0;
  private commandWindowCount = 0;
  private commandHz?: number;
  private lastFrame?: VisionFrameSnapshot;
  private lastFaces: NormalizedFaceBox[] = [];
  private lastError?: string;
  private detectorLatencyMs?: number;
  private lastDetectorTimestampMs = 0;
  private lastDetectionInputAt = 0;
  private cameraStreamInFlight = false;
  private cameraStreamAckFailures = 0;
  private lastCameraRecoveryAt = 0;
  private streamEnabled = false;
  private streamOwner: VisionCameraSourceStatus["owner"] = "idle";
  private streamCamera: CameraStreamSettings = { ...RAW_PREVIEW_CAMERA };
  private framesReceived = 0;
  private framesDropped = 0;
  private mediaCreditGrantedFrames = 0;
  private mediaCreditOutstandingFrames = 0;
  private mediaCreditLastGrantedAt = 0;
  private mediaCreditReason?: string;
  private mediaCreditSessionId?: string;
  private adaptiveLevel = 0;
  private adaptiveReason?: string;
  private adaptiveLastChangedAt = 0;
  private adaptivePressureSince = 0;
  private adaptiveStableSince = 0;
  private adaptiveWindowStartedAt = 0;
  private adaptiveWindowFrames = 0;
  private adaptiveWindowDropped = 0;
  private adaptiveDropRate = 0;
  private rawPreviewEnabled = false;
  private rawPreviewCamera: CameraStreamSettings = { ...RAW_PREVIEW_CAMERA };
  private rawPreviewLastChangedAt = 0;
  private settings: VisionTrackingSettings;
  private readonly previewListeners = new Set<VisionPreviewListener>();
  private readonly trace?: FaceTrackingTraceLogger;

  constructor(
    private readonly controller: RobotController,
    private readonly registry: DeviceRegistry,
    private readonly logger: Logger,
    private readonly config: DesktopConfig,
    detector?: FaceDetector,
    options: VisionTrackingOptions = {}
  ) {
    this.detector =
      detector ??
      new PythonSidecarFaceDetector(config.faceTrackingPython, config.faceTrackingDetectorScript, logger);
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.settings = settingsFromConfig(config);
    if (config.faceTrackingTraceLog) {
      this.trace = new FaceTrackingTraceLogger(config.faceTrackingTraceLog, logger);
    }
  }

  start(): void {
    if (this.unsubscribe) {
      return;
    }
    this.unsubscribe = this.registry.onEvent((message) => void this.handleEvent(message));
    this.retryTimer = setInterval(() => this.ensureCameraStream(), this.options.streamRetryMs);
    if (this.config.faceTrackingEnabled) {
      this.setEnabled(true);
    }
  }

  stop(): void {
    this.setEnabled(false);
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = undefined;
    }
    this.detector.close();
  }

  setEnabled(enabled: boolean): VisionTrackingStatus {
    if (this.enabled === enabled) {
      return this.status();
    }

    this.enabled = enabled;
    this.lostCommandSent = false;
    this.lastError = undefined;
    this.resetTrackingTargetState();
    if (enabled) {
      this.lastDetectionInputAt = 0;
      this.trace?.write("trackingState", { enabled: true, settings: this.settings });
      this.logger.info("face tracking enabled", {
        fps: this.effectiveCameraSettings().fps,
        camera: this.effectiveCameraSettings(),
        mirrorX: this.config.faceTrackingMirrorX
      });
      this.ensureCameraStream(true);
    } else {
      this.logger.info("face tracking disabled");
      this.trace?.write("trackingState", { enabled: false, settings: this.settings });
      this.resetAdaptiveState("face tracking disabled");
      this.ensureCameraStream(true);
      void this.controller.trackFace({
        detected: false,
        reason: "tracking_disabled",
        speed: this.settings.speed,
        control: this.settings.control
      });
    }
    return this.status();
  }

  setControl(patch: VisionTrackingSettingsPatch): VisionTrackingStatus {
    const previousCamera = this.settings.camera;
    this.settings = mergeSettings(this.settings, patch);
    this.logger.info("face tracking control updated", { settings: this.settings });
    if (
      this.enabled &&
      (previousCamera.preset !== this.settings.camera.preset ||
        previousCamera.width !== this.settings.camera.width ||
        previousCamera.height !== this.settings.camera.height ||
        previousCamera.fps !== this.settings.camera.fps ||
        previousCamera.quality !== this.settings.camera.quality)
    ) {
      this.resetAdaptiveState("camera control updated");
      this.lastStreamCommandAt = 0;
      this.ensureCameraStream(true);
    }
    this.emitPreviewUpdate();
    return this.status();
  }

  setRawPreview(patch: RawPreviewSettingsPatch): VisionTrackingStatus {
    this.rawPreviewEnabled = patch.enabled;
    this.rawPreviewCamera = {
      preset: "fast",
      width: CAMERA_STREAM_WIDTH,
      height: CAMERA_STREAM_HEIGHT,
      fps: clampInt(patch.fps ?? this.rawPreviewCamera.fps, 1, 15),
      quality: clampInt(patch.quality ?? this.rawPreviewCamera.quality, 1, 35)
    };
    this.rawPreviewLastChangedAt = Date.now();
    this.lastStreamCommandAt = 0;
    this.ensureCameraStream(true);
    this.emitPreviewUpdate();
    return this.status();
  }

  status(): VisionTrackingStatus {
    const camera = this.effectiveCameraSettings();
    const sourceCamera = this.currentSourceCameraStatus();
    return {
      enabled: this.enabled,
      fps: camera.fps,
      mirrorX: this.config.faceTrackingMirrorX,
      control: this.settings,
      sourceCamera,
      rawPreview: {
        enabled: this.rawPreviewEnabled,
        camera: this.rawPreviewCamera,
        lastChangedAt: this.rawPreviewLastChangedAt > 0 ? new Date(this.rawPreviewLastChangedAt).toISOString() : undefined
      },
      adaptive: {
        level: this.adaptiveLevel,
        active: this.adaptiveLevel > 0,
        fps: camera.fps,
        quality: camera.quality,
        dropRate: this.adaptiveDropRate,
        reason: this.adaptiveReason,
        lastChangedAt: this.adaptiveLastChangedAt > 0 ? new Date(this.adaptiveLastChangedAt).toISOString() : undefined
      },
      detectorAvailable: this.detectorAvailable,
      lastFrameAt: this.lastFrameAt?.toISOString(),
      lastDetectionAt: this.lastDetectionAt?.toISOString(),
      lastFaceAt: this.lastFaceAt?.toISOString(),
      lastCommandAt: this.lastCommandAt > 0 ? new Date(this.lastCommandAt).toISOString() : undefined,
      lastTarget: this.lastTarget,
      lastError: this.lastError,
      framesReceived: this.framesReceived,
      framesDropped: this.framesDropped,
      detectorLatencyMs: this.detectorLatencyMs,
      latency: this.latencyStatus(),
      mediaCredit: {
        enabled: this.mediaCreditEnabled(),
        grantedFrames: this.mediaCreditGrantedFrames,
        outstandingFrames: this.mediaCreditOutstandingFrames,
        lastGrantedAt: this.mediaCreditLastGrantedAt > 0 ? new Date(this.mediaCreditLastGrantedAt).toISOString() : undefined,
        reason: this.mediaCreditReason
      }
    };
  }

  previewSnapshot(): VisionPreviewSnapshot {
    return {
      status: this.status(),
      frame: this.lastFrame,
      faces: this.lastFaces,
      target: this.lastTarget
    };
  }

  onPreviewUpdate(listener: VisionPreviewListener): () => void {
    this.previewListeners.add(listener);
    return () => this.previewListeners.delete(listener);
  }

  private ensureCameraStream(force = false): void {
    const desired = this.desiredCameraStream();
    if (!desired) {
      if (!this.streamEnabled || this.cameraStreamInFlight) {
        return;
      }
      this.cameraStreamInFlight = true;
      const resultPromise = this.controller.cameraStream({
        enabled: false,
        fps: this.streamCamera.fps,
        width: this.streamCamera.width,
        height: this.streamCamera.height,
        quality: this.streamCamera.quality,
        format: "jpeg"
      });
      void resultPromise
        .then((result) => {
          if (result.sent && (!result.ack || result.ack.status === "accepted")) {
            this.streamEnabled = false;
            this.streamOwner = "idle";
            this.mediaCreditOutstandingFrames = 0;
            this.mediaCreditSessionId = undefined;
          } else {
            this.lastError = result.reason ?? result.ack?.message ?? "camera stream stop was not accepted";
          }
        })
        .catch((error) => {
          this.lastError = error instanceof Error ? error.message : String(error);
        })
        .finally(() => {
          this.cameraStreamInFlight = false;
          this.emitPreviewUpdate();
        });
      return;
    }

    const now = Date.now();
    if (this.cameraStreamInFlight) {
      return;
    }

    const frameStale = !this.lastFrameAt || now - this.lastFrameAt.getTime() > CAMERA_STREAM_STALE_MS;
    const cameraChanged =
      !this.streamEnabled || this.streamOwner !== desired.owner || !sameCameraSettings(this.streamCamera, desired.camera);
    const retryMs = frameStale
      ? Math.min(
          CAMERA_STREAM_MAX_RETRY_MS,
          this.options.streamRetryMs * Math.max(1, 2 ** Math.min(this.cameraStreamAckFailures, 4))
        )
      : CAMERA_STREAM_HEALTHY_REFRESH_MS;
    if (!force && !cameraChanged && now - this.lastStreamCommandAt < retryMs) {
      return;
    }
    this.cameraStreamInFlight = true;
    const { camera, owner } = desired;
    const resultPromise = this.controller.cameraStream({
      enabled: true,
      fps: camera.fps,
      width: camera.width,
      height: camera.height,
      quality: camera.quality,
      format: "jpeg"
    });
    this.lastStreamCommandAt = now;
    void resultPromise.then((result) => {
      this.cameraStreamInFlight = false;
      if (result.sent && (!result.ack || result.ack.status === "accepted")) {
        this.cameraStreamAckFailures = 0;
        this.streamEnabled = true;
        this.streamOwner = owner;
        this.streamCamera = { ...camera };
        this.mediaCreditOutstandingFrames = 0;
        this.grantCameraMediaCredit(
          owner === "rawPreview" ? RAW_PREVIEW_MEDIA_INITIAL_CREDIT_FRAMES : CAMERA_MEDIA_INITIAL_CREDIT_FRAMES,
          "camera stream active"
        );
        return;
      }
      this.cameraStreamAckFailures += 1;
      this.lastError = result.reason ?? result.ack?.message ?? "camera stream command was not accepted";
      if (
        frameStale &&
        this.cameraStreamAckFailures >= CAMERA_STREAM_RECONNECT_AFTER_FAILURES &&
        now - this.lastCameraRecoveryAt >= CAMERA_STREAM_RECONNECT_COOLDOWN_MS
      ) {
        this.lastCameraRecoveryAt = now;
        this.lastStreamCommandAt = 0;
        const reconnecting = this.registry.reconnectActiveDevice("camera stream stalled");
        this.logger.warn("camera stream stalled; requested device reconnect", {
          reconnecting,
          ackFailures: this.cameraStreamAckFailures,
          lastFrameAt: this.lastFrameAt?.toISOString()
        });
      }
      if (force) {
        this.emitPreviewUpdate();
      }
    }).catch((error) => {
      this.cameraStreamInFlight = false;
      this.cameraStreamAckFailures += 1;
      this.lastError = error instanceof Error ? error.message : String(error);
      this.emitPreviewUpdate();
    });
  }

  private async handleEvent(message: RobotEventMessage): Promise<void> {
    if (message.event.kind !== "cameraFrame" || (!this.enabled && !this.rawPreviewEnabled)) {
      return;
    }
    const receivedAt = new Date();
    const daemonReceivedAt = message.event.trace?.daemonReceivedAt ?? receivedAt.toISOString();
    const trace: ProtocolTrace = {
      ...message.event.trace,
      daemonReceivedAt
    };
    this.framesReceived += 1;
    this.adaptiveWindowFrames += 1;
    this.cameraStreamAckFailures = 0;
    if (this.mediaCreditEnabled()) {
      this.mediaCreditOutstandingFrames = Math.max(0, this.mediaCreditOutstandingFrames - 1);
    }
    this.lastFrameAt = receivedAt;
    this.lastFrame = {
      frameId: message.event.frameId,
      mimeType: message.event.mimeType,
      width: message.event.width,
      height: message.event.height,
      dataBase64: message.event.dataBase64,
      timestamp: message.event.captureTimestamp ?? message.timestamp,
      seq: message.event.seq ?? message.seq,
      receivedAt: receivedAt.toISOString(),
      captureTimestamp: message.event.captureTimestamp,
      sentAt: message.event.sentAt,
      trace
    };
    this.emitPreviewUpdate();

    if (!this.shouldRunDetector(receivedAt.getTime())) {
      this.grantCameraMediaCredit(
        this.rawPreviewEnabled ? RAW_PREVIEW_MEDIA_STEADY_CREDIT_FRAMES : CAMERA_MEDIA_STEADY_CREDIT_FRAMES,
        this.rawPreviewEnabled ? "raw preview ready" : "detector sample skipped"
      );
      return;
    }

    if (this.inFlight) {
      this.framesDropped += 1;
      this.adaptiveWindowDropped += 1;
      this.evaluateAdaptiveBackpressure();
      return;
    }

    this.inFlight = true;
    try {
      const detectorStart = Date.now();
      const detectorStartedAt = new Date(detectorStart).toISOString();
      const result = await this.detector.detect({
        frameId: message.event.frameId,
        width: message.event.width,
        height: message.event.height,
        dataBase64: message.event.dataBase64,
        timestampMs: this.nextDetectorTimestampMs(receivedAt.toISOString())
      });
      this.detectorAvailable = true;
      this.lastError = undefined;
      this.detectorLatencyMs = Date.now() - detectorStart;
      this.lastDetectionAt = new Date();
      if (this.lastFrame?.frameId === message.event.frameId) {
        this.lastFrame.trace = {
          ...trace,
          detectorStartedAt,
          detectorFinishedAt: this.lastDetectionAt.toISOString()
        };
      }
      this.handleDetection(result);
    } catch (error) {
      this.detectorAvailable = false;
      this.lastError = error instanceof Error ? error.message : String(error);
      this.logger.warn("face tracking detection failed", { error: this.lastError });
    } finally {
      this.inFlight = false;
      this.grantCameraMediaCredit(CAMERA_MEDIA_STEADY_CREDIT_FRAMES, "detector ready");
      this.evaluateAdaptiveBackpressure();
    }
  }

  private grantCameraMediaCredit(creditFrames: number, reason: string): void {
    if (!this.enabled && !this.rawPreviewEnabled) {
      return;
    }
    const session = this.registry.getActiveSession();
    if (!session?.capabilities.includes("mediaCredit")) {
      this.mediaCreditOutstandingFrames = 0;
      this.mediaCreditSessionId = undefined;
      return;
    }
    const maxInFlight = this.rawPreviewEnabled ? RAW_PREVIEW_MEDIA_MAX_IN_FLIGHT : CAMERA_MEDIA_MAX_IN_FLIGHT;
    const refillThreshold = this.rawPreviewEnabled ? RAW_PREVIEW_MEDIA_REFILL_THRESHOLD : CAMERA_MEDIA_REFILL_THRESHOLD;
    if (this.mediaCreditSessionId !== session.sessionId) {
      this.mediaCreditSessionId = session.sessionId;
      this.mediaCreditOutstandingFrames = 0;
    }
    if (this.mediaCreditOutstandingFrames > refillThreshold) {
      return;
    }
    const grantedFrames = Math.min(creditFrames, maxInFlight - this.mediaCreditOutstandingFrames);
    if (grantedFrames <= 0) {
      return;
    }
    this.mediaCreditOutstandingFrames += grantedFrames;
    this.mediaCreditGrantedFrames += grantedFrames;
    this.mediaCreditLastGrantedAt = Date.now();
    this.mediaCreditReason = reason;
    void this.controller.mediaFlowControl(
      {
        stream: "camera",
        creditFrames: grantedFrames,
        maxInFlight,
        reason
      },
      { waitForAck: false }
    );
  }

  private mediaCreditEnabled(): boolean {
    return this.registry.getActiveSession()?.capabilities.includes("mediaCredit") ?? false;
  }

  private shouldRunDetector(receivedAtMs: number): boolean {
    if (!this.enabled) {
      return false;
    }
    const fps = Math.max(1, this.settings.camera.fps);
    const minIntervalMs = 1000 / fps;
    if (receivedAtMs - this.lastDetectionInputAt < minIntervalMs) {
      return false;
    }
    this.lastDetectionInputAt = receivedAtMs;
    return true;
  }

  private desiredCameraStream(): { owner: "rawPreview" | "faceTracking"; camera: CameraStreamSettings } | undefined {
    if (this.rawPreviewEnabled) {
      return { owner: "rawPreview", camera: this.rawPreviewCamera };
    }
    if (this.enabled) {
      return { owner: "faceTracking", camera: this.effectiveCameraSettings() };
    }
    return undefined;
  }

  private currentSourceCameraStatus(): VisionCameraSourceStatus {
    const desired = this.desiredCameraStream();
    const camera = desired?.camera ?? this.streamCamera;
    return {
      enabled: Boolean(desired),
      owner: desired?.owner ?? "idle",
      fps: camera.fps,
      quality: camera.quality,
      width: camera.width,
      height: camera.height
    };
  }

  private effectiveCameraSettings(): CameraStreamSettings {
    return adaptiveCameraSettings(this.settings.camera, this.adaptiveLevel);
  }

  private evaluateAdaptiveBackpressure(): void {
    const now = Date.now();
    if (this.adaptiveWindowStartedAt === 0) {
      this.adaptiveWindowStartedAt = now;
    }
    if (now - this.adaptiveWindowStartedAt >= ADAPTIVE_WINDOW_MS) {
      this.adaptiveDropRate =
        this.adaptiveWindowFrames > 0 ? this.adaptiveWindowDropped / this.adaptiveWindowFrames : 0;
      this.adaptiveWindowStartedAt = now;
      this.adaptiveWindowFrames = 0;
      this.adaptiveWindowDropped = 0;
    }

    const camera = this.effectiveCameraSettings();
    const frameIntervalMs = camera.fps > 0 ? 1000 / camera.fps : Number.POSITIVE_INFINITY;
    const latencyPressure =
      this.detectorLatencyMs !== undefined && this.detectorLatencyMs > frameIntervalMs * ADAPTIVE_LATENCY_FRAME_RATIO;
    const dropPressure = this.adaptiveDropRate > ADAPTIVE_DROP_RATE_THRESHOLD;
    const pressure = latencyPressure || dropPressure;
    if (pressure) {
      this.adaptiveStableSince = 0;
      if (this.adaptivePressureSince === 0) {
        this.adaptivePressureSince = now;
      }
      if (now - this.adaptivePressureSince >= this.options.adaptivePressureMs) {
        this.setAdaptiveLevel(
          Math.min(ADAPTIVE_MAX_LEVEL, this.adaptiveLevel + 1),
          latencyPressure ? "detector latency backpressure" : "camera frame drop backpressure"
        );
        this.adaptivePressureSince = now;
      }
      return;
    }

    this.adaptivePressureSince = 0;
    if (this.adaptiveLevel === 0) {
      return;
    }
    if (this.adaptiveStableSince === 0) {
      this.adaptiveStableSince = now;
    }
    if (now - this.adaptiveStableSince >= this.options.adaptiveStableMs) {
      this.setAdaptiveLevel(Math.max(0, this.adaptiveLevel - 1), "camera stream stable");
      this.adaptiveStableSince = now;
    }
  }

  private setAdaptiveLevel(level: number, reason: string): void {
    if (level === this.adaptiveLevel) {
      return;
    }
    this.adaptiveLevel = level;
    this.adaptiveReason = reason;
    this.adaptiveLastChangedAt = Date.now();
    this.lastStreamCommandAt = 0;
    this.logger.info("face tracking adaptive camera stream changed", {
      type: "vision",
      level,
      reason,
      camera: this.effectiveCameraSettings(),
      dropRate: this.adaptiveDropRate,
      detectorLatencyMs: this.detectorLatencyMs
    });
    this.ensureCameraStream(true);
    this.emitPreviewUpdate();
  }

  private resetAdaptiveState(reason: string): void {
    const wasAdaptive = this.adaptiveLevel > 0;
    this.adaptiveLevel = 0;
    this.adaptiveReason = wasAdaptive ? reason : undefined;
    this.adaptiveLastChangedAt = wasAdaptive ? Date.now() : 0;
    this.adaptivePressureSince = 0;
    this.adaptiveStableSince = 0;
    this.adaptiveWindowStartedAt = 0;
    this.adaptiveWindowFrames = 0;
    this.adaptiveWindowDropped = 0;
    this.adaptiveDropRate = 0;
    if (wasAdaptive) {
      this.emitPreviewUpdate();
    }
  }

  private handleDetection(result: FaceDetectionResult): void {
    this.lastFaces = result.faces;
    const selected = selectTrackingFace(result.faces, this.lastTarget);
    const frame = this.lastFrame?.frameId === result.frameId ? this.lastFrame : undefined;
    if (selected) {
      const trackingTarget = this.config.faceTrackingMirrorX ? mirrorFace(selected) : selected;
      const centerX = trackingTarget.x + trackingTarget.width / 2;
      const centerY = trackingTarget.y + trackingTarget.height / 2;
      this.traceFaceDetection(result, {
        frame,
        action: "target_ready",
        selected,
        trackingTarget,
        centerX,
        centerY
      });
      this.lastFaceAt = new Date();
      this.lastTarget = selected;
      this.lostCommandSent = false;
      this.sendTrackCommand({
        detected: true,
        centerX,
        centerY,
        bbox: selected,
        confidence: selected.confidence,
        target: trackingTarget,
        speed: this.settings.speed,
        control: this.settings.control
      });
      this.emitPreviewUpdate();
      return;
    }

    this.lastTarget = undefined;
    this.traceFaceDetection(result, {
      frame,
      action: "no_face"
    });
    this.emitPreviewUpdate();

    if (!this.lastFaceAt || this.lostCommandSent) {
      return;
    }

    if (Date.now() - this.lastFaceAt.getTime() >= this.options.lostTimeoutMs) {
      this.lostCommandSent = true;
      this.sendTrackCommand({
        detected: false,
        reason: "face_lost",
        speed: this.settings.speed,
        control: this.settings.control
      });
    }
  }

  private traceFaceDetection(
    result: FaceDetectionResult,
    details: {
      frame?: VisionFrameSnapshot;
      action: "target_ready" | "no_face";
      selected?: NormalizedFaceBox;
      trackingTarget?: NormalizedFaceBox;
      centerX?: number;
      centerY?: number;
    }
  ): void {
    this.trace?.write("faceDetection", {
      frameId: result.frameId,
      action: details.action,
      faces: this.lastFaces.map(traceFace),
      selected: details.selected ? traceFace(details.selected) : undefined,
      trackingTarget: details.trackingTarget ? traceFace(details.trackingTarget) : undefined,
      centerX: details.centerX,
      centerY: details.centerY,
      mirrorX: this.config.faceTrackingMirrorX,
      detectorLatencyMs: this.detectorLatencyMs,
      latency: this.latencyStatus(),
      frame: details.frame
        ? {
            timestamp: details.frame.timestamp,
            receivedAt: details.frame.receivedAt,
            captureTimestamp: details.frame.captureTimestamp,
            sentAt: details.frame.sentAt,
            seq: details.frame.seq,
            width: details.frame.width,
            height: details.frame.height
          }
        : undefined
    });
  }

  private sendTrackCommand(command: TrackFaceDispatch): void {
    const now = Date.now();
    const minInterval = 1000 / this.options.commandMaxHz;
    const { target, ...robotCommand } = command;
    const loggedCommand = { kind: "trackFace", ...robotCommand };
    if (command.detected && now - this.lastCommandAt < minInterval) {
      this.trace?.write("trackCommandSkipped", {
        reason: "rate_gate",
        command: loggedCommand,
        target: target ? traceFace(target) : undefined,
        commandAgeMs: now - this.lastCommandAt,
        minIntervalMs: minInterval,
        commandMaxHz: this.options.commandMaxHz
      });
      return;
    }
    this.lastCommandAt = now;
    this.recordCommandRate(now);
    if (command.detected && target) {
      this.lastSentTrackTarget = target;
    } else {
      this.lastSentTrackTarget = undefined;
    }
    this.trace?.write("trackCommand", {
      command: loggedCommand,
      target: target ? traceFace(target) : undefined,
      lastFaceAgeMs: this.lastFaceAt ? now - this.lastFaceAt.getTime() : undefined,
      commandHz: this.commandHz,
      commandMaxHz: this.options.commandMaxHz
    });
    void this.controller.trackFace(robotCommand, { waitForAck: false }).then((result) => {
      this.trace?.write("trackCommandResult", {
        command: loggedCommand,
        sent: result.sent,
        reason: result.reason,
        ack: result.ack,
        motion: result.motion
      });
      if (!result.sent) {
        this.lastError = result.reason ?? "face tracking command was not sent";
      }
      this.emitPreviewUpdate();
    });
  }

  private recordCommandRate(now: number): void {
    if (this.commandWindowStartedAt === 0 || now - this.commandWindowStartedAt >= 1000) {
      if (this.commandWindowStartedAt > 0) {
        this.commandHz = (this.commandWindowCount * 1000) / Math.max(1, now - this.commandWindowStartedAt);
      }
      this.commandWindowStartedAt = now;
      this.commandWindowCount = 1;
      return;
    }
    this.commandWindowCount += 1;
  }

  private nextDetectorTimestampMs(timestamp: string): number {
    const parsed = Date.parse(timestamp);
    let timestampMs = Number.isFinite(parsed) ? parsed : Date.now();
    if (timestampMs <= this.lastDetectorTimestampMs) {
      timestampMs = this.lastDetectorTimestampMs + 1;
    }
    this.lastDetectorTimestampMs = timestampMs;
    return timestampMs;
  }

  private resetTrackingTargetState(): void {
    this.lastTarget = undefined;
    this.lastSentTrackTarget = undefined;
  }

  private emitPreviewUpdate(): void {
    const snapshot = this.previewSnapshot();
    for (const listener of this.previewListeners) {
      listener(snapshot);
    }
  }

  private latencyStatus(): VisionLatencyStatus {
    const frame = this.lastFrame;
    if (!frame) {
      return {};
    }
    return {
      frameAgeMs: this.lastFrameAt ? Date.now() - this.lastFrameAt.getTime() : undefined,
      deviceToDaemonMs: deltaMs(frame.sentAt, frame.receivedAt),
      captureToDaemonMs: deltaMs(frame.captureTimestamp, frame.receivedAt),
      detectorEndToEndMs: deltaMs(frame.captureTimestamp, frame.trace?.detectorFinishedAt)
    };
  }
}

export function selectTrackingFace(
  faces: NormalizedFaceBox[],
  previousTarget?: NormalizedFaceBox
): NormalizedFaceBox | undefined {
  return faces
    .filter((face) => face.width > 0 && face.height > 0)
    .sort((a, b) => faceScore(b, previousTarget) - faceScore(a, previousTarget))[0];
}

function faceScore(face: NormalizedFaceBox, previousTarget?: NormalizedFaceBox): number {
  const area = face.width * face.height;
  const centerX = face.x + face.width / 2;
  const centerY = face.y + face.height / 2;
  const distanceFromCenter = Math.hypot(centerX - 0.5, centerY - 0.5);
  const distanceFromPrevious = previousTarget
    ? Math.hypot(centerX - (previousTarget.x + previousTarget.width / 2), centerY - (previousTarget.y + previousTarget.height / 2))
    : 0;
  return area - distanceFromCenter * 0.05 - distanceFromPrevious * TRACK_TARGET_STICKINESS_WEIGHT;
}

function mirrorFace(face: NormalizedFaceBox): NormalizedFaceBox {
  return {
    ...face,
    x: 1 - face.x - face.width
  };
}

function positionOnlyFace(face: NormalizedFaceBox): NormalizedFaceBox {
  return {
    x: face.x,
    y: face.y,
    width: face.width,
    height: face.height,
    confidence: face.confidence,
    trackingId: face.trackingId,
    detector: face.detector
  };
}

function faceCenter(face: NormalizedFaceBox): { x: number; y: number } {
  return {
    x: face.x + face.width / 2,
    y: face.y + face.height / 2
  };
}

function exponentialSmooth(value: number, previous: number, alpha: number): number {
  return alpha * value + (1 - alpha) * previous;
}

function smoothingAlpha(cutoff: number, dtSeconds: number): number {
  const tau = 1 / (2 * Math.PI * Math.max(0.0001, cutoff));
  return 1 / (1 + tau / Math.max(0.001, dtSeconds));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, value)));
}

function sameCameraSettings(left: CameraStreamSettings, right: CameraStreamSettings): boolean {
  return left.width === right.width && left.height === right.height && left.fps === right.fps && left.quality === right.quality;
}

function settingsFromConfig(config: DesktopConfig): VisionTrackingSettings {
  return {
    speed: clampNumber(config.faceTrackingSpeed, 0, 1000),
    camera: cameraSettingsFromPreset(config.faceTrackingCameraPreset),
    control: {
      mode: "pid",
      deadband: clampNumber(config.faceTrackingDeadband, 0, 0.3),
      yaw: {
        kp: clampNumber(config.faceTrackingYawKp, 0, 150),
        ki: clampNumber(config.faceTrackingYawKi, 0, 50),
        kd: clampNumber(config.faceTrackingYawKd, 0, 80)
      },
      pitch: {
        kp: clampNumber(config.faceTrackingPitchKp, 0, 150),
        ki: clampNumber(config.faceTrackingPitchKi, 0, 50),
        kd: clampNumber(config.faceTrackingPitchKd, 0, 80)
      },
      integralLimit: clampNumber(config.faceTrackingIntegralLimit, 0, 2),
      outputLimitDeg: clampNumber(config.faceTrackingOutputLimitDeg, 1, 45)
    }
  };
}

function mergeSettings(current: VisionTrackingSettings, patch: VisionTrackingSettingsPatch): VisionTrackingSettings {
  const baseCamera = patch.cameraPreset ? cameraSettingsFromPreset(patch.cameraPreset, current.camera) : { ...current.camera };
  const cameraPatch = patch.camera;
  const next = {
    speed: patch.speed === undefined ? current.speed : clampNumber(patch.speed, 0, 1000),
    camera: {
      preset: baseCamera.preset,
      width: CAMERA_STREAM_WIDTH,
      height: CAMERA_STREAM_HEIGHT,
      fps: cameraPatch?.fps === undefined ? baseCamera.fps : clampInt(cameraPatch.fps, 1, 15),
      quality: cameraPatch?.quality === undefined ? baseCamera.quality : clampInt(cameraPatch.quality, 1, 63)
    },
    control: {
      mode: "pid" as const,
      deadband:
        patch.control?.deadband === undefined ? current.control.deadband : clampNumber(patch.control.deadband, 0, 0.3),
      yaw: {
        kp: patch.control?.yaw?.kp === undefined ? current.control.yaw.kp : clampNumber(patch.control.yaw.kp, 0, 150),
        ki: patch.control?.yaw?.ki === undefined ? current.control.yaw.ki : clampNumber(patch.control.yaw.ki, 0, 50),
        kd: patch.control?.yaw?.kd === undefined ? current.control.yaw.kd : clampNumber(patch.control.yaw.kd, 0, 80)
      },
      pitch: {
        kp:
          patch.control?.pitch?.kp === undefined
            ? current.control.pitch.kp
            : clampNumber(patch.control.pitch.kp, 0, 150),
        ki:
          patch.control?.pitch?.ki === undefined
            ? current.control.pitch.ki
            : clampNumber(patch.control.pitch.ki, 0, 50),
        kd:
          patch.control?.pitch?.kd === undefined
            ? current.control.pitch.kd
            : clampNumber(patch.control.pitch.kd, 0, 80)
      },
      integralLimit:
        patch.control?.integralLimit === undefined
          ? current.control.integralLimit
          : clampNumber(patch.control.integralLimit, 0, 2),
      outputLimitDeg:
        patch.control?.outputLimitDeg === undefined
          ? current.control.outputLimitDeg
          : clampNumber(patch.control.outputLimitDeg, 1, 45)
    }
  };
  return next;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cameraSettingsFromPreset(
  preset: CameraPresetName | string,
  fallback: CameraStreamSettings = CAMERA_STREAM_PRESETS.accurate
): CameraStreamSettings {
  if (preset === "fast" || preset === "accurate" || preset === "debug") {
    return { ...CAMERA_STREAM_PRESETS[preset] };
  }
  return { ...fallback };
}

function adaptiveCameraSettings(base: CameraStreamSettings, level: number): CameraStreamSettings {
  if (level <= 0) {
    return { ...base };
  }
  const minimumFps = Math.min(base.fps, 4);
  if (level === 1) {
    return {
      ...base,
      fps: Math.max(minimumFps, Math.min(base.fps, Math.ceil(base.fps * 0.75))),
      quality: Math.max(14, Math.min(base.quality, base.quality - 2))
    };
  }
  return {
    ...base,
    fps: Math.max(minimumFps, Math.min(base.fps, 4)),
    quality: Math.max(14, Math.min(base.quality, 14))
  };
}

class FaceTrackingTraceLogger {
  private disabled = false;

  constructor(
    private readonly filePath: string,
    private readonly logger: Logger
  ) {
    try {
      mkdirSync(path.dirname(filePath), { recursive: true });
    } catch (error) {
      this.disabled = true;
      this.logger.warn("face tracking trace log disabled", {
        filePath,
        error: error instanceof Error ? error.message : String(error)
      });
      return;
    }
    this.logger.info("face tracking trace log enabled", { filePath });
    this.write("traceStart", { pid: process.pid, filePath });
  }

  write(type: string, payload: Record<string, unknown>): void {
    if (this.disabled) {
      return;
    }
    try {
      appendFileSync(
        this.filePath,
        `${JSON.stringify({
          ts: new Date().toISOString(),
          type,
          ...payload
        })}\n`,
        "utf8"
      );
    } catch (error) {
      this.disabled = true;
      this.logger.warn("face tracking trace log write failed", {
        filePath: this.filePath,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

function traceFace(face: NormalizedFaceBox): Record<string, unknown> {
  const center = faceCenter(face);
  return {
    x: face.x,
    y: face.y,
    width: face.width,
    height: face.height,
    centerX: center.x,
    centerY: center.y,
    area: face.width * face.height,
    confidence: face.confidence,
    trackingId: face.trackingId,
    detector: face.detector
  };
}

function deltaMs(start: string | undefined, end: string | undefined): number | undefined {
  if (!start || !end) {
    return undefined;
  }
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return undefined;
  }
  const delta = endMs - startMs;
  return delta >= 0 && delta < 60_000 ? delta : undefined;
}
