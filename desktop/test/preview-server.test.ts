import { Buffer } from "node:buffer";
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
        speed: 300,
        camera: {
          preset: "fast",
          width: 320,
          height: 240,
          fps: 10,
          quality: 18
        },
        control: {
          mode: "pid",
          deadband: 0.08,
          yaw: { kp: 36, ki: 0, kd: 1.2, direction: 1 },
          pitch: { kp: 8, ki: 0, kd: 0.15, direction: 1 },
          integralLimit: 0.35,
          outputLimitDeg: 4
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
      jpegBuffer: Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2w==", "base64"),
      jpegByteLength: Buffer.byteLength("/9j/4AAQSkZJRgABAQAAAQABAAD/2w==", "base64"),
      timestamp: new Date("2026-05-18T12:00:00.000Z").toISOString(),
      receivedAt: new Date("2026-05-18T12:00:00.020Z").toISOString(),
      captureTimestamp: new Date("2026-05-18T12:00:00.000Z").toISOString(),
      sentAt: new Date("2026-05-18T12:00:00.010Z").toISOString(),
      trace: {
        deviceEncodedAt: new Date("2026-05-18T12:00:00.008Z").toISOString(),
        deviceQueuedAt: new Date("2026-05-18T12:00:00.009Z").toISOString(),
        deviceTxStartAt: new Date("2026-05-18T12:00:00.010Z").toISOString(),
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
        capabilities: ["camera", "rgb", "mic", "nfc", "ir", "proximity", "ambientLight", "magnetometer", "bmi270"],
        audioParams: { format: "opus", sampleRate: 16000, channels: 1, frameDurationMs: 30 },
        status: "online",
        mode: "idle",
        connectedAt: new Date("2026-05-18T12:00:00.000Z").toISOString(),
        lastSeenAt: this.lastSeenAt,
        audioFramesReceived: 0,
        sensors: {
          bmi270: {
            kind: "bmi270",
            motion: "none",
            x: 0.1,
            y: -0.2,
            z: 9.7,
            gyroX: 0.01,
            gyroY: -0.02,
            gyroZ: 0.03,
            attitude: {
              available: true,
              quaternion: { w: 0.99, x: 0.01, y: -0.02, z: 0.03 },
              pitchDeg: -1.2,
              rollDeg: 2.4,
              yawDeg: 91.5,
              quality: "gyroAccelMag",
              magnetometerUsed: true,
              sampleHz: 100
            },
            magnetometer: { available: true, x: 0.1, y: -0.2, z: 0.3, rawX: 12, rawY: -24, rawZ: 36 },
            updatedAt: this.lastSeenAt,
            receivedAt: this.lastSeenAt,
            eventId: "evt-bmi270"
          },
          proximity: {
            kind: "proximity",
            available: true,
            value: 42,
            raw: 42,
            updatedAt: this.lastSeenAt,
            receivedAt: this.lastSeenAt,
            eventId: "evt-proximity"
          },
          ambientLight: {
            kind: "ambientLight",
            available: true,
            lux: 18.5,
            raw: 320,
            updatedAt: this.lastSeenAt,
            receivedAt: this.lastSeenAt,
            eventId: "evt-ambient-light"
          },
          hardwareStatus: {
            kind: "hardwareStatus",
            uptimeMs: 12_000,
            updatedAt: this.lastSeenAt,
            power: {
              batteryLevel: 82,
              charging: false,
              speakerVolume: 80
            },
            network: {
              wifi: {
                status: "connected",
                rssi: -54,
                ssid: "local-lab"
              },
              ble: {
                connected: false
              }
            },
            peripherals: {
              rgb: { available: true, enabled: true },
              nfc: { available: false, reason: "not_detected_i2c_0x50" },
              powerMonitor: { available: true, busVoltage: 3.9, current: 0.11, power: 0.43 },
              ir: { available: true },
              mic: {
                available: true
              }
            }
          }
        }
      }
    ];
  }

  emitHardwareStatusBattery(level: number, timestamp = new Date("2026-05-18T12:00:01.000Z").toISOString()): void {
    this.lastSeenAt = timestamp;
    for (const listener of this.listeners) {
      listener({
        type: "robot.event",
        eventId: `hardware-status-${level}`,
        deviceId: "stackchan-test",
        timestamp,
        event: {
          kind: "hardwareStatus",
          uptimeMs: 13_000,
          power: {
            batteryLevel: level,
            charging: false
          }
        }
      });
    }
  }

  emitBmi270(timestamp = new Date("2026-05-18T12:00:01.100Z").toISOString()): void {
    this.lastSeenAt = timestamp;
    for (const listener of this.listeners) {
      listener({
        type: "robot.event",
        eventId: `bmi270-${timestamp}`,
        deviceId: "stackchan-test",
        timestamp,
        event: {
          kind: "bmi270",
          motion: "none",
          x: 0.2,
          y: -0.1,
          z: 9.8,
          gyroX: 0.02,
          gyroY: -0.01,
          gyroZ: 0.04,
          attitude: {
            available: true,
            quaternion: { w: 0.99, x: 0.01, y: -0.02, z: 0.03 },
            pitchDeg: -1.1,
            rollDeg: 2.2,
            yawDeg: 90.5,
            quality: "gyroAccelMag",
            magnetometerUsed: true,
            sampleHz: 100
          }
        }
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
    const reactCommands: Array<{
      emotion: string;
      durationMs?: number;
      avatarJson?: Record<string, unknown>;
      rgbJson?: Record<string, unknown>;
    }> = [];
    const moveCommands: Array<{ yaw: number; pitch: number; speed?: number }> = [];
    const cameraStreamCommands: Array<{ enabled: boolean; fps?: number; width?: number; height?: number; quality?: number; format?: "jpeg" }> = [];
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
        react: async (options) => {
          reactCommands.push(options);
          return {
            sent: true,
            deviceId: "stackchan-test",
            command: { kind: "react", ...options },
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
        },
        getRouteSnapshot: () => ({
          provider: "volcengine",
          configuredVoice: "zh_male_liangsangmengzai_uranus_bigtts",
          activeVoice: "zh_male_liangsangmengzai_uranus_bigtts",
          cloudEnabled: true,
          cloudConfigured: true
        })
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
    expect(frame.headers.get("x-frame-device-encoded-at")).toBe("2026-05-18T12:00:00.008Z");
    expect(frame.headers.get("x-frame-device-queued-at")).toBe("2026-05-18T12:00:00.009Z");
    expect(frame.headers.get("x-frame-device-tx-start-at")).toBe("2026-05-18T12:00:00.010Z");

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

    const expression = (await fetch(`${baseUrl}/api/expression`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        emotion: "doubtful",
        durationMs: 1250,
        flash: true,
        rgbColor: "#43d5b0",
        avatarJson: {
          type: "ignored",
          leftEye: { x: 6, y: -4, rotation: 1810, weight: 101, size: -120 },
          rightEye: { x: -6, y: -4, rotation: -1810, weight: 98, size: 8 },
          mouth: { x: 0, y: 12, rotation: 0, weight: 72, size: 4 }
        }
      })
    }).then((response) => response.json())) as {
      ok: boolean;
      emotion: string;
      durationMs: number;
      flash: boolean;
      rgbColor: string;
      avatarJson: Record<string, unknown>;
    };
    expect(expression.ok).toBe(true);
    expect(expression.emotion).toBe("doubtful");
    expect(expression.durationMs).toBe(1250);
    expect(expression.flash).toBe(true);
    expect(expression.rgbColor).toBe("#43D5B0");
    expect(expression.avatarJson).toEqual({
      type: "bleAvatar",
      leftEye: { x: 6, y: -4, rotation: 1800, weight: 100, size: -100 },
      rightEye: { x: -6, y: -4, rotation: -1800, weight: 98, size: 8 },
      mouth: { x: 0, y: 12, rotation: 0, weight: 72, size: 4 }
    });
    expect(reactCommands).toEqual([
      {
        emotion: "doubtful",
        durationMs: 1250,
        avatarJson: {
          type: "bleAvatar",
          leftEye: { x: 6, y: -4, rotation: 1800, weight: 100, size: -100 },
          rightEye: { x: -6, y: -4, rotation: -1800, weight: 98, size: 8 },
          mouth: { x: 0, y: 12, rotation: 0, weight: 72, size: 4 }
        },
        rgbJson: {
          leftRgbDuration: 0.14,
          leftRgbColor: "#43D5B0",
          rightRgbDuration: 0.14,
          rightRgbColor: "#43D5B0"
        }
      }
    ]);

    const invalidAvatarExpression = (await fetch(`${baseUrl}/api/expression`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ emotion: "happy", avatarJson: { leftEye: {}, rightEye: {}, mouth: null } })
    }).then((response) => response.json())) as { ok: boolean; error: string };
    expect(invalidAvatarExpression).toEqual({ ok: false, error: "invalid avatarJson" });
    expect(reactCommands).toHaveLength(1);

    const aliasExpression = (await fetch(`${baseUrl}/api/expression`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ emotion: "surprised" })
    }).then((response) => response.json())) as { ok: boolean; emotion: string; durationMs: number };
    expect(aliasExpression.ok).toBe(true);
    expect(aliasExpression.emotion).toBe("surprised");
    expect(aliasExpression.durationMs).toBe(2000);
    expect(reactCommands[1]).toMatchObject({ emotion: "surprised", durationMs: 2000 });

    const invalidExpression = (await fetch(`${baseUrl}/api/expression`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ emotion: "panic" })
    }).then((response) => response.json())) as { ok: boolean; error: string };
    expect(invalidExpression).toEqual({ ok: false, error: "invalid emotion" });
    expect(reactCommands).toHaveLength(2);

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

    const tuned = (await fetch(`${baseUrl}/api/tracking`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ control: { speed: 520, control: { deadband: 0.08 } } })
    }).then((response) => response.json())) as { status: { control: { speed: number; control: { deadband: number } } } };

    expect(tuned.status.control.speed).toBe(520);
    expect(tuned.status.control.control.deadband).toBe(0.08);

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
    registry.emitHardwareStatusBattery(87);

    const deadline = Date.now() + 2000;
    while (!body.includes('"lastSeenAt":"2026-05-18T12:00:01.000Z"') && Date.now() < deadline) {
      const chunk = await reader.read();
      if (chunk.done) break;
      body += decoder.decode(chunk.value);
    }
    reader.cancel().catch(() => {});

    expect(body).toContain('"lastSeenAt":"2026-05-18T12:00:01.000Z"');
  });

  it("lets high-rate device events preempt a pending low-rate snapshot broadcast", async () => {
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
    let body = decoder.decode((await reader.read()).value);

    registry.emitHardwareStatusBattery(86, "2026-05-18T12:00:01.000Z");
    const firstDeadline = Date.now() + 1000;
    while (!body.includes('"lastSeenAt":"2026-05-18T12:00:01.000Z"') && Date.now() < firstDeadline) {
      const chunk = await reader.read();
      if (chunk.done) break;
      body += decoder.decode(chunk.value);
    }
    expect(body).toContain('"lastSeenAt":"2026-05-18T12:00:01.000Z"');

    registry.emitHardwareStatusBattery(87, "2026-05-18T12:00:02.000Z");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const startedAt = Date.now();
    registry.emitBmi270("2026-05-18T12:00:02.100Z");

    const deadline = Date.now() + 1000;
    while (!body.includes('"lastSeenAt":"2026-05-18T12:00:02.100Z"') && Date.now() < deadline) {
      const chunk = await reader.read();
      if (chunk.done) break;
      body += decoder.decode(chunk.value);
    }
    reader.cancel().catch(() => {});

    expect(body).toContain('"lastSeenAt":"2026-05-18T12:00:02.100Z"');
    expect(Date.now() - startedAt).toBeLessThan(250);
  });
});
