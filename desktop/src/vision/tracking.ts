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

export interface FaceDetectorSettings {
  minDetectionConfidence: number;
  minPresenceConfidence: number;
  minTrackingConfidence: number;
}

export const CAMERA_STREAM_PRESETS: Record<CameraPresetName, CameraStreamSettings> = {
  fast: { preset: "fast", width: 320, height: 240, fps: 10, quality: 18 },
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
  detector: FaceDetectorSettings;
  control: FaceTrackingControl;
}

export interface VisionTrackingSettingsPatch {
  speed?: number;
  cameraPreset?: CameraPresetName;
  camera?: Partial<Pick<CameraStreamSettings, "width" | "height" | "fps" | "quality">>;
  detector?: Partial<FaceDetectorSettings>;
  control?: Partial<Omit<FaceTrackingControl, "mode" | "yaw" | "pitch" | "servoRange">> & {
    mode?: "pid";
    yaw?: Partial<FaceTrackingControl["yaw"]>;
    pitch?: Partial<FaceTrackingControl["pitch"]>;
    servoRange?: Partial<FaceTrackingControl["servoRange"]>;
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

const DEFAULT_OPTIONS: Required<VisionTrackingOptions> = {
  commandMaxHz: 6,
  lostTimeoutMs: 1500,
  streamRetryMs: 1000,
  adaptivePressureMs: 5000,
  adaptiveStableMs: 15000
};

const CAMERA_STREAM_HEALTHY_REFRESH_MS = 10_000;
const CAMERA_STREAM_STALE_MS = 8_000;
const CAMERA_STREAM_MAX_RETRY_MS = 15_000;
const CAMERA_STREAM_RECONNECT_AFTER_FAILURES = 3;
const CAMERA_STREAM_RECONNECT_COOLDOWN_MS = 20_000;
const ADAPTIVE_DROP_RATE_THRESHOLD = 0.08;
const ADAPTIVE_LATENCY_FRAME_RATIO = 0.8;
const ADAPTIVE_WINDOW_MS = 5_000;
const ADAPTIVE_MAX_LEVEL = 2;
const CAMERA_MEDIA_INITIAL_CREDIT_FRAMES = 3;
const CAMERA_MEDIA_STEADY_CREDIT_FRAMES = 3;
const CAMERA_MEDIA_MAX_IN_FLIGHT = 3;
const CAMERA_MEDIA_REFILL_THRESHOLD = 1;
const RAW_PREVIEW_MEDIA_INITIAL_CREDIT_FRAMES = 3;
const RAW_PREVIEW_MEDIA_STEADY_CREDIT_FRAMES = 3;
const RAW_PREVIEW_MEDIA_MAX_IN_FLIGHT = 3;
const RAW_PREVIEW_MEDIA_REFILL_THRESHOLD = 1;
const CAMERA_STREAM_WIDTH = 320;
const CAMERA_STREAM_HEIGHT = 240;
const RAW_PREVIEW_CAMERA: CameraStreamSettings = {
  preset: "fast",
  width: CAMERA_STREAM_WIDTH,
  height: CAMERA_STREAM_HEIGHT,
  fps: 10,
  quality: 14
};
const TRACK_TARGET_CENTER_EPSILON = 0.025;
const TRACK_TARGET_SIZE_EPSILON = 0.03;
const TRACK_TARGET_REFRESH_MS = 1200;
const TRACK_TARGET_SMOOTH_ALPHA = 0.35;
const TRACK_TARGET_SIZE_ALPHA = 0.25;
const TRACK_TARGET_MAX_CENTER_STEP = 0.045;
const TRACK_TARGET_STICKINESS_WEIGHT = 0.18;

const OFFICIAL_SERVO_RANGE: FaceTrackingControl["servoRange"] = {
  yawMin: -1280,
  yawMax: 1280,
  pitchMin: 0,
  pitchMax: 900
};

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
  private smoothedTarget?: NormalizedFaceBox;
  private lastSentTrackTarget?: NormalizedFaceBox;
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
      new PythonSidecarFaceDetector(config.faceTrackingPython, config.faceTrackingDetectorScript, logger, {
        env: {
          STACKCHAN_FACE_LANDMARKER_MODEL: config.faceLandmarkerModel,
          STACKCHAN_FACE_TRACKING_MAX_FACES: String(config.faceTrackingMaxFaces),
          ...detectorEnv(detectorSettingsFromConfig(config))
        }
      });
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.settings = settingsFromConfig(config);
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
    this.lastTarget = undefined;
    this.smoothedTarget = undefined;
    this.lastSentTrackTarget = undefined;
    if (enabled) {
      this.lastDetectionInputAt = 0;
      this.logger.info("face tracking enabled", {
        fps: this.effectiveCameraSettings().fps,
        camera: this.effectiveCameraSettings(),
        mirrorX: this.config.faceTrackingMirrorX
      });
      this.ensureCameraStream(true);
      setImmediate(() => this.configureTelemetryForTracking(true, "face tracking enabled"));
    } else {
      this.logger.info("face tracking disabled");
      this.resetAdaptiveState("face tracking disabled");
      this.ensureCameraStream(true);
      setImmediate(() => this.configureTelemetryForTracking(false, "face tracking disabled"));
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
    const previousDetector = this.settings.detector;
    this.settings = mergeSettings(this.settings, patch);
    this.logger.info("face tracking control updated", { settings: this.settings });
    if (!sameDetectorSettings(previousDetector, this.settings.detector)) {
      this.detector.updateEnv?.(detectorEnv(this.settings.detector));
      this.detectorAvailable = true;
      this.detectorLatencyMs = undefined;
      this.lastDetectionAt = undefined;
      this.lastDetectionInputAt = 0;
      this.lastFaces = [];
      this.lastTarget = undefined;
      this.smoothedTarget = undefined;
      this.lastSentTrackTarget = undefined;
    }
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
    void this.controller.telemetryConfig(
      {
        sensorSnapshotHz: level > 0 ? 0.5 : 2,
        imuHz: level > 0 ? 4 : 10,
        includeI2cScan: level === 0,
        reason
      },
      { waitForAck: false }
    );
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
      void this.controller.telemetryConfig(
        {
          sensorSnapshotHz: 2,
          imuHz: 10,
          includeI2cScan: true,
          reason
        },
        { waitForAck: false }
      );
    }
  }

  private configureTelemetryForTracking(enabled: boolean, reason: string): void {
    void this.controller.telemetryConfig(
      {
        sensorSnapshotHz: enabled ? 1 : 2,
        imuHz: enabled ? 4 : 10,
        includeI2cScan: !enabled,
        reason
      },
      { waitForAck: false }
    );
  }

  private handleDetection(result: FaceDetectionResult): void {
    this.lastFaces = result.faces.map(positionOnlyFace);
    const selected = selectTrackingFace(this.lastFaces, this.smoothedTarget ?? this.lastTarget);
    if (selected) {
      const stableTarget = this.stabilizeTrackingTarget(selected);
      const trackingTarget = this.config.faceTrackingMirrorX ? mirrorFace(stableTarget) : stableTarget;
      const centerX = trackingTarget.x + trackingTarget.width / 2;
      const centerY = trackingTarget.y + trackingTarget.height / 2;
      this.lastFaceAt = new Date();
      this.lastTarget = stableTarget;
      this.lostCommandSent = false;
      this.sendTrackCommand({
        detected: true,
        centerX,
        centerY,
        bbox: trackingTarget,
        confidence: stableTarget.confidence,
        speed: this.settings.speed,
        control: this.settings.control
      });
      this.emitPreviewUpdate();
      return;
    }

    this.lastTarget = undefined;
    this.emitPreviewUpdate();

    if (!this.lastFaceAt || this.lostCommandSent) {
      return;
    }

    if (Date.now() - this.lastFaceAt.getTime() >= this.options.lostTimeoutMs) {
      this.lostCommandSent = true;
      this.smoothedTarget = undefined;
      this.sendTrackCommand({
        detected: false,
        reason: "face_lost",
        speed: this.settings.speed,
        control: this.settings.control
      });
    }
  }

  private stabilizeTrackingTarget(rawTarget: NormalizedFaceBox): NormalizedFaceBox {
    const previous = this.smoothedTarget;
    if (!previous) {
      this.smoothedTarget = clampFace(rawTarget);
      return this.smoothedTarget;
    }

    const previousCenter = faceCenter(previous);
    const rawCenter = faceCenter(rawTarget);
    const lowPassCenter = {
      x: previousCenter.x + (rawCenter.x - previousCenter.x) * TRACK_TARGET_SMOOTH_ALPHA,
      y: previousCenter.y + (rawCenter.y - previousCenter.y) * TRACK_TARGET_SMOOTH_ALPHA
    };
    const center = limitCenterStep(previousCenter, lowPassCenter, TRACK_TARGET_MAX_CENTER_STEP);
    const width = clampNumber(previous.width + (rawTarget.width - previous.width) * TRACK_TARGET_SIZE_ALPHA, 0.01, 1);
    const height = clampNumber(previous.height + (rawTarget.height - previous.height) * TRACK_TARGET_SIZE_ALPHA, 0.01, 1);
    const stableTarget: NormalizedFaceBox = {
      ...rawTarget,
      width,
      height,
      x: clampNumber(center.x - width / 2, 0, 1 - width),
      y: clampNumber(center.y - height / 2, 0, 1 - height)
    };
    this.smoothedTarget = stableTarget;
    return stableTarget;
  }

  private sendTrackCommand(command: Parameters<RobotController["trackFace"]>[0]): void {
    const now = Date.now();
    const minInterval = 1000 / this.options.commandMaxHz;
    if (command.detected && !this.shouldSendDetectedTarget(command.bbox, now, minInterval)) {
      return;
    }
    this.lastCommandAt = now;
    if (command.detected && command.bbox) {
      this.lastSentTrackTarget = command.bbox;
    } else {
      this.lastSentTrackTarget = undefined;
    }
    void this.controller.trackFace(command, { waitForAck: false }).then((result) => {
      if (!result.sent) {
        this.lastError = result.reason ?? "face tracking command was not sent";
      }
      this.emitPreviewUpdate();
    });
  }

  private shouldSendDetectedTarget(target: NormalizedFaceBox | undefined, now: number, minIntervalMs: number): boolean {
    if (now - this.lastCommandAt < minIntervalMs) {
      return false;
    }
    if (!target || !this.lastSentTrackTarget) {
      return true;
    }
    if (now - this.lastCommandAt >= TRACK_TARGET_REFRESH_MS) {
      return true;
    }

    const previousCenterX = this.lastSentTrackTarget.x + this.lastSentTrackTarget.width / 2;
    const previousCenterY = this.lastSentTrackTarget.y + this.lastSentTrackTarget.height / 2;
    const centerX = target.x + target.width / 2;
    const centerY = target.y + target.height / 2;
    return (
      Math.abs(centerX - previousCenterX) >= TRACK_TARGET_CENTER_EPSILON ||
      Math.abs(centerY - previousCenterY) >= TRACK_TARGET_CENTER_EPSILON ||
      Math.abs(target.width - this.lastSentTrackTarget.width) >= TRACK_TARGET_SIZE_EPSILON ||
      Math.abs(target.height - this.lastSentTrackTarget.height) >= TRACK_TARGET_SIZE_EPSILON
    );
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

function limitCenterStep(
  previous: { x: number; y: number },
  next: { x: number; y: number },
  maxStep: number
): { x: number; y: number } {
  const deltaX = next.x - previous.x;
  const deltaY = next.y - previous.y;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance <= maxStep || distance === 0) {
    return {
      x: clampNumber(next.x, 0, 1),
      y: clampNumber(next.y, 0, 1)
    };
  }
  const scale = maxStep / distance;
  return {
    x: clampNumber(previous.x + deltaX * scale, 0, 1),
    y: clampNumber(previous.y + deltaY * scale, 0, 1)
  };
}

function clampFace(face: NormalizedFaceBox): NormalizedFaceBox {
  const width = clampNumber(face.width, 0.01, 1);
  const height = clampNumber(face.height, 0.01, 1);
  return {
    ...face,
    width,
    height,
    x: clampNumber(face.x, 0, 1 - width),
    y: clampNumber(face.y, 0, 1 - height)
  };
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, value)));
}

function detectorSettingsFromConfig(config: DesktopConfig): FaceDetectorSettings {
  return {
    minDetectionConfidence: clampNumber(config.faceTrackingMinDetectionConfidence, 0.05, 1),
    minPresenceConfidence: clampNumber(config.faceTrackingMinPresenceConfidence, 0.05, 1),
    minTrackingConfidence: clampNumber(config.faceTrackingMinTrackingConfidence, 0.05, 1)
  };
}

function detectorEnv(settings: FaceDetectorSettings): NodeJS.ProcessEnv {
  return {
    STACKCHAN_FACE_TRACKING_MIN_DETECTION_CONFIDENCE: String(settings.minDetectionConfidence),
    STACKCHAN_FACE_TRACKING_MIN_PRESENCE_CONFIDENCE: String(settings.minPresenceConfidence),
    STACKCHAN_FACE_TRACKING_MIN_TRACKING_CONFIDENCE: String(settings.minTrackingConfidence)
  };
}

function sameDetectorSettings(left: FaceDetectorSettings, right: FaceDetectorSettings): boolean {
  return (
    left.minDetectionConfidence === right.minDetectionConfidence &&
    left.minPresenceConfidence === right.minPresenceConfidence &&
    left.minTrackingConfidence === right.minTrackingConfidence
  );
}

function sameCameraSettings(left: CameraStreamSettings, right: CameraStreamSettings): boolean {
  return left.width === right.width && left.height === right.height && left.fps === right.fps && left.quality === right.quality;
}

function settingsFromConfig(config: DesktopConfig): VisionTrackingSettings {
  return {
    speed: clampNumber(config.faceTrackingSpeed, 0, 1000),
    camera: cameraSettingsFromPreset(config.faceTrackingCameraPreset),
    detector: detectorSettingsFromConfig(config),
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
      outputLimitDeg: clampNumber(config.faceTrackingOutputLimitDeg, 1, 45),
      servoRange: { ...OFFICIAL_SERVO_RANGE }
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
    detector: {
      minDetectionConfidence:
        patch.detector?.minDetectionConfidence === undefined
          ? current.detector.minDetectionConfidence
          : clampNumber(patch.detector.minDetectionConfidence, 0.05, 1),
      minPresenceConfidence:
        patch.detector?.minPresenceConfidence === undefined
          ? current.detector.minPresenceConfidence
          : clampNumber(patch.detector.minPresenceConfidence, 0.05, 1),
      minTrackingConfidence:
        patch.detector?.minTrackingConfidence === undefined
          ? current.detector.minTrackingConfidence
          : clampNumber(patch.detector.minTrackingConfidence, 0.05, 1)
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
          : clampNumber(patch.control.outputLimitDeg, 1, 45),
      servoRange: {
        yawMin:
          patch.control?.servoRange?.yawMin === undefined
            ? current.control.servoRange.yawMin
            : clampNumber(patch.control.servoRange.yawMin, -1800, 0),
        yawMax:
          patch.control?.servoRange?.yawMax === undefined
            ? current.control.servoRange.yawMax
            : clampNumber(patch.control.servoRange.yawMax, 0, 1800),
        pitchMin:
          patch.control?.servoRange?.pitchMin === undefined
            ? current.control.servoRange.pitchMin
            : clampNumber(patch.control.servoRange.pitchMin, -900, 1200),
        pitchMax:
          patch.control?.servoRange?.pitchMax === undefined
            ? current.control.servoRange.pitchMax
            : clampNumber(patch.control.servoRange.pitchMax, -900, 1200)
      }
    }
  };
  if (next.control.servoRange.yawMin > next.control.servoRange.yawMax) {
    [next.control.servoRange.yawMin, next.control.servoRange.yawMax] = [
      next.control.servoRange.yawMax,
      next.control.servoRange.yawMin
    ];
  }
  if (next.control.servoRange.pitchMin > next.control.servoRange.pitchMax) {
    [next.control.servoRange.pitchMin, next.control.servoRange.pitchMax] = [
      next.control.servoRange.pitchMax,
      next.control.servoRange.pitchMin
    ];
  }
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
