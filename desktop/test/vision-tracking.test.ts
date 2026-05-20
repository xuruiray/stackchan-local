import { once } from "node:events";
import { WebSocket } from "ws";
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

async function connectDevice(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/stackchan/local`);
  await once(ws, "open");
  ws.send(
    JSON.stringify({
      type: "handshake",
      deviceId: "stackchan-test",
      firmwareVersion: "local-test",
      pairingToken: "test-token",
      capabilities: ["audio", "face", "motion", "camera"],
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

function sendFrame(ws: WebSocket, frameId: string): void {
  ws.send(
    JSON.stringify({
      type: "robot.event",
      eventId: `evt-${frameId}`,
      deviceId: "stackchan-test",
      timestamp: new Date().toISOString(),
      event: {
        kind: "cameraFrame",
        frameId,
        mimeType: "image/jpeg",
        width: 320,
        height: 240,
        dataBase64: "abcd"
      }
    })
  );
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
    expect(cameraStream.fps).toBe(4);

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
      outputLimitDeg: 20
    });
    expect(detector.frames).toHaveLength(1);
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

    await new Promise((resolve) => setTimeout(resolve, 15));
    sendFrame(ws, "frame-2");
    const lost = await nextCommand(ws, "trackFace");
    expect(lost.detected).toBe(false);
    expect(lost.reason).toBe("face_lost");
    ws.close();
  });
});
