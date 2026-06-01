import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket, type RawData } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import type { NormalizedFaceBox } from "@stackchan-local/protocol";
import { createLogger, type DesktopConfig } from "../src/config.js";
import { DeviceRegistry } from "../src/device/registry.js";
import { RobotController } from "../src/robot/controller.js";
import type { CameraFrameInput, FaceDetectionResult, FaceDetector } from "../src/vision/detector.js";
import { OneEuroFilter, VisionTrackingService, selectTrackingFace } from "../src/vision/tracking.js";
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

function waitForRobotCommandKind(ws: WebSocket, kind: string, timeoutMs = 1000): Promise<Record<string, unknown> | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve(undefined);
    }, timeoutMs);
    const onMessage = (data: RawData) => {
      const message = JSON.parse(data.toString());
      if (message.type !== "robot.command" || message.command?.kind !== kind) {
        return;
      }
      cleanup();
      resolve(message.command);
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
  height = 240,
  eventPatch: Record<string, unknown> = {}
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
        dataBase64: "abcd",
        ...eventPatch
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

function expectTrackFaceCenter(command: Record<string, unknown>, centerX: number, centerY: number, precision = 2): void {
  expect(command.centerX).toBeCloseTo(centerX, precision);
  expect(command.centerY).toBeCloseTo(centerY, precision);
  expect(command).not.toHaveProperty("yawErrorDeg");
  expect(command).not.toHaveProperty("pitchErrorDeg");
  expect(command).not.toHaveProperty("measurementAgeMs");
}

describe("OneEuroFilter", () => {
  it("suppresses small stationary jitter", () => {
    const filter = new OneEuroFilter({ minCutoff: 1.2, beta: 0.045, dCutoff: 1.0 });
    const inputs = [0.5, 0.506, 0.494, 0.505, 0.495, 0.503, 0.497];
    const outputs = inputs.map((value, index) => filter.filter(value, index * 66));
    const inputSpan = Math.max(...inputs.slice(1)) - Math.min(...inputs.slice(1));
    const outputSpan = Math.max(...outputs.slice(1)) - Math.min(...outputs.slice(1));

    expect(outputSpan).toBeLessThan(inputSpan * 0.7);
  });

  it("responds quickly to large motion and exposes filtered velocity", () => {
    const filter = new OneEuroFilter({ minCutoff: 1.2, beta: 0.045, dCutoff: 1.0 });
    filter.filter(0.5, 0);
    filter.filter(0.5, 66);
    const moved = filter.filter(0.8, 132);

    expect(moved).toBeGreaterThan(0.58);
    expect(filter.velocity()).toBeGreaterThan(0.5);
  });
});

describe("VisionTrackingService", () => {
  let server: StackChanWebSocketServer | undefined;
  let service: VisionTrackingService | undefined;
  const tempDirs: string[] = [];

  afterEach(async () => {
    service?.stop();
    service = undefined;
    await server?.stop();
    server = undefined;
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
    }
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
    expect(cameraStream.fps).toBe(15);
    expect(cameraStream.width).toBe(320);
    expect(cameraStream.height).toBe(240);
    expect(cameraStream.quality).toBe(18);

    sendFrame(ws, "frame-1");
    const trackFace = await nextCommand(ws, "trackFace");
    expect(trackFace.detected).toBe(true);
    expectTrackFaceCenter(trackFace, 0.3, 0.4);
    expect(trackFace.bbox).toMatchObject({ x: 0.1, y: 0.2, width: 0.4, height: 0.4, confidence: 0.9 });
    expect(trackFace.confidence).toBe(0.9);
    expect(trackFace.speed).toBe(420);
    expect(trackFace.control).toEqual({
      mode: "pid",
      deadband: 0.045,
      yaw: { kp: 42, ki: 0, kd: 8 },
      pitch: { kp: 30, ki: 0, kd: 6 },
      integralLimit: 0.35,
      outputLimitDeg: 20
    });
    expect(detector.frames).toHaveLength(1);
    expect(detector.frames[0]).toMatchObject({
      width: 320,
      height: 240
    });
    expect(detector.frames[0].timestampMs).toBeGreaterThan(0);
    ws.close();
  });

  it("writes face coordinates and trackFace commands to the trace log", async () => {
    const logger = createLogger("error");
    const registry = new DeviceRegistry(logger);
    const controller = new RobotController(registry, logger);
    const detector = new FakeFaceDetector([[faceAtCenter(0.3, 0.4, 0.4, 0.4)]]);
    const tempDir = await mkdtemp(path.join(tmpdir(), "stackchan-trace-"));
    tempDirs.push(tempDir);
    const tracePath = path.join(tempDir, "face-tracking.ndjson");
    service = new VisionTrackingService(
      controller,
      registry,
      logger,
      { ...baseConfig, faceTrackingTraceLog: tracePath },
      detector
    );
    server = new StackChanWebSocketServer(baseConfig, registry, logger);
    const port = await server.start();
    service.start();

    const ws = await connectDevice(port);
    service.setEnabled(true);
    await nextCommand(ws, "cameraStream");

    sendFrame(ws, "frame-trace");
    const command = await nextCommand(ws, "trackFace");
    expect(command.detected).toBe(true);
    await delay(20);

    const events = (await readFile(tracePath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, any>);
    const detection = events.find((event) => event.type === "faceDetection");
    const trackCommand = events.find((event) => event.type === "trackCommand");
    const commandResult = events.find((event) => event.type === "trackCommandResult");

    expect(detection).toMatchObject({
      action: "target_ready",
      frameId: "frame-trace",
      faces: [expect.objectContaining({ centerX: 0.3, centerY: 0.4 })],
      trackingTarget: expect.objectContaining({ centerX: 0.3, centerY: 0.4 })
    });
    expect(trackCommand).toMatchObject({
      command: expect.objectContaining({
        kind: "trackFace",
        detected: true,
        centerX: 0.3,
        centerY: 0.4,
        confidence: 0.9
      }),
      target: expect.objectContaining({ centerX: 0.3, centerY: 0.4 })
    });
    expect(commandResult).toMatchObject({
      command: expect.objectContaining({ kind: "trackFace", detected: true }),
      sent: true
    });
    ws.close();
  });

  it("sends OpenCV detector target centers directly", async () => {
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
    expectTrackFaceCenter(first, 0.3, 0.4);

    await delay(130);
    sendFrame(ws, "frame-2");
    const second = await nextCommand(ws, "trackFace");
    expectTrackFaceCenter(second, 0.75, 0.75);
    ws.close();
  });

  it("continues commanding a stable off-center face at the tracking cadence", async () => {
    const logger = createLogger("error");
    const registry = new DeviceRegistry(logger);
    const controller = new RobotController(registry, logger);
    const detector = new FakeFaceDetector([[faceAtCenter(0.7, 0.5)], [faceAtCenter(0.7, 0.5)]]);
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

    await delay(125);
    sendFrame(ws, "frame-2");
    const second = await nextCommand(ws, "trackFace");
    expect(second.detected).toBe(true);
    expectTrackFaceCenter(second, 0.7, 0.5);
    ws.close();
  });

  it("sends OpenCV targets without measurement-age stale gating", async () => {
    const logger = createLogger("error");
    const registry = new DeviceRegistry(logger);
    const controller = new RobotController(registry, logger);
    const detector = new FakeFaceDetector([[faceAtCenter(0.35, 0.5)]]);
    service = new VisionTrackingService(controller, registry, logger, baseConfig, detector);
    server = new StackChanWebSocketServer(baseConfig, registry, logger);
    const port = await server.start();
    service.start();

    const ws = await connectDevice(port);
    service.setEnabled(true);
    await nextCommand(ws, "cameraStream");

    const staleCapture = Date.now() - 1000;
    sendFrame(ws, "frame-stale", new Date(staleCapture).toISOString(), 320, 240, {
      captureTimestamp: new Date(staleCapture).toISOString()
    });
    const command = await nextCommand(ws, "trackFace");
    expectTrackFaceCenter(command, 0.35, 0.5);
    ws.close();
  });

  it("keeps the center protocol independent of captured frame age", async () => {
    const logger = createLogger("error");
    const registry = new DeviceRegistry(logger);
    const controller = new RobotController(registry, logger);
    const detector = new FakeFaceDetector([[faceAtCenter(0.35, 0.5)], [faceAtCenter(0.55, 0.5)]]);
    service = new VisionTrackingService(controller, registry, logger, baseConfig, detector, { commandMaxHz: 20 });
    server = new StackChanWebSocketServer(baseConfig, registry, logger);
    const port = await server.start();
    service.start();

    const ws = await connectDevice(port);
    service.setEnabled(true);
    await nextCommand(ws, "cameraStream");

    const now = Date.now();
    sendFrame(ws, "frame-1", new Date(now - 220).toISOString(), 320, 240, {
      captureTimestamp: new Date(now - 220).toISOString()
    });
    const first = await nextCommand(ws, "trackFace");
    expect(first.detected).toBe(true);

    await delay(130);
    const secondCapture = Date.now() - 500;
    sendFrame(ws, "frame-2", new Date(secondCapture).toISOString(), 320, 240, {
      captureTimestamp: new Date(secondCapture).toISOString()
    });
    const second = await nextCommand(ws, "trackFace");

    expect(second.detected).toBe(true);
    expectTrackFaceCenter(second, 0.55, 0.5);
    ws.close();
  });

  it("sends the current center when tracking is re-enabled", async () => {
    const logger = createLogger("error");
    const registry = new DeviceRegistry(logger);
    const controller = new RobotController(registry, logger);
    const detector = new FakeFaceDetector([[faceAtCenter(0.35, 0.5)], [faceAtCenter(0.75, 0.5)], [faceAtCenter(0.25, 0.5)]]);
    service = new VisionTrackingService(controller, registry, logger, baseConfig, detector, { commandMaxHz: 20 });
    server = new StackChanWebSocketServer(baseConfig, registry, logger);
    const port = await server.start();
    service.start();

    const ws = await connectDevice(port);
    service.setEnabled(true);
    await nextCommand(ws, "cameraStream");

    sendFrame(ws, "frame-1");
    await nextCommand(ws, "trackFace");
    await delay(130);
    sendFrame(ws, "frame-2");
    await nextCommand(ws, "trackFace");

    service.setEnabled(false);
    await nextCommand(ws, "trackFace");
    service.setEnabled(true);
    await delay(130);
    sendFrame(ws, "frame-3");
    const afterReset = await nextCommand(ws, "trackFace");

    expect(afterReset.detected).toBe(true);
    expectTrackFaceCenter(afterReset, 0.25, 0.5, 1);
    ws.close();
  });

  it("sends center, bbox, and confidence in tracking commands", async () => {
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
    expectTrackFaceCenter(trackFace, 0.3, 0.4);
    expect(trackFace.bbox).toMatchObject({ x: 0.1, y: 0.2, width: 0.4, height: 0.4, confidence: 0.9 });
    expect(trackFace.confidence).toBe(0.9);
    expect(trackFace).not.toHaveProperty("landmarks");
    expect(trackFace).not.toHaveProperty("pose");
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

  it("lets raw preview fps override face tracking while the camera module is active", async () => {
    const logger = createLogger("error");
    const registry = new DeviceRegistry(logger);
    const controller = new RobotController(registry, logger);
    const detector = new FakeFaceDetector([]);
    service = new VisionTrackingService(controller, registry, logger, baseConfig, detector);
    server = new StackChanWebSocketServer(baseConfig, registry, logger);
    const port = await server.start();
    service.start();

    const ws = await connectDevice(port);
    service.setEnabled(true);
    const initialCameraStream = await nextRobotCommandMessage(ws, "cameraStream");
    ackCommand(ws, initialCameraStream);

    service.setRawPreview({ enabled: true, fps: 8, quality: 14 });
    const rawPreviewCameraStream = await nextRobotCommandMessage(ws, "cameraStream");
    expect(rawPreviewCameraStream.command).toMatchObject({
      enabled: true,
      fps: 8,
      width: 320,
      height: 240,
      quality: 14
    });
    expect(service.status().sourceCamera).toMatchObject({
      owner: "rawPreview",
      fps: 8,
      quality: 14
    });
    ws.close();
  });

  it("downgrades camera stream under detector backpressure", async () => {
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

    const commandPromise = collectRobotCommands(ws, 1, 2500);
    sendFrame(ws, "frame-slow");
    const commands = await commandPromise;
    const cameraStream = commands.find((command) => command.kind === "cameraStream");
    expect(cameraStream).toMatchObject({
      enabled: true,
      fps: 12,
      quality: 16
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
      creditFrames: 1,
      maxInFlight: 1
    });

    sendFrame(ws, "frame-credit");
    const trackFace = await nextCommand(ws, "trackFace");
    expect(trackFace.detected).toBe(true);

    sendFrame(ws, "frame-credit-2");
    const refillCredit = await nextCommand(ws, "mediaFlowControl");
    expect(refillCredit).toMatchObject({
      stream: "camera",
      creditFrames: 1,
      maxInFlight: 1
    });
    expect(service.status().mediaCredit.enabled).toBe(true);
    expect(service.status().mediaCredit.outstandingFrames).toBe(1);
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
        deadband: 0.08,
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
      deadband: 0.08,
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
    expect(lost.speed).toBe(420);
    ws.close();
  });

  it("reacquires immediately after face loss", async () => {
    const logger = createLogger("error");
    const registry = new DeviceRegistry(logger);
    const controller = new RobotController(registry, logger);
    const detector = new FakeFaceDetector([
      [faceAtCenter(0.4, 0.5)],
      [],
      [faceAtCenter(0.72, 0.5)],
      [faceAtCenter(0.73, 0.5)],
      [faceAtCenter(0.74, 0.5)]
    ]);
    service = new VisionTrackingService(controller, registry, logger, baseConfig, detector, {
      commandMaxHz: 20,
      lostTimeoutMs: 10
    });
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

    await delay(125);
    sendFrame(ws, "frame-3");
    const firstReacquire = await nextCommand(ws, "trackFace");
    expect(firstReacquire.detected).toBe(true);
    expectTrackFaceCenter(firstReacquire, 0.72, 0.5, 1);
    expect(service.previewSnapshot().faces).toHaveLength(1);
    expect(service.previewSnapshot().target).toBeDefined();
    ws.close();
  });

  it("sends a jumped target immediately after a short face drop", async () => {
    const logger = createLogger("error");
    const registry = new DeviceRegistry(logger);
    const controller = new RobotController(registry, logger);
    const detector = new FakeFaceDetector([
      [faceAtCenter(0.49, 0.5)],
      [],
      [faceAtCenter(0.81, 0.5)],
      [faceAtCenter(0.82, 0.5)],
      [faceAtCenter(0.83, 0.5)]
    ]);
    service = new VisionTrackingService(controller, registry, logger, baseConfig, detector, {
      commandMaxHz: 20,
      lostTimeoutMs: 1000
    });
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
    expect(await waitForRobotCommandKind(ws, "trackFace", 160)).toBeUndefined();

    await delay(125);
    sendFrame(ws, "frame-3");
    const jumped = await nextCommand(ws, "trackFace");
    expect(jumped.detected).toBe(true);
    expectTrackFaceCenter(jumped, 0.81, 0.5, 1);
    ws.close();
  });

  it("uses a local OpenCV Haar cascade face detector", async () => {
    const source = await readFile(new URL("../scripts/face_detector.py", import.meta.url), "utf8");
    expect(source).toContain("cv2");
    expect(source).toContain("CascadeClassifier");
    expect(source).toContain("haarcascade_frontalface_default.xml");
    expect(source).toContain("haarcascade_profileface.xml");
    expect(source).toContain("detectMultiScale");
    expect(source).not.toContain("mediapipe");
    expect(source).not.toContain("FaceLandmarker");
  });
});
