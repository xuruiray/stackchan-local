import type {
  FaceExpression,
  FaceTrackingControl,
  NormalizedFaceBox,
  ProtocolTrace,
  RobotEmotion,
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
  adaptive: VisionAdaptiveStatus;
  detectorAvailable: boolean;
  lastFrameAt?: string;
  lastDetectionAt?: string;
  lastFaceAt?: string;
  lastCommandAt?: string;
  lastTarget?: NormalizedFaceBox;
  lastExpression?: FaceExpressionSummary;
  lastExpressionAt?: string;
  lastExpressionCommandAt?: string;
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
  detector?: Partial<FaceDetectorSettings>;
  control?: Partial<Omit<FaceTrackingControl, "mode" | "yaw" | "pitch" | "servoRange">> & {
    mode?: "pid";
    yaw?: Partial<FaceTrackingControl["yaw"]>;
    pitch?: Partial<FaceTrackingControl["pitch"]>;
    servoRange?: Partial<FaceTrackingControl["servoRange"]>;
  };
}

export interface VisionTrackingOptions {
  commandMaxHz?: number;
  lostTimeoutMs?: number;
  streamRetryMs?: number;
  adaptivePressureMs?: number;
  adaptiveStableMs?: number;
}

const DEFAULT_OPTIONS: Required<VisionTrackingOptions> = {
  commandMaxHz: 10,
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
const CAMERA_MEDIA_INITIAL_CREDIT_FRAMES = 2;
const CAMERA_MEDIA_STEADY_CREDIT_FRAMES = 1;
const CAMERA_MEDIA_MAX_IN_FLIGHT = 2;
const EXPRESSION_CHANGED_INTERVAL_MS = 450;
const EXPRESSION_REFRESH_INTERVAL_MS = 900;
const EXPRESSION_REACT_DURATION_MS = 1200;

const OFFICIAL_SERVO_RANGE: FaceTrackingControl["servoRange"] = {
  yawMin: -1280,
  yawMax: 1280,
  pitchMin: 0,
  pitchMax: 900
};

export interface FaceExpressionSummary {
  emotion: RobotEmotion;
  smile?: number;
  leftEyeOpen?: number;
  rightEyeOpen?: number;
  jawOpen?: number;
  mouthFunnel?: number;
  eyeWide?: number;
  browInnerUp?: number;
  topBlendshapes?: Array<{ name: string; score: number }>;
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
  private lastExpression?: FaceExpressionSummary;
  private lastExpressionAt?: Date;
  private lastExpressionCommandAt = 0;
  private lastExpressionSignature?: string;
  private lastFrame?: VisionFrameSnapshot;
  private lastFaces: NormalizedFaceBox[] = [];
  private lastError?: string;
  private detectorLatencyMs?: number;
  private lastDetectorTimestampMs = 0;
  private cameraStreamInFlight = false;
  private cameraStreamAckFailures = 0;
  private lastCameraRecoveryAt = 0;
  private framesReceived = 0;
  private framesDropped = 0;
  private mediaCreditGrantedFrames = 0;
  private mediaCreditLastGrantedAt = 0;
  private mediaCreditReason?: string;
  private adaptiveLevel = 0;
  private adaptiveReason?: string;
  private adaptiveLastChangedAt = 0;
  private adaptivePressureSince = 0;
  private adaptiveStableSince = 0;
  private adaptiveWindowStartedAt = 0;
  private adaptiveWindowFrames = 0;
  private adaptiveWindowDropped = 0;
  private adaptiveDropRate = 0;
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
    if (enabled) {
      this.logger.info("face tracking enabled", {
        fps: this.effectiveCameraSettings().fps,
        camera: this.effectiveCameraSettings(),
        mirrorX: this.config.faceTrackingMirrorX
      });
      this.ensureCameraStream(true);
    } else {
      this.logger.info("face tracking disabled");
      this.resetAdaptiveState("face tracking disabled");
      void this.controller.cameraStream({
        enabled: false,
        fps: this.settings.camera.fps,
        width: this.settings.camera.width,
        height: this.settings.camera.height,
        quality: this.settings.camera.quality,
        format: "jpeg"
      });
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
      this.lastFaces = [];
      this.lastTarget = undefined;
      this.lastExpression = undefined;
      this.lastExpressionAt = undefined;
      this.lastExpressionCommandAt = 0;
      this.lastExpressionSignature = undefined;
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

  status(): VisionTrackingStatus {
    const camera = this.effectiveCameraSettings();
    return {
      enabled: this.enabled,
      fps: camera.fps,
      mirrorX: this.config.faceTrackingMirrorX,
      control: this.settings,
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
      lastExpression: this.lastExpression,
      lastExpressionAt: this.lastExpressionAt?.toISOString(),
      lastExpressionCommandAt:
        this.lastExpressionCommandAt > 0 ? new Date(this.lastExpressionCommandAt).toISOString() : undefined,
      lastError: this.lastError,
      framesReceived: this.framesReceived,
      framesDropped: this.framesDropped,
      detectorLatencyMs: this.detectorLatencyMs,
      latency: this.latencyStatus(),
      mediaCredit: {
        enabled: this.mediaCreditEnabled(),
        grantedFrames: this.mediaCreditGrantedFrames,
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
    if (!this.enabled) {
      return;
    }
    const now = Date.now();
    if (this.cameraStreamInFlight) {
      return;
    }

    const frameStale = !this.lastFrameAt || now - this.lastFrameAt.getTime() > CAMERA_STREAM_STALE_MS;
    const retryMs = frameStale
      ? Math.min(
          CAMERA_STREAM_MAX_RETRY_MS,
          this.options.streamRetryMs * Math.max(1, 2 ** Math.min(this.cameraStreamAckFailures, 4))
        )
      : CAMERA_STREAM_HEALTHY_REFRESH_MS;
    if (!force && now - this.lastStreamCommandAt < retryMs) {
      return;
    }
    this.cameraStreamInFlight = true;
    const camera = this.effectiveCameraSettings();
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
        this.grantCameraMediaCredit(CAMERA_MEDIA_INITIAL_CREDIT_FRAMES, "camera stream active");
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
    if (!this.enabled || message.event.kind !== "cameraFrame") {
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
    if (!this.enabled || !this.mediaCreditEnabled()) {
      return;
    }
    this.mediaCreditGrantedFrames += creditFrames;
    this.mediaCreditLastGrantedAt = Date.now();
    this.mediaCreditReason = reason;
    void this.controller.mediaFlowControl(
      {
        stream: "camera",
        creditFrames,
        maxInFlight: CAMERA_MEDIA_MAX_IN_FLIGHT,
        reason
      },
      { waitForAck: false }
    );
  }

  private mediaCreditEnabled(): boolean {
    return this.registry.getActiveSession()?.capabilities.includes("mediaCredit") ?? false;
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
        sensorSnapshotHz: level > 0 ? 0.5 : 1,
        imuHz: level > 0 ? 2 : 4,
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
          sensorSnapshotHz: 1,
          imuHz: 4,
          includeI2cScan: true,
          reason
        },
        { waitForAck: false }
      );
    }
  }

  private handleDetection(result: FaceDetectionResult): void {
    this.lastFaces = result.faces;
    const selected = selectTrackingFace(result.faces);
    if (selected) {
      const trackingTarget = this.config.faceTrackingMirrorX ? mirrorFace(selected) : selected;
      const centerX = trackingTarget.x + trackingTarget.width / 2;
      const centerY = trackingTarget.y + trackingTarget.height / 2;
      this.lastFaceAt = new Date();
      this.lastTarget = selected;
      this.lostCommandSent = false;
      this.sendTrackCommand({
        detected: true,
        centerX,
        centerY,
        bbox: selected,
        confidence: selected.confidence,
        speed: this.settings.speed,
        control: this.settings.control
      });
      this.syncExpression(selected);
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
      this.sendTrackCommand({
        detected: false,
        reason: "face_lost",
        speed: this.settings.speed,
        control: this.settings.control
      });
    }
  }

  private sendTrackCommand(command: Parameters<RobotController["trackFace"]>[0]): void {
    const now = Date.now();
    const minInterval = 1000 / this.options.commandMaxHz;
    if (command.detected && now - this.lastCommandAt < minInterval) {
      return;
    }
    this.lastCommandAt = now;
    void this.controller.trackFace(command, { waitForAck: false }).then((result) => {
      if (!result.sent) {
        this.lastError = result.reason ?? "face tracking command was not sent";
      }
      this.emitPreviewUpdate();
    });
  }

  private syncExpression(face: NormalizedFaceBox): void {
    const expression = buildExpressionSync(face);
    if (!expression) {
      return;
    }

    const now = Date.now();
    this.lastExpression = expression.summary;
    this.lastExpressionAt = new Date(now);

    const changed = expression.signature !== this.lastExpressionSignature;
    const minInterval = changed ? EXPRESSION_CHANGED_INTERVAL_MS : EXPRESSION_REFRESH_INTERVAL_MS;
    if (now - this.lastExpressionCommandAt < minInterval) {
      return;
    }

    this.lastExpressionSignature = expression.signature;
    this.lastExpressionCommandAt = now;
    void this.controller.react(
      {
        emotion: expression.summary.emotion,
        durationMs: EXPRESSION_REACT_DURATION_MS,
        avatarJson: expression.avatarJson
      },
      { waitForAck: false }
    ).then((result) => {
      if (!result.sent) {
        this.lastError = result.reason ?? "face expression command was not sent";
      }
      this.emitPreviewUpdate();
    });
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

export function selectTrackingFace(faces: NormalizedFaceBox[]): NormalizedFaceBox | undefined {
  return faces
    .filter((face) => face.width > 0 && face.height > 0)
    .sort((a, b) => faceScore(b) - faceScore(a))[0];
}

function faceScore(face: NormalizedFaceBox): number {
  const area = face.width * face.height;
  const centerX = face.x + face.width / 2;
  const centerY = face.y + face.height / 2;
  const distanceFromCenter = Math.hypot(centerX - 0.5, centerY - 0.5);
  return area - distanceFromCenter * 0.05;
}

function mirrorFace(face: NormalizedFaceBox): NormalizedFaceBox {
  return {
    ...face,
    x: 1 - face.x - face.width
  };
}

function buildExpressionSync(face: NormalizedFaceBox):
  | {
      summary: FaceExpressionSummary;
      avatarJson: Record<string, unknown>;
      signature: string;
    }
  | undefined {
  if (!face.expression) {
    return undefined;
  }

  const expression = normalizeExpression(face.expression);
  const emotion = classifyExpression(expression);
  const avatarJson = expressionAvatarJson(expression);
  const summary: FaceExpressionSummary = {
    emotion,
    smile: expression.smile,
    leftEyeOpen: expression.leftEyeOpen,
    rightEyeOpen: expression.rightEyeOpen,
    jawOpen: expression.jawOpen,
    mouthFunnel: expression.mouthFunnel,
    eyeWide: expression.eyeWide,
    browInnerUp: expression.browInnerUp,
    topBlendshapes: topBlendshapes(expression.blendshapes)
  };

  return {
    summary,
    avatarJson,
    signature: [
      emotion,
      roundBucket(expression.smile, 0.08),
      roundBucket(expression.leftEyeOpen, 0.08),
      roundBucket(expression.rightEyeOpen, 0.08),
      roundBucket(expression.jawOpen, 0.08),
      roundBucket(expression.mouthFunnel, 0.08),
      roundBucket(expression.eyeWide, 0.08),
      avatarJsonSignature(avatarJson)
    ].join(":")
  };
}

interface NormalizedExpression {
  smile: number;
  leftEyeOpen: number;
  rightEyeOpen: number;
  jawOpen: number;
  mouthFunnel: number;
  eyeWide: number;
  eyeSquint: number;
  cheekSquint: number;
  browInnerUp: number;
  browDown: number;
  noseSneer: number;
  mouthSmileLeft: number;
  mouthSmileRight: number;
  blendshapes: Record<string, number>;
}

function normalizeExpression(expression: FaceExpression): NormalizedExpression {
  const blendshapes = expression.blendshapes ?? {};
  const leftBlink = numberOrZero(blendshapes.eyeBlinkLeft);
  const rightBlink = numberOrZero(blendshapes.eyeBlinkRight);
  const mouthSmileLeft = numberOrZero(blendshapes.mouthSmileLeft);
  const mouthSmileRight = numberOrZero(blendshapes.mouthSmileRight);

  return {
    smile: clamp01(expression.smile ?? average(mouthSmileLeft, mouthSmileRight)),
    leftEyeOpen: clamp01(expression.leftEyeOpen ?? 1 - leftBlink),
    rightEyeOpen: clamp01(expression.rightEyeOpen ?? 1 - rightBlink),
    jawOpen: clamp01(numberOrZero(blendshapes.jawOpen)),
    mouthFunnel: clamp01(numberOrZero(blendshapes.mouthFunnel)),
    eyeWide: clamp01(average(numberOrZero(blendshapes.eyeWideLeft), numberOrZero(blendshapes.eyeWideRight))),
    eyeSquint: clamp01(average(numberOrZero(blendshapes.eyeSquintLeft), numberOrZero(blendshapes.eyeSquintRight))),
    cheekSquint: clamp01(average(numberOrZero(blendshapes.cheekSquintLeft), numberOrZero(blendshapes.cheekSquintRight))),
    browInnerUp: clamp01(numberOrZero(blendshapes.browInnerUp)),
    browDown: clamp01(average(numberOrZero(blendshapes.browDownLeft), numberOrZero(blendshapes.browDownRight))),
    noseSneer: clamp01(average(numberOrZero(blendshapes.noseSneerLeft), numberOrZero(blendshapes.noseSneerRight))),
    mouthSmileLeft,
    mouthSmileRight,
    blendshapes
  };
}

function classifyExpression(expression: NormalizedExpression): RobotEmotion {
  const eyesOpen = average(expression.leftEyeOpen, expression.rightEyeOpen);
  if (eyesOpen < 0.24 || expression.eyeSquint > 0.65) {
    return "sleepy";
  }
  if (expression.eyeWide > 0.42 && (expression.jawOpen > 0.2 || expression.mouthFunnel > 0.2 || expression.browInnerUp > 0.34)) {
    return "surprised";
  }
  if (expression.browDown > 0.38 || expression.noseSneer > 0.32) {
    return "angry";
  }
  if (
    expression.smile > 0.32 ||
    (expression.smile > 0.22 && (expression.eyeSquint > 0.12 || expression.cheekSquint > 0.12))
  ) {
    return "happy";
  }
  return "neutral";
}

function expressionAvatarJson(expression: NormalizedExpression): Record<string, unknown> {
  const smile = expression.smile;
  const mouthWeight = clampInt(Math.max(smile, expression.jawOpen, expression.mouthFunnel * 0.65) * 100, 0, 100);
  const mouthX = clampInt((expression.mouthSmileRight - expression.mouthSmileLeft) * 100, -100, 100);
  let leftEyeWeight = clampInt(expression.leftEyeOpen * 100, 0, 100);
  let rightEyeWeight = clampInt(expression.rightEyeOpen * 100, 0, 100);
  let leftEyeRotation = 0;
  let rightEyeRotation = 0;

  if (smile > 0.3) {
    leftEyeWeight = clampInt(leftEyeWeight - 35, 0, 100);
    rightEyeWeight = clampInt(rightEyeWeight - 35, 0, 100);
    leftEyeRotation = normalizeRotation(-2150);
    rightEyeRotation = normalizeRotation(2150);
  } else if (smile < 0.1 && (expression.leftEyeOpen < 0.5 || expression.rightEyeOpen < 0.5)) {
    leftEyeRotation = normalizeRotation(450);
    rightEyeRotation = normalizeRotation(-450);
  }

  return {
    type: "bleAvatar",
    leftEye: expressionItem(leftEyeWeight, leftEyeRotation),
    rightEye: expressionItem(rightEyeWeight, rightEyeRotation),
    mouth: {
      x: mouthX,
      y: 0,
      rotation: 0,
      weight: mouthWeight,
      size: 0
    }
  };
}

function expressionItem(weight: number, rotation: number): Record<string, number> {
  return {
    x: 0,
    y: 0,
    rotation,
    weight,
    size: 0
  };
}

function topBlendshapes(blendshapes: Record<string, number>): Array<{ name: string; score: number }> {
  return Object.entries(blendshapes)
    .filter(([, score]) => Number.isFinite(score))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, score]) => ({ name, score: clamp01(score) }));
}

function avatarJsonSignature(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

function roundBucket(value: number, bucket: number): number {
  return Math.round(clamp01(value) / bucket) * bucket;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function average(left: number, right: number): number {
  return (left + right) / 2;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, value)));
}

function normalizeRotation(value: number): number {
  return ((Math.round(value) % 3600) + 3600) % 3600;
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
  const next = {
    speed: patch.speed === undefined ? current.speed : clampNumber(patch.speed, 0, 1000),
    camera: patch.cameraPreset ? cameraSettingsFromPreset(patch.cameraPreset, current.camera) : { ...current.camera },
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
  fallback: CameraStreamSettings = CAMERA_STREAM_PRESETS.fast
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
