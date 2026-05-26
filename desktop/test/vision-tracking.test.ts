import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket, type RawData } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import type { NormalizedFaceBox } from "@stackchan-local/protocol";
import { createLogger, type DesktopConfig } from "../src/config.js";
import { DeviceRegistry } from "../src/device/registry.js";
import { RobotController } from "../src/robot/controller.js";
import type { CameraFrameInput, FaceDetectionResult, FaceDetector } from "../src/vision/detector.js";
import { VisionTrackingService, selectTrackingFace } from "../src/vision/tracking.js";
import { StackChanWebSocketServer } from "../src/ws/server.js";

const baseConfig: DesktopConfig = {
  host: "127.0.0.1",
  port: 0,
  pairingToken: "test-token",
  heartbeatIntervalMs: 1000,
  advertiseMdns: false,
  codexStatusEnabled: false,
  codexSessionsRoot: "/tmp/stackchan-local-test-sessions",
  codexWatchPollMs: 1000,
  codexLatestScanMs: 30_000,
  faceTrackingEnabled: false,
  faceTrackingFps: 4,
  faceTrackingMirrorX: false,
  faceTrackingSpeed: 420,
  faceTrackingDeadband: 0.045,
  faceTrackingYawKp: 42,
  faceTrackingYawKi: 0,
  faceTrackingYawKd: 8,
  faceTrackingPitchKp: 30,
  faceTrackingPitchKi: 0,
  faceTrackingPitchKd: 6,
  faceTrackingIntegralLimit: 0.35,
  faceTrackingOutputLimitDeg: 20,
  faceTrackingPython: "python3",
  faceTrackingDetectorScript: "/tmp/stackchan-local-face-detector.py",
  faceLandmarkerModel: "/tmp/stackchan-local-face-landmarker.task",
  faceTrackingMaxFaces: 1,
  faceTrackingMinDetectionConfidence: 0.18,
  faceTrackingMinPresenceConfidence: 0.18,
  faceTrackingMinTrackingConfidence: 0.18,
  faceTrackingCameraPreset: "fast",
  volcengineTtsEnabled: false,
  volcengineTtsEndpoint: "https://example.test/tts",
  volcengineTtsResourceId: "seed-tts-2.0",
  volcengineTtsVoiceId: "voice",
  volcengineTtsSampleRate: 16000,
  volcengineTtsCompletionText: "done",
  volcengineTtsCompletionVolume: 80,
  volcengineTtsDebounceMs: 0,
  volcengineTtsTimeoutMs: 8000,
  previewEnabled: false,
  previewHost: "127.0.0.1",
  previewPort: 0,
  logLevel: "error"
};

class FakeFaceDetector implements FaceDetector {
  readonly frames: CameraFrameInput[] = [];

  constructor(private readonly results: NormalizedFaceBox[][]) {}

  async detect(frame: CameraFrameInput): Promise<FaceDetectionResult> {
    this.frames.push(frame);
    return {
      frameId: frame.frameId,
      faces: this.results.shift() ?? []
    };
  }

  close(): void {}
}

class SlowFaceDetector implements FaceDetector {
  async detect(frame: CameraFrameInput): Promise<FaceDetectionResult> {
    await delay(120);
    return {
      frameId: frame.frameId,
      faces: []
    };
  }

  close(): void {}
}

async function connectDevice(port: number, capabilities = ["audio", "face", "motion", "camera"]): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/stackchan/local`);
  await once(ws, "open");
  ws.send(
    JSON.stringify({
      type: "handshake",
      deviceId: "stackchan-test",
      firmwareVersion: "local-test",
      pairingToken: "test-token",
      capabilities,
      audioParams: {
        format: "opus",
        sampleRate: 16000,
        channels: 1,
        frameDurationMs: 30
      }
    })
  );
  await once(ws, "message");
  return ws;
}

async function nextCommand(ws: WebSocket, kind: string): Promise<Record<string, unknown>> {
  for (;;) {
    const [data] = (await once(ws, "message")) as [Buffer];
    const message = JSON.parse(data.toString("utf8"));
    if (message.type === "robot.command" && message.command?.kind === kind) {
      return message.command;
    }
  }
}

async function nextRobotCommand(ws: WebSocket): Promise<Record<string, unknown>> {
  for (;;) {
    const [data] = (await once(ws, "message")) as [Buffer];
    const message = JSON.parse(data.toString("utf8"));
    if (message.type === "robot.command" && message.command) {
      return message.command;
    }
  }
}

async function nextRobotCommandMessage(ws: WebSocket, kind?: string): Promise<Record<string, any>> {
  for (;;) {
    const [data] = (await once(ws, "message")) as [Buffer];
    const message = JSON.parse(data.toString("utf8"));
    if (message.type === "robot.command" && message.command && (!kind || message.command.kind === kind)) {
      return message;
    }
  }
}

function ackCommand(ws: WebSocket, commandMessage: Record<string, any>): void {
  ws.send(
    JSON.stringify({
      type: "robot.event",
      eventId: `ack-${commandMessage.commandId}`,
      deviceId: "stackchan-test",
      timestamp: new Date().toISOString(),
      event: {
        kind: "commandAck",
        commandId: commandMessage.commandId,
        commandKind: commandMessage.command.kind,
        status: "accepted"
      }
    })
  );
}

function collectRobotCommands(ws: WebSocket, count: number, timeoutMs = 1000): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const commands: Array<Record<string, unknown>> = [];
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${count} robot commands`));
    }, timeoutMs);
    const onMessage = (data: RawData) => {
      const message = JSON.parse(data.toString());
      if (message.type !== "robot.command" || !message.command) {
        return;
      }
      commands.push(message.command);
      if (commands.length >= count) {
        cleanup();
        resolve(commands);
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      ws.off("message", onMessage);
    };
    ws.on("message", onMessage);
  });
}

function sendFrame(
  ws: WebSocket,
  frameId: string,
  timestamp = new Date().toISOString(),
  width = 320,
  height = 240
): void {
  ws.send(
    JSON.stringify({
      type: "robot.event",
      eventId: `evt-${frameId}`,
      deviceId: "stackchan-test",
      timestamp,
      event: {
        kind: "cameraFrame",
        frameId,
        mimeType: "image/jpeg",
        width,
        height,
        dataBase64: "abcd"
      }
    })
  );
}

function faceAtCenter(centerX: number, centerY: number, width = 0.24, height = 0.32): NormalizedFaceBox {
  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
    confidence: 0.9
  };
}

describe("VisionTrackingService", () => {
  let server: StackChanWebSocketServer | undefined;
  let service: VisionTrackingService | undefined;

  afterEach(async () => {
    service?.stop();
    service = undefined;
    await server?.stop();
    server = undefined;
  });

  it("selects the most useful face by size with a center bias", () => {
    const selected = selectTrackingFace([
      { x: 0.43, y: 0.43, width: 0.08, height: 0.08 },
      { x: 0.1, y: 0.2, width: 0.3, height: 0.3 }
    ]);

    expect(selected).toEqual({ x: 0.1, y: 0.2, width: 0.3, height: 0.3 });
  });

  it("requests camera streaming and sends trackFace for detected faces", async () => {
    const logger = createLogger("error");
    const registry = new DeviceRegistry(logger);
    const controller = new RobotController(registry, logger);
    const detector = new FakeFaceDetector([[{ x: 0.1, y: 0.2, width: 0.4, height: 0.4, confidence: 0.9 }]]);
    service = new VisionTrackingService(controller, registry, logger, baseConfig, detector);
    server = new StackChanWebSocketServer(baseConfig, registry, logger);
    const port = await server.start();
    service.start();

    const ws = await connectDevice(port);
    service.setEnabled(true);

    const cameraStream = await nextCommand(ws, "cameraStream");
    expect(cameraStream.enabled).toBe(true);
    expect(cameraStream.fps).toBe(10);
    expect(cameraStream.width).toBe(320);
    expect(cameraStream.height).toBe(240);
    expect(cameraStream.quality).toBe(18);

    sendFrame(ws, "frame-1");
    const trackFace = await nextCommand(ws, "trackFace");
    expect(trackFace.detected).toBe(true);
    expect(trackFace.centerX).toBeCloseTo(0.3);
    expect(trackFace.centerY).toBeCloseTo(0.4);
    expect(trackFace.speed).toBe(420);
    expect(trackFace.control).toEqual({
      mode: "pid",
      deadband: 0.045,
      yaw: { kp: 42, ki: 0, kd: 8 },
      pitch: { kp: 30, ki: 0, kd: 6 },
      integralLimit: 0.35,
      outputLimitDeg: 20,
      servoRange: {
        yawMin: -1280,
        yawMax: 1280,
        pitchMin: 0,
        pitchMax: 900
      }
    });
    expect(detector.frames).toHaveLength(1);
    expect(detector.frames[0]).toMatchObject({
      width: 320,
      height: 240
    });
    expect(detector.frames[0].timestampMs).toBeGreaterThan(0);
    ws.close();
  });

  it("stabilizes detector target jumps before commanding servos", async () => {
    const logger = createLogger("error");
    const registry = new DeviceRegistry(logger);
    const controller = new RobotController(registry, logger);
    const detector = new FakeFaceDetector([[faceAtCenter(0.3, 0.4)], [faceAtCenter(0.75, 0.75)]]);
    service = new VisionTrackingService(controller, registry, logger, baseConfig, detector, { commandMaxHz: 20 });
    server = new StackChanWebSocketServer(baseConfig, registry, logger);
    const port = await server.start();
    service.start();

    const ws = await connectDevice(port);
    service.setEnabled(true);
    await nextCommand(ws, "cameraStream");

    sendFrame(ws, "frame-1");
    const first = await nextCommand(ws, "trackFace");
    expect(first.detected).toBe(true);
    expect(first.centerX).toBeCloseTo(0.3);
    expect(first.centerY).toBeCloseTo(0.4);

    await delay(130);
    sendFrame(ws, "frame-2");
    const second = await nextCommand(ws, "trackFace");
    const jump = Math.hypot(Number(second.centerX) - Number(first.centerX), Number(second.centerY) - Number(first.centerY));
    expect(jump).toBeLessThanOrEqual(0.055);
    expect(second.centerX).toBeLessThan(0.36);
    expect(second.centerY).toBeLessThan(0.46);
    ws.close();
  });

  it("sends only face position in tracking commands", async () => {
    const logger = createLogger("error");
    const registry = new DeviceRegistry(logger);
    const controller = new RobotController(registry, logger);
    const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 12, 4, -30, 1];
    const detector = new FakeFaceDetector([[{
      x: 0.1,
      y: 0.2,
      width: 0.4,
      height: 0.4,
      confidence: 0.9,
      trackingId: "face-7",
      landmarks: {
        all: [
          { x: 0.31, y: 0.42, z: -0.03 },
          { x: 0.22, y: 0.34, z: 0.01 }
        ],
        nose: { x: 0.31, y: 0.42, z: -0.03 },
        leftEye: { x: 0.22, y: 0.34 },
        rightEye: { x: 0.39, y: 0.34 },
        mouthCenter: { x: 0.31, y: 0.55 }
      },
      pose: {
        yawDeg: -9.5,
        pitchDeg: 3.25,
        rollDeg: 1.5
      },
      transformMatrix: matrix,
      expression: {
        smile: 0.2,
        leftEyeOpen: 0.93,
        rightEyeOpen: 0.88,
        blendshapes: {
          mouthSmileLeft: 0.21,
          mouthSmileRight: 0.18,
          eyeBlinkLeft: 0.07,
          eyeBlinkRight: 0.12
        }
      }
    }]]);
    service = new VisionTrackingService(controller, registry, logger, baseConfig, detector);
    server = new StackChanWebSocketServer(baseConfig, registry, logger);
    const port = await server.start();
    service.start();

    const ws = await connectDevice(port);
    service.setEnabled(true);
    await nextCommand(ws, "cameraStream");

    sendFrame(ws, "frame-1");
    const trackFace = await nextCommand(ws, "trackFace");
    expect(trackFace.bbox).toMatchObject({
      x: 0.1,
      y: 0.2,
      width: 0.4,
      height: 0.4,
      confidence: 0.9,
      trackingId: "face-7"
    });
    expect(trackFace.bbox).not.toHaveProperty("landmarks");
    expect(trackFace.bbox).not.toHaveProperty("pose");
    expect(trackFace.bbox).not.toHaveProperty("transformMatrix");
    expect(trackFace.bbox).not.toHaveProperty("expression");
    expect(service.status()).not.toHaveProperty("lastExpression");
    ws.close();
  });

  it("allows camera preset to be tuned at runtime", async () => {
    const logger = createLogger("error");
    const registry = new DeviceRegistry(logger);
    const controller = new RobotController(registry, logger);
    const detector = new FakeFaceDetector([]);
    service = new VisionTrackingService(controller, registry, logger, baseConfig, detector);
    server = new StackChanWebSocketServer(baseConfig, registry, logger);
    const port = await server.start();
    service.start();

    const ws = await connectDevice(port);
    service.setControl({ cameraPreset: "accurate" });
    service.setEnabled(true);

    const cameraStream = await nextCommand(ws, "cameraStream");
    expect(cameraStream).toMatchObject({
      enabled: true,
      fps: 6,
      width: 320,
      height: 240,
      quality: 28
    });
    expect(service.status().control.camera).toEqual({
      preset: "accurate",
      fps: 6,
      width: 320,
      height: 240,
      quality: 28
    });
    ws.close();
  });

  it("downgrades camera stream and telemetry under detector backpressure", async () => {
    const logger = createLogger("error");
    const registry = new DeviceRegistry(logger);
    const controller = new RobotController(registry, logger);
    service = new VisionTrackingService(controller, registry, logger, baseConfig, new SlowFaceDetector(), {
      adaptivePressureMs: 0,
      adaptiveStableMs: 60_000
    });
    server = new StackChanWebSocketServer(baseConfig, registry, logger);
    const port = await server.start();
    service.start();

    const ws = await connectDevice(port);
    service.setEnabled(true);
    const initialCameraStream = await nextRobotCommandMessage(ws, "cameraStream");
    ackCommand(ws, initialCameraStream);
    await delay(20);

    const commandPromise = collectRobotCommands(ws, 2, 2500);
    sendFrame(ws, "frame-slow");
    const commands = await commandPromise;
    const cameraStream = commands.find((command) => command.kind === "cameraStream");
    const telemetryConfig = commands.find((command) => command.kind === "telemetryConfig");
    expect(cameraStream).toMatchObject({
      enabled: true,
      fps: 8,
      quality: 16
    });
    expect(telemetryConfig).toMatchObject({
      sensorSnapshotHz: 0.5,
      imuHz: 4,
      includeI2cScan: false
    });
    expect(service.status().adaptive.active).toBe(true);
    ws.close();
  });

  it("paces camera frames with media credit when the firmware supports it", async () => {
    const logger = createLogger("error");
    const registry = new DeviceRegistry(logger);
    const controller = new RobotController(registry, logger);
    const detector = new FakeFaceDetector([[{ x: 0.2, y: 0.2, width: 0.2, height: 0.2, confidence: 0.8 }]]);
    service = new VisionTrackingService(controller, registry, logger, baseConfig, detector);
    server = new StackChanWebSocketServer(baseConfig, registry, logger);
    const port = await server.start();
    service.start();

    const ws = await connectDevice(port, ["audio", "face", "motion", "camera", "mediaCredit"]);
    service.setEnabled(true);
    const cameraStream = await nextRobotCommandMessage(ws, "cameraStream");
    ackCommand(ws, cameraStream);

    const initialCredit = await nextCommand(ws, "mediaFlowControl");
    expect(initialCredit).toMatchObject({
      stream: "camera",
      creditFrames: 3,
      maxInFlight: 3
    });

    sendFrame(ws, "frame-credit");
    const trackFace = await nextCommand(ws, "trackFace");
    expect(trackFace.detected).toBe(true);

    sendFrame(ws, "frame-credit-2");
    const refillCredit = await nextCommand(ws, "mediaFlowControl");
    expect(refillCredit).toMatchObject({
      stream: "camera",
      creditFrames: 2,
      maxInFlight: 3
    });
    expect(service.status().mediaCredit.enabled).toBe(true);
    expect(service.status().mediaCredit.outstandingFrames).toBe(3);
    ws.close();
  });

  it("allows tracking control to be tuned at runtime", async () => {
    const logger = createLogger("error");
    const registry = new DeviceRegistry(logger);
    const controller = new RobotController(registry, logger);
    const detector = new FakeFaceDetector([[{ x: 0.1, y: 0.2, width: 0.4, height: 0.4, confidence: 0.9 }]]);
    service = new VisionTrackingService(controller, registry, logger, baseConfig, detector);
    server = new StackChanWebSocketServer(baseConfig, registry, logger);
    const port = await server.start();
    service.start();

    const ws = await connectDevice(port);
    service.setControl({
      speed: 560,
      control: {
        deadband: 0.03,
        yaw: { kp: 52, kd: 12 },
        pitch: { kp: 38, kd: 8 }
      }
    });
    service.setEnabled(true);
    await nextCommand(ws, "cameraStream");

    sendFrame(ws, "frame-1");
    const trackFace = await nextCommand(ws, "trackFace");
    expect(trackFace.speed).toBe(560);
    expect(trackFace.control).toMatchObject({
      deadband: 0.03,
      yaw: { kp: 52, ki: 0, kd: 12 },
      pitch: { kp: 38, ki: 0, kd: 8 }
    });
    ws.close();
  });

  it("sends a lost target command after faces disappear", async () => {
    const logger = createLogger("error");
    const registry = new DeviceRegistry(logger);
    const controller = new RobotController(registry, logger);
    const detector = new FakeFaceDetector([[{ x: 0.2, y: 0.2, width: 0.3, height: 0.3 }], []]);
    service = new VisionTrackingService(controller, registry, logger, baseConfig, detector, { lostTimeoutMs: 10 });
    server = new StackChanWebSocketServer(baseConfig, registry, logger);
    const port = await server.start();
    service.start();

    const ws = await connectDevice(port);
    service.setEnabled(true);
    await nextCommand(ws, "cameraStream");

    sendFrame(ws, "frame-1");
    const found = await nextCommand(ws, "trackFace");
    expect(found.detected).toBe(true);

    await delay(125);
    sendFrame(ws, "frame-2");
    const lost = await nextCommand(ws, "trackFace");
    expect(lost.detected).toBe(false);
    expect(lost.reason).toBe("face_lost");
    ws.close();
  });

  it("uses a local MediaPipe face detector without expression outputs", async () => {
    const source = await readFile(new URL("../scripts/face_detector.py", import.meta.url), "utf8");
    expect(source).toContain("mediapipe");
    expect(source).toContain("FaceLandmarker");
    expect(source).toContain("detect_for_video");
    expect(source).toContain("output_face_blendshapes=False");
    expect(source).toContain("output_facial_transformation_matrixes=False");
    expect(source).not.toContain("solvePnP");
    expect(source).not.toContain("cv2");
    expect(source).not.toContain("mp.solutions");
    expect(source).not.toContain("CascadeClassifier");
    expect(source).not.toContain("haarcascade");
  });
});
