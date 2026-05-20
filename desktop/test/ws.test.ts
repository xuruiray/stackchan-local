import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { createLogger, type DesktopConfig } from "../src/config.js";
import { DeviceRegistry } from "../src/device/registry.js";
import { RobotController } from "../src/robot/controller.js";
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
    expect(registry.listSnapshots()).toHaveLength(1);
    ws.close();
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
          nfc: { available: false, reason: "driver_not_wired" },
          ir: { available: false, reason: "driver_not_wired" },
          mic: { available: true, channels: 1, mode: "mono_opus", localization: "abandoned" }
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
    expect(snapshot.sensors.sensorSnapshot?.peripherals?.nfc?.reason).toBe("driver_not_wired");
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
