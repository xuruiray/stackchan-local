export const DEVICE_CAPABILITIES = [
  "audio",
  "camera",
  "motion",
  "face",
  "rgb",
  "touch",
  "bmi270",
  "battery",
  "wifi",
  "ble",
  "rtc",
  "servos",
  "nfc",
  "ir",
  "proximity",
  "ambientLight",
  "magnetometer",
  "mic",
  "display",
  "bleProvisioning",
  "mediaCredit"
] as const;

export type DeviceCapability = (typeof DEVICE_CAPABILITIES)[number];

export type RobotMode =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "pairing"
  | "sleeping"
  | "error";

export type RobotEmotion =
  | "neutral"
  | "happy"
  | "laughing"
  | "love"
  | "sad"
  | "crying"
  | "angry"
  | "thinking"
  | "surprised"
  | "sleepy"
  | "doubtful";

export interface AudioParams {
  format: "opus";
  sampleRate: 16000 | 24000;
  channels: 1;
  frameDurationMs: 20 | 30 | 40 | 60;
}

export interface HandshakeMessage {
  type: "handshake";
  deviceId: string;
  firmwareVersion: string;
  capabilities: DeviceCapability[];
  audioParams: AudioParams;
  pairingToken: string;
}

export interface DaemonHelloMessage {
  type: "daemon.hello";
  protocolVersion?: "1.1" | "1.2";
  sessionId: string;
  heartbeatIntervalMs: number;
  featureFlags: string[];
  featureParams?: {
    binaryCameraFrame?: {
      envelope: "SCL1";
      cameraKind: 1;
    };
    mediaCredit?: {
      defaultCreditFrames: number;
      maxCreditFrames: number;
    };
  };
  qosProfiles?: {
    robotCommand: "reliable";
    cameraFrame: "latestOnly";
    telemetry: "bestEffort";
    audio: "reliableChunked";
  };
  audioParams: AudioParams;
}

export type SayCommand = {
  kind: "say";
  text: string;
  interrupt?: boolean;
  voice?: string;
};

export type ReactCommand = {
  kind: "react";
  emotion: RobotEmotion;
  durationMs?: number;
  avatarJson?: Record<string, unknown>;
  rgbJson?: Record<string, unknown>;
};

export type MoveHeadCommand = {
  kind: "moveHead";
  yaw: number;
  pitch: number;
  speed?: number;
};

export type CameraStreamCommand = {
  kind: "cameraStream";
  enabled: boolean;
  fps?: number;
  width?: number;
  height?: number;
  quality?: number;
  format?: "jpeg";
};

export type NormalizedFaceBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence?: number;
  trackingId?: string | number;
  landmarks?: FaceLandmarks;
  pose?: FacePose;
  transformMatrix?: number[];
  expression?: FaceExpression;
  detector?: string;
};

export type NormalizedFacePoint = {
  x: number;
  y: number;
  z?: number;
};

export type FaceLandmarks = {
  all?: NormalizedFacePoint[];
  nose?: NormalizedFacePoint;
  leftEye?: NormalizedFacePoint;
  rightEye?: NormalizedFacePoint;
  mouthLeft?: NormalizedFacePoint;
  mouthRight?: NormalizedFacePoint;
  mouthCenter?: NormalizedFacePoint;
  chin?: NormalizedFacePoint;
};

export type FacePose = {
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
};

export type FaceExpression = {
  smile?: number;
  leftEyeOpen?: number;
  rightEyeOpen?: number;
  blendshapes?: Record<string, number>;
};

export type FaceTrackingPidAxis = {
  kp: number;
  ki: number;
  kd: number;
};

export type FaceServoRange = {
  yawMin: number;
  yawMax: number;
  pitchMin: number;
  pitchMax: number;
};

export type FaceTrackingControl = {
  mode: "pid";
  deadband: number;
  yaw: FaceTrackingPidAxis;
  pitch: FaceTrackingPidAxis;
  integralLimit: number;
  outputLimitDeg: number;
  servoRange: FaceServoRange;
};

export type TrackFaceCommand = {
  kind: "trackFace";
  detected: boolean;
  centerX?: number;
  centerY?: number;
  bbox?: NormalizedFaceBox;
  confidence?: number;
  speed?: number;
  control?: FaceTrackingControl;
  reason?: string;
};

export type PlayAnimationCommand = {
  kind: "playAnimation";
  sequence: unknown[];
  loop?: boolean;
};

export type PlayAudioStartCommand = {
  kind: "playAudioStart";
  requestId: string;
  format: "ogg_opus";
  mimeType: "audio/ogg";
  sampleRate: 16000 | 24000;
  totalBytes: number;
  totalChunks: number;
  text?: string;
  interrupt?: boolean;
  volume?: number;
};

export type PlayAudioChunkCommand = {
  kind: "playAudioChunk";
  requestId: string;
  chunkIndex: number;
  dataBase64: string;
};

export type PlayAudioEndCommand = {
  kind: "playAudioEnd";
  requestId: string;
};

export type PlayAudioCommand = PlayAudioStartCommand | PlayAudioChunkCommand | PlayAudioEndCommand;

export type CaptureImageCommand = {
  kind: "captureImage";
  requestId: string;
  format?: "jpeg";
};

export type SetModeCommand = {
  kind: "setMode";
  mode: RobotMode;
  reason?: string;
};

export type SetRgbCommand = {
  kind: "setRgb";
  enabled: boolean;
  color?: string;
  brightness?: number;
};

export type TelemetryConfigCommand = {
  kind: "telemetryConfig";
  hardwareStatusHz?: 0 | 0.5 | 1 | 2;
  includeI2cScan?: boolean;
  reason?: string;
};

export type MediaFlowControlCommand = {
  kind: "mediaFlowControl";
  stream: "camera";
  creditFrames: number;
  maxInFlight?: number;
  reason?: string;
};

export type RobotCommand =
  | SayCommand
  | ReactCommand
  | MoveHeadCommand
  | CameraStreamCommand
  | TrackFaceCommand
  | PlayAnimationCommand
  | PlayAudioCommand
  | CaptureImageCommand
  | SetModeCommand
  | SetRgbCommand
  | TelemetryConfigCommand
  | MediaFlowControlCommand;

export interface RobotCommandMessage {
  type: "robot.command";
  seq?: number;
  commandId: string;
  command: RobotCommand;
}

export type ProtocolTrace = {
  deviceCapturedAt?: string;
  deviceEncodedAt?: string;
  deviceQueuedAt?: string;
  deviceSentAt?: string;
  deviceTxStartAt?: string;
  daemonReceivedAt?: string;
  detectorStartedAt?: string;
  detectorFinishedAt?: string;
};

export type RobotEvent =
  | {
      kind: "touch";
      gesture: "tap" | "doubleTap" | "longPress" | "pet" | "press" | "release" | "swipeForward" | "swipeBackward";
      surface?: "head" | "screen";
      pressed?: boolean;
      x?: number;
      y?: number;
      points?: number;
    }
  | {
      kind: "bmi270";
      motion: "shake" | "tilt" | "none";
      x?: number;
      y?: number;
      z?: number;
      gyroX?: number;
      gyroY?: number;
      gyroZ?: number;
      uptimeMs?: number;
      magnetometer?: {
        available: boolean;
        x?: number;
        y?: number;
        z?: number;
        rawX?: number;
        rawY?: number;
        rawZ?: number;
        headingDeg?: number;
        reason?: string;
      };
    }
  | {
      kind: "proximity";
      available: boolean;
      value?: number;
      raw?: number;
      uptimeMs?: number;
      reason?: string;
    }
  | {
      kind: "ambientLight";
      available: boolean;
      lux?: number;
      raw?: number;
      uptimeMs?: number;
      reason?: string;
    }
  | {
      kind: "nfc";
      action: "tagDetected" | "tagChanged" | "tagRemoved" | "readError";
      uptimeMs: number;
      uid?: string;
      tech?: "iso14443a" | "iso14443b" | "felica" | "iso15693" | "unknown";
      atqa?: string;
      sak?: number;
      reason?: string;
    }
  | {
      kind: "ir";
      action: "received" | "receiveError" | "transmitStarted" | "transmitCompleted" | "transmitFailed";
      uptimeMs: number;
      protocol?: "nec" | "sony" | "rc5" | "rc6" | "raw" | "unknown";
      address?: string;
      command?: string;
      code?: string;
      bits?: number;
      repeat?: boolean;
      requestId?: string;
      carrierHz?: number;
      reason?: string;
    }
  | { kind: "wakeWord"; text: string }
  | { kind: "state"; mode: RobotMode; detail?: string }
  | { kind: "image"; requestId: string; mimeType: "image/jpeg"; dataBase64: string }
  | {
      kind: "commandAck";
      commandId: string;
      commandKind: RobotCommand["kind"] | "unknown";
      requestId?: string;
      status: "accepted" | "rejected";
      message?: string;
    }
  | {
      kind: "commandStatus";
      commandId: string;
      commandKind: RobotCommand["kind"] | "unknown";
      requestId?: string;
      status: "started" | "completed" | "failed" | "cancelled";
      message?: string;
      progress?: number;
    }
  | {
      kind: "playback";
      requestId: string;
      state: "started" | "finished" | "failed";
      message?: string;
    }
  | {
      kind: "cameraFrame";
      frameId: string;
      mimeType: "image/jpeg";
      width: number;
      height: number;
      dataBase64: string;
      seq?: number;
      captureTimestamp?: string;
      sentAt?: string;
      trace?: ProtocolTrace;
    }
  | {
      kind: "hardwareStatus";
      uptimeMs: number;
      power?: {
        batteryLevel?: number;
        charging?: boolean;
        backlight?: number;
        speakerVolume?: number;
      };
      network?: {
        wifi?: {
          status: "disconnected" | "connecting" | "connected";
          rssi?: number;
          ssid?: string;
        };
        ble?: {
          connected?: boolean;
          reason?: string;
        };
      };
      motion?: {
        servos?: {
          power?: boolean;
          reason?: string;
        };
      };
      peripherals?: {
        headTouch?: {
          available: boolean;
          reason?: string;
        };
        ioExpander?: {
          available: boolean;
          reason?: string;
        };
        camera?: {
          available: boolean;
          streaming?: boolean;
          adaptiveLevel?: number;
          reason?: string;
        };
        rgb?: {
          available: boolean;
          enabled?: boolean;
          reason?: string;
        };
        rtc?: {
          available: boolean;
          timestamp?: string;
          timezone?: string;
          reason?: string;
        };
        nfc?: {
          available: boolean;
          reason?: string;
        };
        powerMonitor?: {
          available: boolean;
          busVoltage?: number;
          shuntVoltage?: number;
          current?: number;
          power?: number;
          reason?: string;
        };
        ir?: {
          available: boolean;
          reason?: string;
        };
        mic?: {
          available: boolean;
          reason?: string;
        };
        i2cScan?: Array<{
          stage: string;
          uptimeMs: number;
          addresses: number[];
          targets?: {
            ltr553?: boolean;
            ina226?: boolean;
            nfc?: boolean;
          };
          reason?: string;
        }>;
      };
    };

export interface RobotEventMessage {
  type: "robot.event";
  seq?: number;
  eventId: string;
  deviceId: string;
  timestamp: string;
  event: RobotEvent;
}

export interface HeartbeatMessage {
  type: "heartbeat";
  seq?: number;
  deviceId: string;
  timestamp: string;
}

export interface ErrorMessage {
  type: "error";
  seq?: number;
  code: string;
  message: string;
  recoverable: boolean;
  commandId?: string;
}

export type LocalProtocolMessage =
  | HandshakeMessage
  | DaemonHelloMessage
  | RobotCommandMessage
  | RobotEventMessage
  | HeartbeatMessage
  | ErrorMessage;
