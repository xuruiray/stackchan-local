import type { FaceTrackingControl, NormalizedFaceBox, RobotEventMessage } from "@stackchan-local/protocol";

import type { DesktopConfig, Logger } from "../config.js";
import type { DeviceRegistry } from "../device/registry.js";
import type { RobotController } from "../robot/controller.js";
import { OpenCvSidecarFaceDetector, type FaceDetectionResult, type FaceDetector } from "./detector.js";

export interface VisionTrackingStatus {
  enabled: boolean;
  fps: number;
  mirrorX: boolean;
  control: VisionTrackingSettings;
  detectorAvailable: boolean;
  lastFrameAt?: string;
  lastDetectionAt?: string;
  lastFaceAt?: string;
  lastCommandAt?: string;
  lastTarget?: NormalizedFaceBox;
  lastError?: string;
  framesReceived: number;
  framesDropped: number;
}

export interface VisionFrameSnapshot {
  frameId: string;
  mimeType: "image/jpeg";
  width: number;
  height: number;
  dataBase64: string;
  timestamp: string;
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
  control: FaceTrackingControl;
}

export interface VisionTrackingSettingsPatch {
  speed?: number;
  control?: Partial<Omit<FaceTrackingControl, "mode" | "yaw" | "pitch">> & {
    mode?: "pid";
    yaw?: Partial<FaceTrackingControl["yaw"]>;
    pitch?: Partial<FaceTrackingControl["pitch"]>;
  };
}

export interface VisionTrackingOptions {
  commandMaxHz?: number;
  lostTimeoutMs?: number;
  streamRetryMs?: number;
}

const DEFAULT_OPTIONS: Required<VisionTrackingOptions> = {
  commandMaxHz: 5,
  lostTimeoutMs: 1500,
  streamRetryMs: 1000
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
  private lastFrame?: VisionFrameSnapshot;
  private lastFaces: NormalizedFaceBox[] = [];
  private lastError?: string;
  private framesReceived = 0;
  private framesDropped = 0;
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
      detector ?? new OpenCvSidecarFaceDetector(config.faceTrackingPython, config.faceTrackingDetectorScript, logger);
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
      this.logger.info("face tracking enabled", { fps: this.config.faceTrackingFps, mirrorX: this.config.faceTrackingMirrorX });
      this.ensureCameraStream(true);
    } else {
      this.logger.info("face tracking disabled");
      void this.controller.cameraStream({ enabled: false, fps: this.config.faceTrackingFps, format: "jpeg" });
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
    this.settings = mergeSettings(this.settings, patch);
    this.logger.info("face tracking control updated", { settings: this.settings });
    this.emitPreviewUpdate();
    return this.status();
  }

  status(): VisionTrackingStatus {
    return {
      enabled: this.enabled,
      fps: this.config.faceTrackingFps,
      mirrorX: this.config.faceTrackingMirrorX,
      control: this.settings,
      detectorAvailable: this.detectorAvailable,
      lastFrameAt: this.lastFrameAt?.toISOString(),
      lastDetectionAt: this.lastDetectionAt?.toISOString(),
      lastFaceAt: this.lastFaceAt?.toISOString(),
      lastCommandAt: this.lastCommandAt > 0 ? new Date(this.lastCommandAt).toISOString() : undefined,
      lastTarget: this.lastTarget,
      lastError: this.lastError,
      framesReceived: this.framesReceived,
      framesDropped: this.framesDropped
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
    const retryMs = this.lastFrameAt ? 10_000 : this.options.streamRetryMs;
    if (!force && now - this.lastStreamCommandAt < retryMs) {
      return;
    }
    const resultPromise = this.controller.cameraStream({
      enabled: true,
      fps: this.config.faceTrackingFps,
      format: "jpeg"
    });
    this.lastStreamCommandAt = now;
    void resultPromise.then((result) => {
      if (result.sent && (!result.ack || result.ack.status === "accepted")) {
        return;
      }
      this.lastError = result.reason ?? result.ack?.message ?? "camera stream command was not accepted";
      if (force) {
        this.emitPreviewUpdate();
      }
    });
  }

  private async handleEvent(message: RobotEventMessage): Promise<void> {
    if (!this.enabled || message.event.kind !== "cameraFrame") {
      return;
    }
    this.framesReceived += 1;
    this.lastFrameAt = new Date(message.timestamp);
    this.lastFrame = {
      frameId: message.event.frameId,
      mimeType: message.event.mimeType,
      width: message.event.width,
      height: message.event.height,
      dataBase64: message.event.dataBase64,
      timestamp: message.timestamp
    };
    this.emitPreviewUpdate();

    if (this.inFlight) {
      this.framesDropped += 1;
      return;
    }

    this.inFlight = true;
    try {
      const result = await this.detector.detect({
        frameId: message.event.frameId,
        width: message.event.width,
        height: message.event.height,
        dataBase64: message.event.dataBase64
      });
      this.detectorAvailable = true;
      this.lastDetectionAt = new Date();
      this.handleDetection(result);
    } catch (error) {
      this.detectorAvailable = false;
      this.lastError = error instanceof Error ? error.message : String(error);
      this.logger.warn("face tracking detection failed", { error: this.lastError });
    } finally {
      this.inFlight = false;
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

  private emitPreviewUpdate(): void {
    const snapshot = this.previewSnapshot();
    for (const listener of this.previewListeners) {
      listener(snapshot);
    }
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

function settingsFromConfig(config: DesktopConfig): VisionTrackingSettings {
  return {
    speed: clampNumber(config.faceTrackingSpeed, 0, 1000),
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
  const next = {
    speed: patch.speed === undefined ? current.speed : clampNumber(patch.speed, 0, 1000),
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
