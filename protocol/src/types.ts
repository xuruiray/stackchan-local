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
  "bleProvisioning"
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
  sessionId: string;
  heartbeatIntervalMs: number;
  featureFlags: string[];
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
  format?: "jpeg";
};

export type NormalizedFaceBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence?: number;
};

export type FaceTrackingPidAxis = {
  kp: number;
  ki: number;
  kd: number;
};

export type FaceTrackingControl = {
  mode: "pid";
  deadband: number;
  yaw: FaceTrackingPidAxis;
  pitch: FaceTrackingPidAxis;
  integralLimit: number;
  outputLimitDeg: number;
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

export type RobotCommand =
  | SayCommand
  | ReactCommand
  | MoveHeadCommand
  | CameraStreamCommand
  | TrackFaceCommand
  | PlayAnimationCommand
  | PlayAudioCommand
  | CaptureImageCommand
  | SetModeCommand;

export interface RobotCommandMessage {
  type: "robot.command";
  commandId: string;
  command: RobotCommand;
}

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
          reason?: string;
        };
        rgb?: {
          available: boolean;
          count?: number;
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
        ir?: {
          available: boolean;
          reason?: string;
        };
        proximity?: {
          available: boolean;
          value?: number;
          reason?: string;
        };
        ambientLight?: {
          available: boolean;
          lux?: number;
          reason?: string;
        };
        magnetometer?: {
          available: boolean;
          x?: number;
          y?: number;
          z?: number;
          headingDeg?: number;
          reason?: string;
        };
        mic?: {
          available: boolean;
          channels?: number;
          mode?: "mono_opus" | "unknown";
          localization?: "abandoned" | "unsupported";
          reason?: string;
        };
      };
    };

export interface RobotEventMessage {
  type: "robot.event";
  eventId: string;
  deviceId: string;
  timestamp: string;
  event: RobotEvent;
}

export interface HeartbeatMessage {
  type: "heartbeat";
  deviceId: string;
  timestamp: string;
}

export interface ErrorMessage {
  type: "error";
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
