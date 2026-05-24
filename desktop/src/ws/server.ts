import { Bonjour, type Service } from "bonjour-service";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import {
  createProtocolValidator,
  type DaemonHelloMessage,
  type ErrorMessage,
  type HandshakeMessage,
  type LocalProtocolMessage,
  type ProtocolValidator,
  type RobotEventMessage
} from "@stackchan-local/protocol";

import type { DesktopConfig, Logger } from "../config.js";
import type { DeviceRegistry, DeviceSession } from "../device/registry.js";
import { parseStackChanBinaryFrame } from "./binary-frame.js";

const LOCAL_WS_PATH = "/stackchan/local";
const SHUTDOWN_CLOSE_TIMEOUT_MS = 500;
const SHUTDOWN_FORCE_TIMEOUT_MS = 2000;

export class StackChanWebSocketServer {
  private readonly validator: ProtocolValidator = createProtocolValidator();
  private server?: WebSocketServer;
  private bonjour?: Bonjour;
  private mdnsService?: Service;

  constructor(
    private readonly config: DesktopConfig,
    private readonly registry: DeviceRegistry,
    private readonly logger: Logger
  ) {}

  async start(): Promise<number> {
    this.server = new WebSocketServer({
      host: this.config.host,
      port: this.config.port,
      path: LOCAL_WS_PATH
    });

    this.server.on("connection", (socket) => this.handleConnection(socket));
    this.server.on("error", (error) => {
      this.logger.error("websocket server error", { type: "device", error: error.message });
    });

    await new Promise<void>((resolve) => this.server?.once("listening", resolve));
    const port = this.port();

    if (this.config.advertiseMdns) {
      this.bonjour = new Bonjour();
      this.mdnsService = this.bonjour.publish({
        name: "StackChan Local",
        type: "stackchan-local",
        protocol: "tcp",
        port
      });
    }

    this.logger.info("stackchan websocket server listening", {
      host: this.config.host,
      port,
      path: LOCAL_WS_PATH,
      mdns: this.config.advertiseMdns
    });
    return port;
  }

  async stop(): Promise<void> {
    if (this.mdnsService) {
      this.mdnsService.stop?.();
    }
    this.mdnsService = undefined;
    this.bonjour?.destroy();
    this.bonjour = undefined;

    const server = this.server;
    this.server = undefined;
    if (!server) {
      return;
    }

    for (const client of server.clients) {
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
        client.close(1001, "daemon stopping");
      }
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(closeTimer);
        clearTimeout(forceTimer);
        if (error) {
          reject(error);
          return;
        }
        resolve();
      };

      const closeTimer = setTimeout(() => {
        for (const client of server.clients) {
          if (client.readyState !== WebSocket.CLOSED) {
            client.terminate();
          }
        }
      }, SHUTDOWN_CLOSE_TIMEOUT_MS);

      const forceTimer = setTimeout(() => finish(), SHUTDOWN_FORCE_TIMEOUT_MS);

      server.close((error) => finish(error));
    });
  }

  port(): number {
    const address = this.server?.address();
    if (!address || typeof address === "string") {
      return this.config.port;
    }
    return address.port;
  }

  private handleConnection(socket: WebSocket): void {
    let session: DeviceSession | undefined;

    socket.once("message", (data, isBinary) => {
      if (isBinary) {
        this.sendError(socket, "expected_handshake", "first message must be a JSON handshake", false);
        socket.close(1002, "expected JSON handshake");
        return;
      }

      const parsed = this.parseJson(data);
      if (!parsed || !this.validator.isHandshake(parsed)) {
        this.sendError(socket, "invalid_handshake", "first message must match the StackChan Local handshake schema", false);
        socket.close(1002, "invalid handshake");
        return;
      }

      if (parsed.pairingToken !== this.config.pairingToken) {
        this.sendError(socket, "pairing_failed", "pairing token rejected", true);
        socket.close(1008, "pairing token rejected");
        return;
      }

      session = this.registry.register(parsed, socket, this.config.heartbeatIntervalMs);
      this.sendDaemonHello(socket, parsed, session);
      socket.on("message", (nextData, nextIsBinary) => {
        if (!session) {
          return;
        }
        this.handleSessionMessage(session, nextData, nextIsBinary);
      });
    });

    socket.on("close", () => {
      if (session) {
        this.registry.markOffline(session.deviceId);
      }
    });

    socket.on("error", (error) => {
      this.logger.warn("device websocket error", { type: "device", error: error.message, deviceId: session?.deviceId });
    });
  }

  private handleSessionMessage(session: DeviceSession, data: RawData, isBinary: boolean): void {
    if (isBinary) {
      let parsedBinary: ReturnType<typeof parseStackChanBinaryFrame>;
      try {
        parsedBinary = parseStackChanBinaryFrame(data);
      } catch (error) {
        this.sendError(
          session.ws,
          "invalid_binary_frame",
          error instanceof Error ? error.message : "invalid StackChan binary frame",
          true
        );
        return;
      }
      if (!parsedBinary || parsedBinary.kind === "unknown") {
        this.registry.recordAudioFrame(session.deviceId);
        return;
      }
      if (parsedBinary.header.deviceId !== session.deviceId) {
        this.sendError(session.ws, "device_id_mismatch", "binary camera frame deviceId does not match this session", true);
        return;
      }
      const daemonReceivedAt = new Date().toISOString();
      const message: RobotEventMessage = {
        type: "robot.event",
        seq: parsedBinary.header.seq,
        eventId: `${session.deviceId.replace(/[^a-zA-Z0-9_-]/g, "")}-binary-frame-${parsedBinary.header.frameId}`,
        deviceId: session.deviceId,
        timestamp: parsedBinary.header.timestamp,
        event: {
          kind: "cameraFrame",
          frameId: parsedBinary.header.frameId,
          mimeType: parsedBinary.header.mimeType,
          width: parsedBinary.header.width,
          height: parsedBinary.header.height,
          dataBase64: parsedBinary.payload.toString("base64"),
          seq: parsedBinary.header.seq,
          captureTimestamp: parsedBinary.header.captureTimestamp,
          sentAt: parsedBinary.header.sentAt,
          trace: {
            deviceCapturedAt: parsedBinary.header.captureTimestamp,
            deviceSentAt: parsedBinary.header.sentAt,
            daemonReceivedAt
          }
        }
      };
      try {
        this.validator.parseMessage(message);
      } catch (error) {
        this.sendError(session.ws, "invalid_binary_frame", error instanceof Error ? error.message : "invalid camera frame", true);
        return;
      }
      this.registry.recordEvent(message);
      this.handleRobotEvent(session, message);
      return;
    }

    const parsed = this.parseJson(data);
    if (!parsed) {
      this.sendError(session.ws, "invalid_json", "message is not valid JSON", true);
      return;
    }

    let message: LocalProtocolMessage;
    try {
      message = this.validator.parseMessage(parsed);
    } catch (error) {
      this.sendError(session.ws, "invalid_message", error instanceof Error ? error.message : "invalid protocol message", true);
      return;
    }

    if (message.type === "heartbeat") {
      if (message.deviceId !== session.deviceId) {
        this.sendError(session.ws, "device_id_mismatch", "heartbeat deviceId does not match this session", true);
        return;
      }
      this.registry.recordHeartbeatMessage(message);
      return;
    }

    if (message.type === "robot.event") {
      if (message.deviceId !== session.deviceId) {
        this.sendError(session.ws, "device_id_mismatch", "event deviceId does not match this session", true);
        return;
      }
      this.registry.recordEvent(message);
      this.handleRobotEvent(session, message);
      return;
    }

    if (message.type === "error") {
      this.logger.warn("device reported error", {
        type: "device",
        deviceId: session.deviceId,
        code: message.code,
        message: message.message
      });
    }
  }

  private handleRobotEvent(session: DeviceSession, message: RobotEventMessage): void {
    if (message.event.kind !== "wakeWord") {
      return;
    }

    this.logger.info("mock voice pipeline triggered", {
      type: "device",
      deviceId: session.deviceId,
      wakeWord: message.event.text
    });
    session.ws.send(
      JSON.stringify({
        type: "robot.command",
        commandId: crypto.randomUUID(),
        command: {
          kind: "say",
          text: "我在，本地 daemon 已连接。",
          interrupt: true
        }
      })
    );
  }

  private sendDaemonHello(socket: WebSocket, handshake: HandshakeMessage, session: DeviceSession): void {
    const hello: DaemonHelloMessage = {
      type: "daemon.hello",
      protocolVersion: "1.2",
      sessionId: session.sessionId,
      heartbeatIntervalMs: this.config.heartbeatIntervalMs,
      featureFlags: [
        "mcp",
        "mockVoice",
        "cameraSnapshot",
        "cameraStream",
        "faceTracking",
        "audioPlayback",
        "rgbControl",
        "sensorTelemetry",
        "robotCommand",
        "binaryCameraFrame",
        "adaptiveCameraStream",
        "telemetryConfig",
        "commandStatus",
        "mediaCredit",
        "qosProfiles"
      ],
      featureParams: {
        binaryCameraFrame: {
          envelope: "SCL1",
          cameraKind: 1
        },
        mediaCredit: {
          defaultCreditFrames: 2,
          maxCreditFrames: 12
        }
      },
      qosProfiles: {
        robotCommand: "reliable",
        cameraFrame: "latestOnly",
        telemetry: "bestEffort",
        audio: "reliableChunked"
      },
      audioParams: handshake.audioParams
    };
    this.validator.assertOutgoing(hello);
    socket.send(JSON.stringify(hello));
  }

  private sendError(socket: WebSocket, code: string, message: string, recoverable: boolean): void {
    const errorMessage: ErrorMessage = {
      type: "error",
      code,
      message,
      recoverable
    };
    this.validator.assertOutgoing(errorMessage);
    socket.send(JSON.stringify(errorMessage));
  }

  private parseJson(data: RawData): unknown | undefined {
    try {
      return JSON.parse(data.toString("utf8"));
    } catch {
      return undefined;
    }
  }
}
