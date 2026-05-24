export const DEVICE_CAPABILITIES = [
  "audio",
  "camera",
  "motion",
  "face",
  "rgb",
  "touch",
  "imu",
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
  | "sad"
  | "angry"
  | "surprised"
  | "sleepy"
  | "thinking"
  | "love";

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
  sensorSnapshotHz?: 0 | 0.5 | 1;
  imuHz?: 0 | 1 | 2 | 4;
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
  deviceSentAt?: string;
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
      kind: "imu";
      motion: "shake" | "tilt" | "none";
      x?: number;
      y?: number;
      z?: number;
      gyroX?: number;
      gyroY?: number;
      gyroZ?: number;
      uptimeMs?: number;
    }
  | { kind: "battery"; level: number; charging: boolean }
  | { kind: "wifi"; status: "disconnected" | "connecting" | "connected"; rssi?: number; ssid?: string }
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
      kind: "sensorSnapshot";
      uptimeMs: number;
      power?: {
        batteryLevel?: number;
        charging?: boolean;
        backlight?: number;
        speakerVolume?: number;
        servoPower?: boolean;
      };
      network?: {
        wifi?: {
          status: "disconnected" | "connecting" | "connected";
          rssi?: number;
          ssid?: string;
        };
        ble?: {
          available: boolean;
          connected?: boolean;
          provisioning?: boolean;
          reason?: string;
        };
      };
      motion?: {
        imu?: {
          available: boolean;
          motion?: "shake" | "tilt" | "none";
          x?: number;
          y?: number;
          z?: number;
          gyroX?: number;
          gyroY?: number;
          gyroZ?: number;
          uptimeMs?: number;
          reason?: string;
        };
        servos?: {
          available: boolean;
          yaw?: {
            angle?: number;
            moving?: boolean;
            torque?: boolean;
          };
          pitch?: {
            angle?: number;
            moving?: boolean;
            torque?: boolean;
          };
          power?: boolean;
          reason?: string;
        };
      };
      interaction?: {
        screenTouch?: {
          available: boolean;
          pressed?: boolean;
          x?: number;
          y?: number;
          points?: number;
          reason?: string;
        };
        headTouch?: {
          available: boolean;
          gesture?: "tap" | "doubleTap" | "longPress" | "pet" | "press" | "release" | "swipeForward" | "swipeBackward";
          pressed?: boolean;
          zones?: number[];
          reason?: string;
        };
        wakeWord?: {
          available: boolean;
          text?: string;
          reason?: string;
        };
      };
      peripherals?: {
        ioExpander?: {
          available: boolean;
          reason?: string;
        };
        camera?: {
          available: boolean;
          streaming?: boolean;
          width?: number;
          height?: number;
          fps?: number;
          requestedWidth?: number;
          requestedHeight?: number;
          actualWidth?: number;
          actualHeight?: number;
          quality?: number;
          transport?: "jsonBase64" | "binary";
          adaptiveLevel?: number;
          fallbackReason?: string;
          reason?: string;
        };
        rgb?: {
          available: boolean;
          count?: number;
          enabled?: boolean;
          color?: string;
          brightness?: number;
          driver?: string;
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
          driver?: string;
          address?: number;
          status?: "chip_detected" | "ready" | "card_detected" | "inactive";
          reason?: string;
        };
        powerMonitor?: {
          available: boolean;
          driver?: string;
          address?: number;
          busVoltage?: number;
          shuntVoltage?: number;
          current?: number;
          power?: number;
          reason?: string;
        };
        ir?: {
          available: boolean;
          driver?: string;
          txPin?: number;
          rxPin?: number;
          reason?: string;
        };
        proximity?: {
          available: boolean;
          value?: number;
          raw?: number;
          driver?: string;
          reason?: string;
        };
        ambientLight?: {
          available: boolean;
          lux?: number;
          raw?: number;
          driver?: string;
          reason?: string;
        };
        magnetometer?: {
          available: boolean;
          x?: number;
          y?: number;
          z?: number;
          rawX?: number;
          rawY?: number;
          rawZ?: number;
          headingDeg?: number;
          driver?: string;
          reason?: string;
        };
        mic?: {
          available: boolean;
          channels?: number;
          mode?: "mono_opus" | "unknown";
          localization?: "abandoned" | "unsupported";
          level?: number;
          rms?: number;
          peak?: number;
          dbfs?: number;
          updatedAt?: number;
          driver?: string;
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
