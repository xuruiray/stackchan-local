import type { WebSocket } from "ws";
import type {
  AudioParams,
  HandshakeMessage,
  RobotCommandMessage,
  RobotEventMessage,
  RobotMode
} from "@stackchan-local/protocol";

import type { Logger } from "../config.js";

export interface DeviceSession {
  deviceId: string;
  sessionId: string;
  firmwareVersion: string;
  capabilities: string[];
  audioParams: AudioParams;
  status: "online" | "offline";
  mode: RobotMode;
  connectedAt: Date;
  lastSeenAt: Date;
  heartbeatIntervalMs: number;
  lastHeartbeatAt?: Date;
  lastSeq?: number;
  audioFramesReceived: number;
  lastEvent?: RobotEventMessage;
  lastImageBase64?: string;
  lastImageAt?: Date;
  sensors: DeviceSensorState;
  ws: WebSocket;
}

export type SensorEventKind = "battery" | "wifi" | "imu" | "touch" | "wakeWord" | "state" | "sensorSnapshot";

export type DeviceSensorState = Partial<{
  [K in SensorEventKind]: Extract<RobotEventMessage["event"], { kind: K }> & {
    eventId: string;
    updatedAt: string;
    receivedAt: string;
  };
}>;

type ImageEvent = Extract<RobotEventMessage["event"], { kind: "image" }>;
type CameraFrameEvent = Extract<RobotEventMessage["event"], { kind: "cameraFrame" }>;
type SanitizedImageEvent = Omit<ImageEvent, "dataBase64"> & { dataLength: number };
type SanitizedCameraFrameEvent = Omit<CameraFrameEvent, "dataBase64"> & { dataLength: number };
type SanitizedRobotEvent =
  | Exclude<RobotEventMessage["event"], ImageEvent | CameraFrameEvent>
  | SanitizedImageEvent
  | SanitizedCameraFrameEvent;

export interface DeviceSnapshot {
  deviceId: string;
  sessionId: string;
  firmwareVersion: string;
  capabilities: string[];
  audioParams: AudioParams;
  status: "online" | "offline";
  mode: RobotMode;
  connectedAt: string;
  lastSeenAt: string;
  heartbeatIntervalMs: number;
  lastHeartbeatAt?: string;
  offlineDeadlineAt: string;
  lastSeq?: number;
  audioFramesReceived: number;
  lastEvent?: SanitizedRobotEvent;
  lastImageAt?: string;
  sensors: DeviceSensorState;
}

export interface CommandDispatchResult {
  sent: boolean;
  deviceId?: string;
  commandId?: string;
  reason?: string;
}

export type DeviceEventListener = (message: RobotEventMessage) => void;

export class DeviceRegistry {
  private readonly sessions = new Map<string, DeviceSession>();
  private readonly eventListeners = new Set<DeviceEventListener>();

  constructor(private readonly logger: Logger) {}

  onEvent(listener: DeviceEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  register(handshake: HandshakeMessage, ws: WebSocket, heartbeatIntervalMs = 15_000): DeviceSession {
    const existing = this.sessions.get(handshake.deviceId);
    if (existing && existing.ws !== ws) {
      existing.status = "offline";
      existing.ws.close(4000, "replaced by a newer local session");
    }
    const now = new Date();

    const session: DeviceSession = {
      deviceId: handshake.deviceId,
      sessionId: crypto.randomUUID(),
      firmwareVersion: handshake.firmwareVersion,
      capabilities: [...handshake.capabilities],
      audioParams: handshake.audioParams,
      status: "online",
      mode: "idle",
      connectedAt: now,
      lastSeenAt: now,
      heartbeatIntervalMs: clampHeartbeatInterval(heartbeatIntervalMs),
      audioFramesReceived: 0,
      sensors: {},
      ws
    };

    this.sessions.set(session.deviceId, session);
    this.logger.info("device registered", {
      type: "device",
      deviceId: session.deviceId,
      sessionId: session.sessionId,
      capabilities: session.capabilities
    });
    return session;
  }

  markOffline(deviceId: string, sessionId?: string): void {
    const session = this.sessions.get(deviceId);
    if (!session) {
      return;
    }
    if (sessionId && session.sessionId !== sessionId) {
      this.logger.debug("ignored stale device close", {
        type: "device",
        deviceId,
        sessionId,
        currentSessionId: session.sessionId
      });
      return;
    }
    session.status = "offline";
    session.lastSeenAt = new Date();
    this.logger.warn("device offline", { type: "device", deviceId, sessionId: session.sessionId });
  }

  recordHeartbeat(deviceId: string): void {
    const session = this.sessions.get(deviceId);
    if (!session) {
      return;
    }
    const now = new Date();
    session.status = "online";
    session.lastSeenAt = now;
    session.lastHeartbeatAt = now;
  }

  recordHeartbeatMessage(message: { deviceId: string; seq?: number }): void {
    const session = this.sessions.get(message.deviceId);
    if (!session) {
      return;
    }
    const now = new Date();
    session.status = "online";
    session.lastSeenAt = now;
    session.lastHeartbeatAt = now;
    this.recordSeq(session, message.seq);
  }

  recordAudioFrame(deviceId: string): void {
    const session = this.sessions.get(deviceId);
    if (!session) {
      return;
    }
    session.audioFramesReceived += 1;
    session.status = "online";
    session.lastSeenAt = new Date();
  }

  recordEvent(message: RobotEventMessage): void {
    const session = this.sessions.get(message.deviceId);
    if (!session) {
      return;
    }
    session.status = "online";
    session.lastSeenAt = new Date();
    session.lastEvent = message;
    this.recordSeq(session, message.seq ?? ("seq" in message.event ? message.event.seq : undefined));
    if (message.event.kind === "state") {
      session.mode = message.event.mode;
    }
    this.recordSensorState(session, message);
    if (message.event.kind === "image") {
      session.lastImageBase64 = message.event.dataBase64;
      session.lastImageAt = new Date(message.timestamp);
    }
    if (message.event.kind !== "cameraFrame") {
      this.logger.debug("device event received", {
        type: "device",
        deviceId: message.deviceId,
        eventId: message.eventId,
        kind: message.event.kind,
        event: message.event
      });
    }
    for (const listener of this.eventListeners) {
      listener(message);
    }
  }

  listSnapshots(): DeviceSnapshot[] {
    this.markTimedOutSessions();
    return [...this.sessions.values()].map((session) => this.snapshot(session));
  }

  getActiveSession(): DeviceSession | undefined {
    this.markTimedOutSessions();
    return [...this.sessions.values()]
      .filter((session) => session.status === "online" && session.ws.readyState === session.ws.OPEN)
      .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())[0];
  }

  reconnectActiveDevice(reason: string): boolean {
    const session = this.getActiveSession();
    if (!session) {
      return false;
    }

    this.logger.warn("requesting device reconnect", {
      type: "device",
      deviceId: session.deviceId,
      reason
    });
    session.ws.close(4001, reason);
    return true;
  }

  sendToActiveDevice(message: RobotCommandMessage): CommandDispatchResult {
    const session = this.getActiveSession();
    if (!session) {
      return {
        sent: false,
        commandId: message.commandId,
        reason: "no online StackChan device"
      };
    }

    session.ws.send(JSON.stringify(message));
    if (message.command.kind === "setMode") {
      session.mode = message.command.mode;
    }
    return {
      sent: true,
      deviceId: session.deviceId,
      commandId: message.commandId
    };
  }

  private snapshot(session: DeviceSession): DeviceSnapshot {
    return {
      deviceId: session.deviceId,
      sessionId: session.sessionId,
      firmwareVersion: session.firmwareVersion,
      capabilities: session.capabilities,
      audioParams: session.audioParams,
      status: session.status,
      mode: session.mode,
      connectedAt: session.connectedAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      heartbeatIntervalMs: session.heartbeatIntervalMs,
      lastHeartbeatAt: session.lastHeartbeatAt?.toISOString(),
      offlineDeadlineAt: offlineDeadlineAt(session).toISOString(),
      lastSeq: session.lastSeq,
      audioFramesReceived: session.audioFramesReceived,
      lastEvent: this.sanitizeEvent(session.lastEvent?.event),
      lastImageAt: session.lastImageAt?.toISOString(),
      sensors: { ...session.sensors }
    };
  }

  private markTimedOutSessions(now = new Date()): void {
    for (const session of this.sessions.values()) {
      if (session.status !== "online") {
        continue;
      }
      if (session.ws.readyState !== session.ws.OPEN || now.getTime() >= offlineDeadlineAt(session).getTime()) {
        session.status = "offline";
        this.logger.warn("device heartbeat timed out", {
          type: "device",
          deviceId: session.deviceId,
          lastSeenAt: session.lastSeenAt.toISOString(),
          heartbeatIntervalMs: session.heartbeatIntervalMs,
          offlineDeadlineAt: offlineDeadlineAt(session).toISOString()
        });
      }
    }
  }

  private sanitizeEvent(event: RobotEventMessage["event"] | undefined): SanitizedRobotEvent | undefined {
    if (!event) {
      return undefined;
    }
    if (event.kind === "image" || event.kind === "cameraFrame") {
      const { dataBase64, ...rest } = event;
      return {
        ...rest,
        dataLength: dataBase64.length
      };
    }
    return event;
  }

  private recordSensorState(session: DeviceSession, message: RobotEventMessage): void {
    const updatedAt = message.timestamp;
    const receivedAt = new Date().toISOString();
    const eventMeta = { eventId: message.eventId, updatedAt, receivedAt };
    switch (message.event.kind) {
      case "battery":
        session.sensors.battery = { ...message.event, ...eventMeta };
        break;
      case "wifi":
        session.sensors.wifi = { ...message.event, ...eventMeta };
        break;
      case "imu":
        session.sensors.imu = { ...message.event, ...eventMeta };
        break;
      case "touch":
        session.sensors.touch = { ...message.event, ...eventMeta };
        break;
      case "wakeWord":
        session.sensors.wakeWord = { ...message.event, ...eventMeta };
        break;
      case "state":
        session.sensors.state = { ...message.event, ...eventMeta };
        break;
      case "sensorSnapshot":
        session.sensors.sensorSnapshot = { ...message.event, ...eventMeta };
        break;
      default:
        break;
    }
  }

  private recordSeq(session: DeviceSession, seq: number | undefined): void {
    if (typeof seq !== "number" || !Number.isFinite(seq)) {
      return;
    }
    session.lastSeq = seq;
  }
}

function clampHeartbeatInterval(value: number): number {
  if (!Number.isFinite(value)) {
    return 15_000;
  }
  return Math.min(60_000, Math.max(1_000, Math.round(value)));
}

function offlineDeadlineAt(session: Pick<DeviceSession, "lastSeenAt" | "heartbeatIntervalMs">): Date {
  const timeoutMs = Math.max(session.heartbeatIntervalMs * 3, 30_000);
  return new Date(session.lastSeenAt.getTime() + timeoutMs);
}
