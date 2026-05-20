import { afterEach, describe, expect, it } from "vitest";

import { createLogger } from "../src/config.js";
import { DebugLogBuffer } from "../src/debug/log-buffer.js";
import { PreviewServer } from "../src/preview/server.js";
import type { VisionPreviewListener, VisionPreviewSnapshot, VisionTrackingService } from "../src/vision/tracking.js";

class FakeVisionTracking {
  private readonly listeners = new Set<VisionPreviewListener>();
  private enabled = true;

  snapshot: VisionPreviewSnapshot = {
    status: {
      enabled: true,
      fps: 4,
      mirrorX: false,
      detectorAvailable: true,
      control: {
        speed: 420,
        control: {
          mode: "pid",
          deadband: 0.045,
          yaw: { kp: 42, ki: 0, kd: 8 },
          pitch: { kp: 30, ki: 0, kd: 6 },
          integralLimit: 0.35,
          outputLimitDeg: 20
        }
      },
      framesReceived: 1,
      framesDropped: 0,
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
      timestamp: new Date("2026-05-18T12:00:00.000Z").toISOString()
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

  setControl(patch: { speed?: number; control?: { deadband?: number } }): VisionPreviewSnapshot["status"] {
    if (typeof patch.speed === "number") {
      this.snapshot.status.control.speed = patch.speed;
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
    let ttsEnabled = true;
    let lightEnabled = true;
    let ttsVolume = 80;
    server = new PreviewServer({ host: "127.0.0.1", port: 0 }, fakeVision as unknown as VisionTrackingService, createLogger("error"), {
      debugLog,
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
    expect(html).toContain("StackChan Vision");
    expect(html).toContain("Hardware");
    expect(html).toContain("Yaw P");
    expect(html).toContain("TTS Vol");

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

    const tuned = (await fetch(`${baseUrl}/api/tracking`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ control: { speed: 520, control: { deadband: 0.03 } } })
    }).then((response) => response.json())) as { status: { control: { speed: number; control: { deadband: number } } } };

    expect(tuned.status.control.speed).toBe(520);
    expect(tuned.status.control.control.deadband).toBe(0.03);
  });
});
