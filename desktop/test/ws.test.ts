import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { createLogger, type DesktopConfig } from "../src/config.js";
import { DeviceRegistry } from "../src/device/registry.js";
import { RobotController } from "../src/robot/controller.js";
import { encodeStackChanBinaryCameraFrame } from "../src/ws/binary-frame.js";
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
  faceTrackingMinDetectionConfidence: 0.35,
  faceTrackingMinPresenceConfidence: 0.35,
  faceTrackingMinTrackingConfidence: 0.35,
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

describe("StackChanWebSocketServer", () => {
  let server: StackChanWebSocketServer | undefined;

  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  it("accepts a valid handshake and sends daemon hello", async () => {
    const registry = new DeviceRegistry(createLogger("error"));
    server = new StackChanWebSocketServer(baseConfig, registry, createLogger("error"));
    const port = await server.start();

    const ws = new WebSocket(`ws://127.0.0.1:${port}/stackchan/local`);
    await once(ws, "open");
    ws.send(
      JSON.stringify({
        type: "handshake",
        deviceId: "stackchan-test",
        firmwareVersion: "local-test",
        pairingToken: "test-token",
        capabilities: ["audio", "face", "motion"],
        audioParams: {
          format: "opus",
          sampleRate: 16000,
          channels: 1,
          frameDurationMs: 30
        }
      })
    );

    const [data] = (await once(ws, "message")) as [Buffer];
    const message = JSON.parse(data.toString("utf8"));

    expect(message.type).toBe("daemon.hello");
    expect(message.protocolVersion).toBe("1.2");
    expect(message.featureFlags).toContain("binaryCameraFrame");
    expect(message.featureFlags).toContain("telemetryConfig");
    expect(message.featureFlags).toContain("mediaCredit");
    expect(message.qosProfiles).toMatchObject({
      robotCommand: "reliable",
      cameraFrame: "latestOnly",
      telemetry: "bestEffort",
      audio: "reliableChunked"
    });
    expect(message.heartbeatIntervalMs).toBe(1000);
    expect(registry.listSnapshots()).toHaveLength(1);
    ws.close();
  });

  it("keeps the replacement session online when the stale socket closes", async () => {
    const registry = new DeviceRegistry(createLogger("error"));
    server = new StackChanWebSocketServer(baseConfig, registry, createLogger("error"));
    const port = await server.start();

    const handshake = {
      type: "handshake",
      deviceId: "stackchan-test",
      firmwareVersion: "local-test",
      pairingToken: "test-token",
      capabilities: ["audio", "face", "motion"],
      audioParams: {
        format: "opus",
        sampleRate: 16000,
        channels: 1,
        frameDurationMs: 30
      }
    };

    const staleWs = new WebSocket(`ws://127.0.0.1:${port}/stackchan/local`);
    await once(staleWs, "open");
    staleWs.send(JSON.stringify(handshake));
    await once(staleWs, "message");

    const replacementWs = new WebSocket(`ws://127.0.0.1:${port}/stackchan/local`);
    await once(replacementWs, "open");
    replacementWs.send(JSON.stringify(handshake));
    await once(replacementWs, "message");
    await Promise.race([once(staleWs, "close"), delay(1000)]);
    await delay(30);

    const [snapshot] = registry.listSnapshots();
    expect(snapshot.status).toBe("online");
    expect(registry.getActiveSession()?.sessionId).toBe(snapshot.sessionId);
    replacementWs.close();
  });

  it("normalizes negotiated binary camera frames into cameraFrame events", async () => {
    const registry = new DeviceRegistry(createLogger("error"));
    server = new StackChanWebSocketServer(baseConfig, registry, createLogger("error"));
    const port = await server.start();

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

    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const timestamp = new Date().toISOString();
    ws.send(
      encodeStackChanBinaryCameraFrame(
        {
          frameId: "frame-bin-1",
          deviceId: "stackchan-test",
          timestamp,
          mimeType: "image/jpeg",
          width: 320,
          height: 240,
          byteLength: jpeg.byteLength,
          transport: "binary",
          seq: 12,
          captureTimestamp: timestamp,
          sentAt: timestamp,
          deviceEncodedAt: timestamp,
          deviceQueuedAt: timestamp,
          deviceTxStartAt: timestamp
        },
        jpeg
      )
    );

    await new Promise((resolve) => setTimeout(resolve, 30));
    const [snapshot] = registry.listSnapshots();
    expect(snapshot.lastEvent).toMatchObject({
      kind: "cameraFrame",
      frameId: "frame-bin-1",
      mimeType: "image/jpeg",
      width: 320,
      height: 240,
      seq: 12,
      trace: {
        deviceCapturedAt: timestamp,
        deviceEncodedAt: timestamp,
        deviceQueuedAt: timestamp,
        deviceSentAt: timestamp,
        deviceTxStartAt: timestamp
      }
    });
    expect(snapshot.lastEvent && "dataLength" in snapshot.lastEvent ? snapshot.lastEvent.dataLength : undefined).toBe(
      jpeg.toString("base64").length
    );
    expect(snapshot.audioFramesReceived).toBe(0);
    ws.close();
  });

  it("keeps unknown binary frames on the legacy audio counter", async () => {
    const registry = new DeviceRegistry(createLogger("error"));
    server = new StackChanWebSocketServer(baseConfig, registry, createLogger("error"));
    const port = await server.start();

    const ws = new WebSocket(`ws://127.0.0.1:${port}/stackchan/local`);
    await once(ws, "open");
    ws.send(
      JSON.stringify({
        type: "handshake",
        deviceId: "stackchan-test",
        firmwareVersion: "local-test",
        pairingToken: "test-token",
        capabilities: ["audio", "face", "motion"],
        audioParams: {
          format: "opus",
          sampleRate: 16000,
          channels: 1,
          frameDurationMs: 30
        }
      })
    );
    await once(ws, "message");

    ws.send(Buffer.from([1, 2, 3, 4, 5, 6]));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(registry.listSnapshots()[0]?.audioFramesReceived).toBe(1);
    ws.close();
  });

  it("marks a device offline after the session heartbeat deadline", () => {
    const registry = new DeviceRegistry(createLogger("error"));
    const fakeSocket = {
      readyState: WebSocket.OPEN,
      OPEN: WebSocket.OPEN,
      close: () => {}
    } as unknown as WebSocket;
    const session = registry.register(
      {
        type: "handshake",
        deviceId: "stackchan-timeout",
        firmwareVersion: "local-test",
        pairingToken: "test-token",
        capabilities: ["audio"],
        audioParams: {
          format: "opus",
          sampleRate: 16000,
          channels: 1,
          frameDurationMs: 30
        }
      },
      fakeSocket,
      1000
    );
    session.lastSeenAt = new Date(Date.now() - 31_000);

    const [snapshot] = registry.listSnapshots();
    expect(snapshot.status).toBe("offline");
    expect(snapshot.heartbeatIntervalMs).toBe(1000);
    expect(snapshot.offlineDeadlineAt).toBeDefined();
  });

  it("stops promptly while a device websocket is still connected", async () => {
    const registry = new DeviceRegistry(createLogger("error"));
    server = new StackChanWebSocketServer(baseConfig, registry, createLogger("error"));
    const port = await server.start();

    const ws = new WebSocket(`ws://127.0.0.1:${port}/stackchan/local`);
    await once(ws, "open");
    ws.send(
      JSON.stringify({
        type: "handshake",
        deviceId: "stackchan-test",
        firmwareVersion: "local-test",
        pairingToken: "test-token",
        capabilities: ["audio", "face", "motion"],
        audioParams: {
          format: "opus",
          sampleRate: 16000,
          channels: 1,
          frameDurationMs: 30
        }
      })
    );
    await once(ws, "message");

    const stopResult = await Promise.race([server.stop().then(() => "stopped"), delay(2500).then(() => "timeout")]);
    server = undefined;

    expect(stopResult).toBe("stopped");
    await Promise.race([once(ws, "close"), delay(1000)]);
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });

  it("keeps the latest realtime sensor state in device snapshots", async () => {
    const registry = new DeviceRegistry(createLogger("error"));
    server = new StackChanWebSocketServer(baseConfig, registry, createLogger("error"));
    const port = await server.start();

    const ws = new WebSocket(`ws://127.0.0.1:${port}/stackchan/local`);
    await once(ws, "open");
    ws.send(
      JSON.stringify({
        type: "handshake",
        deviceId: "stackchan-test",
        firmwareVersion: "local-test",
        pairingToken: "test-token",
        capabilities: ["audio", "face", "motion", "battery", "wifi", "imu", "touch", "servos", "rtc", "mic"],
        audioParams: {
          format: "opus",
          sampleRate: 16000,
          channels: 1,
          frameDurationMs: 30
        }
      })
    );
    await once(ws, "message");

    const timestamp = new Date().toISOString();
    for (const event of [
      { kind: "battery", level: 64, charging: false },
      { kind: "wifi", status: "connected", rssi: -52, ssid: "desk" },
      { kind: "imu", motion: "none", x: 0.1, y: -0.2, z: 9.7 },
      { kind: "touch", gesture: "press", surface: "screen", pressed: true, x: 120, y: 88, points: 1 },
      {
        kind: "sensorSnapshot",
        uptimeMs: 99_000,
        power: {
          batteryLevel: 64,
          charging: false,
          backlight: 70,
          speakerVolume: 80,
          servoPower: true
        },
        motion: {
          servos: {
            available: true,
            yaw: { angle: 3.4, moving: false, torque: true },
            pitch: { angle: 28.1, moving: true, torque: true },
            power: true
          }
        },
        peripherals: {
          ioExpander: { available: true },
          nfc: { available: false, driver: "st25r3916-probe", address: 0x50, reason: "not_detected_i2c_0x50" },
          powerMonitor: { available: true, driver: "ina226", address: 0x41, busVoltage: 3.9, current: 0.11, power: 0.43 },
          i2cScan: [
            {
              stage: "after_py32_vm_en",
              uptimeMs: 1800,
              addresses: [0x21, 0x34, 0x38, 0x40, 0x51, 0x58, 0x68, 0x69, 0x6f],
              targets: { ltr553: false, ina226: false, nfc: false }
            }
          ],
          ir: { available: true, driver: "gpio-ir-basic", txPin: 5, rxPin: 10 },
          mic: { available: true, channels: 2, mode: "mono_opus", localization: "abandoned", level: 0.4, dbfs: -22, driver: "es7210-level-meter" }
        }
      }
    ]) {
      ws.send(
        JSON.stringify({
          type: "robot.event",
          eventId: `evt-${event.kind}`,
          deviceId: "stackchan-test",
          timestamp,
          event
        })
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 30));
    const [snapshot] = registry.listSnapshots();
    expect(snapshot.sensors.battery?.level).toBe(64);
    expect(snapshot.sensors.wifi?.rssi).toBe(-52);
    expect(snapshot.sensors.imu?.z).toBe(9.7);
    expect(snapshot.sensors.touch?.surface).toBe("screen");
    expect(snapshot.sensors.sensorSnapshot?.power?.speakerVolume).toBe(80);
    expect(snapshot.sensors.sensorSnapshot?.peripherals?.ioExpander?.available).toBe(true);
    expect(snapshot.sensors.sensorSnapshot?.motion?.servos?.yaw?.angle).toBe(3.4);
    expect(snapshot.sensors.sensorSnapshot?.peripherals?.nfc?.reason).toBe("not_detected_i2c_0x50");
    expect(snapshot.sensors.sensorSnapshot?.peripherals?.powerMonitor?.busVoltage).toBe(3.9);
    expect(snapshot.sensors.sensorSnapshot?.peripherals?.i2cScan?.[0]?.stage).toBe("after_py32_vm_en");
    expect(snapshot.sensors.sensorSnapshot?.peripherals?.mic?.level).toBe(0.4);
    ws.close();
  });

  it("rejects an invalid pairing token", async () => {
    const registry = new DeviceRegistry(createLogger("error"));
    server = new StackChanWebSocketServer(baseConfig, registry, createLogger("error"));
    const port = await server.start();

    const ws = new WebSocket(`ws://127.0.0.1:${port}/stackchan/local`);
    await once(ws, "open");
    ws.send(
      JSON.stringify({
        type: "handshake",
        deviceId: "stackchan-test",
        firmwareVersion: "local-test",
        pairingToken: "wrong-token",
        capabilities: ["audio"],
        audioParams: {
          format: "opus",
          sampleRate: 16000,
          channels: 1,
          frameDurationMs: 30
        }
      })
    );

    const [data] = (await once(ws, "message")) as [Buffer];
    const message = JSON.parse(data.toString("utf8"));

    expect(message.type).toBe("error");
    expect(message.code).toBe("pairing_failed");
    expect(registry.listSnapshots()).toHaveLength(0);
    ws.close();
  });

  it("resolves robot commands only after device commandAck", async () => {
    const registry = new DeviceRegistry(createLogger("error"));
    const controller = new RobotController(registry, createLogger("error"));
    server = new StackChanWebSocketServer(baseConfig, registry, createLogger("error"));
    const port = await server.start();

    const ws = new WebSocket(`ws://127.0.0.1:${port}/stackchan/local`);
    await once(ws, "open");
    ws.send(
      JSON.stringify({
        type: "handshake",
        deviceId: "stackchan-test",
        firmwareVersion: "local-test",
        pairingToken: "test-token",
        capabilities: ["audio", "face", "motion"],
        audioParams: {
          format: "opus",
          sampleRate: 16000,
          channels: 1,
          frameDurationMs: 30
        }
      })
    );
    await once(ws, "message");

    const resultPromise = controller.say("ack me");
    const [data] = (await once(ws, "message")) as [Buffer];
    const command = JSON.parse(data.toString("utf8"));
    expect(command.type).toBe("robot.command");
    expect(command.command.kind).toBe("say");

    ws.send(
      JSON.stringify({
        type: "robot.event",
        eventId: "ack-say",
        deviceId: "stackchan-test",
        timestamp: new Date().toISOString(),
        event: {
          kind: "commandAck",
          commandId: command.commandId,
          commandKind: "say",
          status: "accepted"
        }
      })
    );

    const result = await resultPromise;
    expect(result.sent).toBe(true);
    expect(result.ack).toMatchObject({ received: true, status: "accepted" });
    ws.close();
  });

  it("can wait for commandStatus completion after commandAck", async () => {
    const registry = new DeviceRegistry(createLogger("error"));
    const controller = new RobotController(registry, createLogger("error"));
    server = new StackChanWebSocketServer(baseConfig, registry, createLogger("error"));
    const port = await server.start();

    const ws = new WebSocket(`ws://127.0.0.1:${port}/stackchan/local`);
    await once(ws, "open");
    ws.send(
      JSON.stringify({
        type: "handshake",
        deviceId: "stackchan-test",
        firmwareVersion: "local-test",
        pairingToken: "test-token",
        capabilities: ["audio", "face", "motion"],
        audioParams: {
          format: "opus",
          sampleRate: 16000,
          channels: 1,
          frameDurationMs: 30
        }
      })
    );
    await once(ws, "message");

    const resultPromise = controller.setRgb(
      { enabled: true, color: "#43D5B0", brightness: 0.5 },
      { waitForCompletion: true, completionTimeoutMs: 1000 }
    );
    const [data] = (await once(ws, "message")) as [Buffer];
    const command = JSON.parse(data.toString("utf8"));
    expect(command.seq).toBeGreaterThan(0);
    expect(command.command.kind).toBe("setRgb");

    ws.send(
      JSON.stringify({
        type: "robot.event",
        eventId: "ack-rgb",
        deviceId: "stackchan-test",
        timestamp: new Date().toISOString(),
        event: {
          kind: "commandAck",
          commandId: command.commandId,
          commandKind: "setRgb",
          status: "accepted"
        }
      })
    );
    ws.send(
      JSON.stringify({
        type: "robot.event",
        eventId: "status-rgb",
        deviceId: "stackchan-test",
        timestamp: new Date().toISOString(),
        event: {
          kind: "commandStatus",
          commandId: command.commandId,
          commandKind: "setRgb",
          status: "completed",
          progress: 1
        }
      })
    );

    const result = await resultPromise;
    expect(result.ack).toMatchObject({ received: true, status: "accepted" });
    expect(result.completion).toMatchObject({ received: true, status: "completed", progress: 1 });
    ws.close();
  });

  it("rejects events that spoof another device id after pairing", async () => {
    const registry = new DeviceRegistry(createLogger("error"));
    server = new StackChanWebSocketServer(baseConfig, registry, createLogger("error"));
    const port = await server.start();

    const ws = new WebSocket(`ws://127.0.0.1:${port}/stackchan/local`);
    await once(ws, "open");
    ws.send(
      JSON.stringify({
        type: "handshake",
        deviceId: "stackchan-test",
        firmwareVersion: "local-test",
        pairingToken: "test-token",
        capabilities: ["audio", "face", "motion"],
        audioParams: {
          format: "opus",
          sampleRate: 16000,
          channels: 1,
          frameDurationMs: 30
        }
      })
    );
    await once(ws, "message");

    ws.send(
      JSON.stringify({
        type: "heartbeat",
        deviceId: "other-device",
        timestamp: new Date().toISOString()
      })
    );

    const [data] = (await once(ws, "message")) as [Buffer];
    const message = JSON.parse(data.toString("utf8"));
    expect(message.type).toBe("error");
    expect(message.code).toBe("device_id_mismatch");
    ws.close();
  });
});
