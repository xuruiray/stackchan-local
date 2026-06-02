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
  faceTrackingSpeed: 300,
  faceTrackingDeadband: 0.08,
  faceTrackingYawKp: 36,
  faceTrackingYawKi: 0,
  faceTrackingYawKd: 1.2,
  faceTrackingYawDirection: 1,
  faceTrackingPitchKp: 8,
  faceTrackingPitchKi: 0,
  faceTrackingPitchKd: 0.15,
  faceTrackingPitchDirection: 1,
  faceTrackingIntegralLimit: 0.35,
  faceTrackingOutputLimitDeg: 4,
  faceTrackingYuNetModel: "/tmp/stackchan-local-yunet.onnx",
  faceTrackingYuNetScoreThreshold: 0.85,
  faceTrackingYuNetNmsThreshold: 0.3,
  faceTrackingYuNetTopK: 500,
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

  it("selects YuNet detections without Haar detector policy gates", () => {
    const centered = { ...faceAtCenter(0.42, 0.5, 0.12, 0.16), detector: "yunet" };
    const larger = { ...faceAtCenter(0.7, 0.5, 0.35, 0.35), detector: "yunet" };

    expect(selectTrackingFace([larger, centered])).toEqual(larger);
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
    expect(trackFace.speed).toBe(300);
    expect(trackFace.control).toEqual({
      mode: "pid",
      deadband: 0.08,
      yaw: { kp: 36, ki: 0, kd: 1.2, direction: 1 },
      pitch: { kp: 8, ki: 0, kd: 0.15, direction: 1 },
      integralLimit: 0.35,
      outputLimitDeg: 4
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
    const detector = new FakeFaceDetector([
      [{ ...faceAtCenter(0.3, 0.4, 0.4, 0.4), detector: "yunet" }],
      [{ ...faceAtCenter(0.55, 0.65, 0.2, 0.24), detector: "yunet" }]
    ]);
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
    const cameraStream = nextCommand(ws, "cameraStream");
    service.setEnabled(true);
    await cameraStream;

    sendFrame(ws, "frame-trace");
    const command = await nextCommand(ws, "trackFace");
    expect(command.detected).toBe(true);
    await delay(125);
    sendFrame(ws, "frame-trace-2");
    const secondCommand = await nextCommand(ws, "trackFace");
    expect(secondCommand.detected).toBe(true);
    await delay(20);

    const events = (await readFile(tracePath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, any>);
    const detection = events.find((event) => event.type === "faceDetection");
    const trackCommands = events.filter((event) => event.type === "trackCommand");
    const trackCommand = trackCommands[0];
    const secondTrackCommand = trackCommands[1];
    const commandResult = events.find((event) => event.type === "trackCommandResult");

    expect(detection).toMatchObject({
      action: "target_ready",
      frameId: "frame-trace",
      faces: [expect.objectContaining({ centerX: 0.3, centerY: 0.4, detector: "yunet" })],
      trackingTarget: expect.objectContaining({ centerX: 0.3, centerY: 0.4 }),
      candidateScores: [expect.objectContaining({ centerX: 0.3, centerY: 0.4, detector: "yunet" })]
    });
    expect(trackCommand).toMatchObject({
      command: expect.objectContaining({
        kind: "trackFace",
        detected: true,
        centerX: 0.3,
        centerY: 0.4,
        confidence: 0.9
      }),
      target: expect.objectContaining({ centerX: 0.3, centerY: 0.4 }),
      diagnostics: expect.objectContaining({
        errorX: expect.any(Number),
        errorY: expect.any(Number),
        distanceFromCenter: expect.any(Number),
        pidEstimate: expect.objectContaining({
          yaw: expect.objectContaining({ clampedOutputDeg: expect.any(Number) }),
          pitch: expect.objectContaining({ clampedOutputDeg: expect.any(Number) })
        })
      })
    });
    expect(secondTrackCommand).toMatchObject({
      diagnostics: expect.objectContaining({
        delta: expect.objectContaining({
          dx: expect.any(Number),
          dy: expect.any(Number),
          distance: expect.any(Number),
          dtMs: expect.any(Number)
        }),
        target: expect.objectContaining({ detector: "yunet" })
      })
    });
    expect(commandResult).toMatchObject({
      command: expect.objectContaining({ kind: "trackFace", detected: true }),
      sent: true
    });
    ws.close();
  });

  it("records firmware face tracking control diagnostics", async () => {
    const logger = createLogger("error");
    const registry = new DeviceRegistry(logger);
    const controller = new RobotController(registry, logger);
    const tempDir = await mkdtemp(path.join(tmpdir(), "stackchan-trace-"));
    tempDirs.push(tempDir);
    const tracePath = path.join(tempDir, "face-tracking.ndjson");
    service = new VisionTrackingService(
      controller,
      registry,
      logger,
      { ...baseConfig, faceTrackingTraceLog: tracePath },
      new FakeFaceDetector([])
    );
    server = new StackChanWebSocketServer(baseConfig, registry, logger);
    const port = await server.start();
    service.start();

    const ws = await connectDevice(port);
    ws.send(
      JSON.stringify({
        type: "robot.event",
        eventId: "evt-face-control",
        deviceId: "stackchan-test",
        timestamp: new Date().toISOString(),
        event: {
          kind: "faceTrackingControl",
          action: "applied",
          uptimeMs: 1234,
          targetAgeMs: 18,
          centerX: 0.7,
          centerY: 0.4,
          errorX: 0.2,
          errorY: 0.1,
          currentYaw: 10,
          currentPitch: 260,
          nextYaw: 30,
          nextPitch: 250,
          yawDelta: 20,
          pitchDelta: -10,
          yawOutputDeg: 2,
          pitchOutputDeg: -1,
          yawDirection: 1,
          pitchDirection: -1,
          speed: 420
        }
      })
    );
    await delay(20);

    expect(service.status().faceTrackingControl).toMatchObject({
      action: "applied",
      currentYaw: 10,
      nextYaw: 30,
      yawDelta: 20
    });
    const events = (await readFile(tracePath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, any>);
    expect(events.find((event) => event.type === "faceTrackingControl")).toMatchObject({
      event: expect.objectContaining({ action: "applied", yawDelta: 20 })
    });
    ws.close();
  });

  it("sends OpenCV detector target centers directly", async () => {
    const logger = createLogger("error");
    const registry = new DeviceRegistry(logger);
    const controller = new RobotController(registry, logger);
    const detector = new FakeFaceDetector([[faceAtCenter(0.3, 0.4)], [faceAtCenter(0.38, 0.46)]]);
    service = new VisionTrackingService(controller, registry, logger, baseConfig, detector);
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
    expectTrackFaceCenter(second, 0.38, 0.46);
    ws.close();
  });

  it("continues commanding a stable off-center face at the tracking cadence", async () => {
    const logger = createLogger("error");
    const registry = new DeviceRegistry(logger);
    const controller = new RobotController(registry, logger);
    const detector = new FakeFaceDetector([[faceAtCenter(0.7, 0.5)], [faceAtCenter(0.7, 0.5)]]);
    service = new VisionTrackingService(controller, registry, logger, baseConfig, detector);
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
    service = new VisionTrackingService(controller, registry, logger, baseConfig, detector);
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
    const detector = new FakeFaceDetector([[faceAtCenter(0.35, 0.5)], [faceAtCenter(0.39, 0.5)], [faceAtCenter(0.25, 0.5)]]);
    service = new VisionTrackingService(controller, registry, logger, baseConfig, detector);
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

  it("uses quality 18 for raw preview when no quality override is provided", async () => {
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

    service.setRawPreview({ enabled: true, fps: 8 });
    const rawPreviewCameraStream = await nextRobotCommandMessage(ws, "cameraStream");
    expect(rawPreviewCameraStream.command).toMatchObject({
      enabled: true,
      fps: 8,
      width: 320,
      height: 240,
      quality: 18
    });
    expect(service.status().sourceCamera).toMatchObject({
      owner: "rawPreview",
      fps: 8,
      quality: 18
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
      creditFrames: 2,
      maxInFlight: 2
    });

    sendFrame(ws, "frame-credit");
    const trackFace = await nextCommand(ws, "trackFace");
    expect(trackFace.detected).toBe(true);

    sendFrame(ws, "frame-credit-2");
    const refillCredit = await nextCommand(ws, "mediaFlowControl");
    expect(refillCredit).toMatchObject({
      stream: "camera",
      creditFrames: 1,
      maxInFlight: 2
    });
    expect(service.status().mediaCredit.enabled).toBe(true);
    expect(service.status().mediaCredit.outstandingFrames).toBe(2);
    ws.close();
  });

  it("uses a wider media credit window for raw preview", async () => {
    const logger = createLogger("error");
    const registry = new DeviceRegistry(logger);
    const controller = new RobotController(registry, logger);
    service = new VisionTrackingService(controller, registry, logger, baseConfig, new FakeFaceDetector([]));
    server = new StackChanWebSocketServer(baseConfig, registry, logger);
    const port = await server.start();
    service.start();

    const ws = await connectDevice(port, ["audio", "face", "motion", "camera", "mediaCredit"]);
    service.setRawPreview({ enabled: true, fps: 15, quality: 18 });
    const cameraStream = await nextRobotCommandMessage(ws, "cameraStream");
    ackCommand(ws, cameraStream);

    const initialCredit = await nextCommand(ws, "mediaFlowControl");
    expect(initialCredit).toMatchObject({
      stream: "camera",
      creditFrames: 4,
      maxInFlight: 4
    });
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
        yaw: { kp: 52, kd: 12, direction: -1 },
        pitch: { kp: 38, kd: 8, direction: -1 }
      }
    });
    service.setEnabled(true);
    await nextCommand(ws, "cameraStream");

    sendFrame(ws, "frame-1");
    const trackFace = await nextCommand(ws, "trackFace");
    expect(trackFace.speed).toBe(560);
    expect(trackFace.control).toMatchObject({
      deadband: 0.08,
      yaw: { kp: 52, ki: 0, kd: 12, direction: -1 },
      pitch: { kp: 38, ki: 0, kd: 8, direction: -1 }
    });
    ws.close();
  });

  it("does not send a desktop lost target command after faces disappear", async () => {
    const logger = createLogger("error");
    const registry = new DeviceRegistry(logger);
    const controller = new RobotController(registry, logger);
    const detector = new FakeFaceDetector([[{ x: 0.2, y: 0.2, width: 0.3, height: 0.3 }], []]);
    service = new VisionTrackingService(controller, registry, logger, baseConfig, detector);
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
    ws.close();
  });

  it("sends detected commands for each detector result without a desktop command throttle", async () => {
    const logger = createLogger("error");
    const registry = new DeviceRegistry(logger);
    const controller = new RobotController(registry, logger);
    const detector = new FakeFaceDetector([[faceAtCenter(0.4, 0.5)], [faceAtCenter(0.45, 0.5)]]);
    service = new VisionTrackingService(controller, registry, logger, baseConfig, detector);
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
    expectTrackFaceCenter(second, 0.45, 0.5, 1);
    ws.close();
  });

  it("sends a new detected target immediately after a face gap", async () => {
    const logger = createLogger("error");
    const registry = new DeviceRegistry(logger);
    const controller = new RobotController(registry, logger);
    const detector = new FakeFaceDetector([
      [faceAtCenter(0.4, 0.5)],
      [],
      [faceAtCenter(0.45, 0.5)],
      [faceAtCenter(0.46, 0.5)]
    ]);
    service = new VisionTrackingService(controller, registry, logger, baseConfig, detector);
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
    const firstReacquire = await nextCommand(ws, "trackFace");
    expect(firstReacquire.detected).toBe(true);
    expectTrackFaceCenter(firstReacquire, 0.45, 0.5, 1);
    expect(service.previewSnapshot().faces).toHaveLength(1);
    expect(service.previewSnapshot().target).toBeDefined();
    ws.close();
  });

  it("sends small and far OpenCV targets directly without desktop target gating", async () => {
    const logger = createLogger("error");
    const registry = new DeviceRegistry(logger);
    const controller = new RobotController(registry, logger);
    const detector = new FakeFaceDetector([
      [faceAtCenter(0.49, 0.5)],
      [],
      [faceAtCenter(0.83, 0.6, 0.1, 0.14)],
      [faceAtCenter(0.35, 0.34, 0.3, 0.4)],
      [faceAtCenter(0.36, 0.35, 0.3, 0.4)]
    ]);
    service = new VisionTrackingService(controller, registry, logger, baseConfig, detector);
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
    const smallFalsePositive = await nextCommand(ws, "trackFace");
    expect(smallFalsePositive.detected).toBe(true);
    expectTrackFaceCenter(smallFalsePositive, 0.83, 0.6, 1);
    expect(service.previewSnapshot().target).toBeDefined();

    await delay(125);
    sendFrame(ws, "frame-4");
    const farReacquire = await nextCommand(ws, "trackFace");
    expect(farReacquire.detected).toBe(true);
    expectTrackFaceCenter(farReacquire, 0.35, 0.34, 1);

    await delay(125);
    sendFrame(ws, "frame-5");
    const nextFarTarget = await nextCommand(ws, "trackFace");
    expect(nextFarTarget.detected).toBe(true);
    expectTrackFaceCenter(nextFarTarget, 0.36, 0.35, 1);
    ws.close();
  });

  it("uses a local OpenCV YuNet face detector without Haar cascade fallback", async () => {
    const source = await readFile(new URL("../scripts/face_detector.py", import.meta.url), "utf8");
    expect(source).toContain("cv2");
    expect(source).toContain("FaceDetectorYN_create");
    expect(source).toContain("face_detection_yunet_2023mar.onnx");
    expect(source).toContain("score_threshold");
    expect(source).not.toContain("CascadeClassifier");
    expect(source).not.toContain("haarcascade_");
    expect(source).not.toContain("detectMultiScale");
    expect(source).not.toContain("mediapipe");
    expect(source).not.toContain("FaceLandmarker");
  });
});
