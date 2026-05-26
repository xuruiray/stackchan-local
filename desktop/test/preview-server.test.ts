import { afterEach, describe, expect, it } from "vitest";

import { createLogger } from "../src/config.js";
import { DebugLogBuffer } from "../src/debug/log-buffer.js";
import type { DeviceEventListener, DeviceRegistry } from "../src/device/registry.js";
import { PreviewServer } from "../src/preview/server.js";
import type { VisionPreviewListener, VisionPreviewSnapshot, VisionTrackingService } from "../src/vision/tracking.js";

class FakeVisionTracking {
  private readonly listeners = new Set<VisionPreviewListener>();
  private enabled = true;

  snapshot: VisionPreviewSnapshot = {
    status: {
      enabled: true,
      fps: 10,
      mirrorX: false,
      detectorAvailable: true,
      control: {
        speed: 420,
        camera: {
          preset: "fast",
          width: 320,
          height: 240,
          fps: 10,
          quality: 18
        },
        detector: {
          minDetectionConfidence: 0.18,
          minPresenceConfidence: 0.18,
          minTrackingConfidence: 0.18
        },
        control: {
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
        }
      },
      sourceCamera: {
        enabled: true,
        owner: "faceTracking",
        fps: 10,
        quality: 18,
        width: 320,
        height: 240
      },
      rawPreview: {
        enabled: false,
        camera: {
          preset: "fast",
          width: 320,
          height: 240,
          fps: 10,
          quality: 14
        }
      },
      adaptive: {
        level: 0,
        active: false,
        fps: 10,
        quality: 18,
        dropRate: 0
      },
      framesReceived: 1,
      framesDropped: 0,
      detectorLatencyMs: 18,
      latency: {
        frameAgeMs: 20,
        deviceToDaemonMs: 10,
        captureToDaemonMs: 20,
        detectorEndToEndMs: 38
      },
      mediaCredit: {
        enabled: false,
        grantedFrames: 0,
        outstandingFrames: 0
      },
      lastFrameAt: new Date("2026-05-18T12:00:00.000Z").toISOString()
    },
    faces: [{ x: 0.2, y: 0.25, width: 0.3, height: 0.35, confidence: 1 }],
    target: { x: 0.2, y: 0.25, width: 0.3, height: 0.35, confidence: 1 },
    frame: {
      frameId: "frame-1",
      mimeType: "image/jpeg",
      width: 2,
      height: 2,
      dataBase64: "/9j/4AAQSkZJRgABAQAAAQABAAD/2w==",
      timestamp: new Date("2026-05-18T12:00:00.000Z").toISOString(),
      receivedAt: new Date("2026-05-18T12:00:00.020Z").toISOString(),
      captureTimestamp: new Date("2026-05-18T12:00:00.000Z").toISOString(),
      sentAt: new Date("2026-05-18T12:00:00.010Z").toISOString(),
      trace: {
        detectorFinishedAt: new Date("2026-05-18T12:00:00.038Z").toISOString()
      }
    }
  };

  previewSnapshot(): VisionPreviewSnapshot {
    return this.snapshot;
  }

  onPreviewUpdate(listener: VisionPreviewListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setEnabled(enabled: boolean): VisionPreviewSnapshot["status"] {
    this.enabled = enabled;
    this.snapshot.status.enabled = enabled;
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
    return this.snapshot.status;
  }

  setControl(patch: {
    speed?: number;
    cameraPreset?: "fast" | "accurate" | "debug";
    camera?: Partial<{ width: number; height: number; fps: number; quality: number }>;
    control?: { deadband?: number };
  }): VisionPreviewSnapshot["status"] {
    if (typeof patch.speed === "number") {
      this.snapshot.status.control.speed = patch.speed;
    }
    if (patch.cameraPreset === "accurate") {
      this.snapshot.status.control.camera = {
        preset: "accurate",
        width: 320,
        height: 240,
        fps: 6,
        quality: 28
      };
      this.snapshot.status.fps = 6;
    }
    if (patch.camera) {
      this.snapshot.status.control.camera = {
        ...this.snapshot.status.control.camera,
        ...patch.camera,
        width: 320,
        height: 240
      };
      this.snapshot.status.fps = this.snapshot.status.control.camera.fps;
    }
    if (typeof patch.control?.deadband === "number") {
      this.snapshot.status.control.control.deadband = patch.control.deadband;
    }
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
    return this.snapshot.status;
  }

  get enabledState(): boolean {
    return this.enabled;
  }
}

class FakeDeviceRegistry {
  private readonly listeners = new Set<DeviceEventListener>();
  private lastSeenAt = new Date("2026-05-18T12:00:00.000Z").toISOString();

  onEvent(listener: DeviceEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  listSnapshots(): ReturnType<DeviceRegistry["listSnapshots"]> {
    return [
      {
        deviceId: "stackchan-test",
        sessionId: "session-test",
        firmwareVersion: "local-test",
        capabilities: ["camera", "rgb", "mic", "nfc", "ir", "proximity", "ambientLight", "magnetometer"],
        audioParams: { format: "opus", sampleRate: 16000, channels: 1, frameDurationMs: 30 },
        status: "online",
        mode: "idle",
        connectedAt: new Date("2026-05-18T12:00:00.000Z").toISOString(),
        lastSeenAt: this.lastSeenAt,
        audioFramesReceived: 0,
        sensors: {
          sensorSnapshot: {
            kind: "sensorSnapshot",
            uptimeMs: 12_000,
            updatedAt: this.lastSeenAt,
            peripherals: {
              rgb: { available: true, count: 12, enabled: true, color: "#43D5B0", brightness: 0.8, driver: "neon-light" },
              nfc: { available: false, driver: "st25r3916-probe", address: 0x50, reason: "not_detected_i2c_0x50" },
              powerMonitor: { available: true, driver: "ina226", address: 0x41, busVoltage: 3.9, current: 0.11, power: 0.43 },
              ir: { available: true, driver: "gpio-ir-basic", txPin: 5, rxPin: 10 },
              proximity: { available: true, value: 42, raw: 42, driver: "ltr553" },
              ambientLight: { available: true, lux: 18.5, raw: 320, driver: "ltr553" },
              magnetometer: { available: true, x: 0.1, y: -0.2, z: 0.3, rawX: 12, rawY: -24, rawZ: 36, driver: "bmi270-aux-bmm150" },
              mic: {
                available: true,
                channels: 2,
                mode: "mono_opus",
                localization: "abandoned",
                level: 0.42,
                rms: 0.08,
                peak: 0.31,
                dbfs: -21.4,
                updatedAt: 12_000,
                driver: "es7210-level-meter"
              }
            }
          }
        }
      }
    ];
  }

  emitBattery(level: number): void {
    this.lastSeenAt = new Date("2026-05-18T12:00:01.000Z").toISOString();
    for (const listener of this.listeners) {
      listener({
        type: "robot.event",
        eventId: `battery-${level}`,
        deviceId: "stackchan-test",
        timestamp: this.lastSeenAt,
        event: { kind: "battery", level, charging: false }
      });
    }
  }
}

describe("PreviewServer", () => {
  let server: PreviewServer | undefined;

  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  it("serves the preview UI, status JSON, latest JPEG, and tracking toggle", async () => {
    const fakeVision = new FakeVisionTracking();
    const debugLog = new DebugLogBuffer();
    debugLog.append({
      time: new Date("2026-05-18T12:00:01.000Z").toISOString(),
      level: "info",
      message: "camera frame received",
      context: { type: "vision", dataBase64: "abcd".repeat(100) }
    });
    const announcements: Array<{ id: string; reason: string; taskSummary?: string }> = [];
    const rgbCommands: Array<{ enabled: boolean; color?: string; brightness?: number }> = [];
    const moveCommands: Array<{ yaw: number; pitch: number; speed?: number }> = [];
    const cameraStreamCommands: Array<{ enabled: boolean; fps?: number; width?: number; height?: number; quality?: number; format?: "jpeg" }> = [];
    const telemetryCommands: Array<{
      sensorSnapshotHz?: 0 | 0.5 | 1 | 2;
      imuHz?: 0 | 1 | 2 | 4 | 10;
      includeI2cScan?: boolean;
      reason?: string;
    }> = [];
    let captureImageCount = 0;
    let ttsEnabled = true;
    let lightEnabled = true;
    let ttsVolume = 80;
    server = new PreviewServer({ host: "127.0.0.1", port: 0 }, fakeVision as unknown as VisionTrackingService, createLogger("error"), {
      registry: new FakeDeviceRegistry() as unknown as DeviceRegistry,
      debugLog,
      robotController: {
        setRgb: async (options) => {
          rgbCommands.push(options);
          return {
            sent: true,
            deviceId: "stackchan-test",
            command: { kind: "setRgb", ...options },
            ack: { received: true, status: "accepted" }
          };
        },
        moveHead: async (options) => {
          moveCommands.push(options);
          return {
            sent: true,
            deviceId: "stackchan-test",
            command: { kind: "moveHead", ...options },
            ack: { received: true, status: "accepted" }
          };
        },
        cameraStream: async (options) => {
          cameraStreamCommands.push(options);
          return {
            sent: true,
            deviceId: "stackchan-test",
            command: { kind: "cameraStream", ...options },
            ack: { received: true, status: "accepted" }
          };
        },
        captureImage: async () => {
          captureImageCount += 1;
          return {
            sent: true,
            deviceId: "stackchan-test",
            command: { kind: "captureImage", requestId: "capture-test", format: "jpeg" },
            ack: { received: true, status: "accepted" }
          };
        },
        telemetryConfig: async (options) => {
          telemetryCommands.push(options);
          return {
            sent: true,
            deviceId: "stackchan-test",
            command: { kind: "telemetryConfig", ...options },
            ack: { received: true, status: "accepted" }
          };
        }
      },
      completionAnnouncer: {
        announce: (completion) => announcements.push(completion),
        isEnabled: () => ttsEnabled,
        setEnabled: (enabled) => {
          ttsEnabled = enabled;
          return ttsEnabled;
        },
        isLightEnabled: () => lightEnabled,
        setLightEnabled: (enabled) => {
          lightEnabled = enabled;
          return lightEnabled;
        },
        getVolume: () => ttsVolume,
        setVolume: (volume) => {
          ttsVolume = Math.min(100, Math.max(0, Math.round(volume)));
          return ttsVolume;
        }
      }
    });
    const port = await server.start();
    const baseUrl = `http://127.0.0.1:${port}`;

    const html = await fetch(`${baseUrl}/`).then((response) => response.text());
    expect(html).toContain("StackChan Hardware Console");
    expect(html).toContain("/assets/");
    const assetPath = html.match(/src="([^"]+\.js)"/)?.[1];
    expect(assetPath).toBeTruthy();
    if (assetPath) {
      const asset = await fetch(`${baseUrl}${assetPath}`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get("content-type")).toContain("text/javascript");
    }

    const ipv6Html = await fetch(`http://[::1]:${port}/`).then((response) => response.text());
    expect(ipv6Html).toContain("StackChan Hardware Console");

    const status = (await fetch(`${baseUrl}/status`).then((response) => response.json())) as {
      frame: { frameId: string };
      faces: unknown[];
      completionTts: { enabled: boolean; lightEnabled: boolean; volume: number };
    };
    expect(status.frame.frameId).toBe("frame-1");
    expect(status.faces).toHaveLength(1);
    expect(status.completionTts.enabled).toBe(true);
    expect(status.completionTts.lightEnabled).toBe(true);
    expect(status.completionTts.volume).toBe(80);

    const debug = (await fetch(`${baseUrl}/debug/snapshot`).then((response) => response.json())) as {
      vision: { status: { framesReceived: number } };
      logs: Array<{ context: { dataBase64: string } }>;
    };
    expect(debug.vision.status.framesReceived).toBe(1);
    expect(debug.logs[0].context.dataBase64).toBe("[redacted]");

    const logs = (await fetch(`${baseUrl}/debug/logs?type=vision&limit=10`).then((response) => response.json())) as {
      logs: Array<{ type: string; context: { dataBase64: string } }>;
    };
    expect(logs.logs[0].type).toBe("vision");
    expect(logs.logs[0].context.dataBase64).toBe("[redacted]");

    const frame = await fetch(`${baseUrl}/frame.jpg`);
    expect(frame.status).toBe(200);
    expect(frame.headers.get("content-type")).toBe("image/jpeg");
    expect(frame.headers.get("x-frame-stream")).toBe("raw");
    expect(frame.headers.get("x-frame-received-at")).toBe("2026-05-18T12:00:00.020Z");
    expect(frame.headers.get("x-frame-sent-at")).toBe("2026-05-18T12:00:00.010Z");
    expect(frame.headers.get("x-frame-capture-timestamp")).toBe("2026-05-18T12:00:00.000Z");

    const processedFrame = await fetch(`${baseUrl}/processed-frame.jpg`);
    expect(processedFrame.status).toBe(200);
    expect(processedFrame.headers.get("content-type")).toBe("image/jpeg");
    expect(processedFrame.headers.get("x-frame-stream")).toBe("processed");
    expect(processedFrame.headers.get("x-detector-finished-at")).toBe("2026-05-18T12:00:00.038Z");

    const stream = await fetch(`${baseUrl}/stream.mjpg`);
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("multipart/x-mixed-replace");
    expect(stream.headers.get("x-frame-stream")).toBe("raw");
    await stream.body?.cancel();

    const processedStream = await fetch(`${baseUrl}/processed-stream.mjpg`);
    expect(processedStream.status).toBe(200);
    expect(processedStream.headers.get("content-type")).toContain("multipart/x-mixed-replace");
    expect(processedStream.headers.get("x-frame-stream")).toBe("processed");
    await processedStream.body?.cancel();

    const toggled = (await fetch(`${baseUrl}/api/tracking`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false })
    }).then((response) => response.json())) as { status: { enabled: boolean } };

    expect(fakeVision.enabledState).toBe(false);
    expect(toggled.status.enabled).toBe(false);

    const ttsTest = (await fetch(`${baseUrl}/api/completion-tts-test`, { method: "POST" }).then((response) =>
      response.json()
    )) as { ok: boolean; id: string };
    expect(ttsTest.ok).toBe(true);
    expect(announcements).toEqual([
      { id: ttsTest.id, reason: "manual preview tts test", taskSummary: "调试播报" }
    ]);

    const ttsSettings = (await fetch(`${baseUrl}/api/completion-tts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false, lightEnabled: false, volume: 72.6 })
    }).then((response) => response.json())) as { ok: boolean; enabled: boolean; lightEnabled: boolean; volume: number };

    expect(ttsSettings.ok).toBe(true);
    expect(ttsSettings.enabled).toBe(false);
    expect(ttsSettings.lightEnabled).toBe(false);
    expect(ttsSettings.volume).toBe(73);

    const rgb = (await fetch(`${baseUrl}/api/rgb`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, color: "#6cb6ff" })
    }).then((response) => response.json())) as { ok: boolean; enabled: boolean; color: string };

    expect(rgb.ok).toBe(true);
    expect(rgb.enabled).toBe(true);
    expect(rgb.color).toBe("#6CB6FF");
    expect(rgbCommands).toEqual([{ enabled: true, color: "#6CB6FF", brightness: undefined }]);

    const moved = (await fetch(`${baseUrl}/api/hardware/move-head`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ yaw: 12, pitch: 345, speed: 420 })
    }).then((response) => response.json())) as { ok: boolean };
    expect(moved.ok).toBe(true);
    expect(moveCommands).toEqual([{ yaw: 12, pitch: 345, speed: 420 }]);

    const cameraStream = (await fetch(`${baseUrl}/api/hardware/camera-stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, fps: 10, width: 320, height: 240, quality: 18 })
    }).then((response) => response.json())) as { ok: boolean };
    expect(cameraStream.ok).toBe(true);
    expect(cameraStreamCommands).toEqual([{ enabled: true, fps: 10, width: 320, height: 240, quality: 18, format: "jpeg" }]);

    const captured = (await fetch(`${baseUrl}/api/hardware/capture-image`, {
      method: "POST"
    }).then((response) => response.json())) as { ok: boolean };
    expect(captured.ok).toBe(true);
    expect(captureImageCount).toBe(1);

    const telemetry = (await fetch(`${baseUrl}/api/hardware/telemetry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sensorSnapshotHz: 1, imuHz: 4, includeI2cScan: true, reason: "test" })
    }).then((response) => response.json())) as { ok: boolean };
    expect(telemetry.ok).toBe(true);
    expect(telemetryCommands).toEqual([{ sensorSnapshotHz: 1, imuHz: 4, includeI2cScan: true, reason: "test" }]);

    const tuned = (await fetch(`${baseUrl}/api/tracking`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ control: { speed: 520, control: { deadband: 0.03 } } })
    }).then((response) => response.json())) as { status: { control: { speed: number; control: { deadband: number } } } };

    expect(tuned.status.control.speed).toBe(520);
    expect(tuned.status.control.control.deadband).toBe(0.03);

    const cameraTuned = (await fetch(`${baseUrl}/api/tracking`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ control: { cameraPreset: "accurate" } })
    }).then((response) => response.json())) as { status: { control: { camera: { preset: string; width: number; height: number; fps: number; quality: number } } } };

    expect(cameraTuned.status.control.camera).toEqual({
      preset: "accurate",
      width: 320,
      height: 240,
      fps: 6,
      quality: 28
    });

    const customCamera = (await fetch(`${baseUrl}/api/tracking`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ control: { camera: { width: 640, height: 480, fps: 15 } } })
    }).then((response) => response.json())) as { status: { control: { camera: { width: number; height: number; fps: number; quality: number } } } };

    expect(customCamera.status.control.camera).toMatchObject({
      width: 320,
      height: 240,
      fps: 15,
      quality: 28
    });
  });

  it("broadcasts throttled snapshot updates for non-camera device events", async () => {
    const fakeVision = new FakeVisionTracking();
    const registry = new FakeDeviceRegistry();
    server = new PreviewServer(
      { host: "127.0.0.1", port: 0 },
      fakeVision as unknown as VisionTrackingService,
      createLogger("error"),
      { registry: registry as unknown as DeviceRegistry }
    );
    const port = await server.start();
    const response = await fetch(`http://127.0.0.1:${port}/events`);
    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();
    if (!reader) return;

    const decoder = new TextDecoder();
    let body = "";
    body += decoder.decode((await reader.read()).value);
    registry.emitBattery(87);

    const deadline = Date.now() + 2000;
    while (!body.includes('"lastSeenAt":"2026-05-18T12:00:01.000Z"') && Date.now() < deadline) {
      const chunk = await reader.read();
      if (chunk.done) break;
      body += decoder.decode(chunk.value);
    }
    reader.cancel().catch(() => {});

    expect(body).toContain('"lastSeenAt":"2026-05-18T12:00:01.000Z"');
  });
});
