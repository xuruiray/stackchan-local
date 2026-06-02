import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("loadConfig", () => {
  it("uses fast face tracking defaults when no local override is configured", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "stackchan-config-"));
    tempDirs.push(projectRoot);

    const config = loadConfig({
      HOME: projectRoot,
      STACKCHAN_PROJECT_ROOT: projectRoot
    });

    expect(config.faceTrackingCameraPreset).toBe("fast");
    expect(config.faceTrackingSpeed).toBe(300);
    expect(config.faceTrackingDeadband).toBe(0.08);
    expect(config.faceTrackingYawKp).toBe(36);
    expect(config.faceTrackingYawKd).toBe(1.2);
    expect(config.faceTrackingYawDirection).toBe(1);
    expect(config.faceTrackingPitchKp).toBe(8);
    expect(config.faceTrackingPitchKd).toBe(0.15);
    expect(config.faceTrackingPitchDirection).toBe(1);
    expect(config.faceTrackingIntegralLimit).toBe(0.35);
    expect(config.faceTrackingOutputLimitDeg).toBe(4);
    expect(config.faceTrackingYuNetModel).toBe(path.join(projectRoot, "desktop/models/face_detection_yunet_2023mar.onnx"));
    expect(config.faceTrackingYuNetScoreThreshold).toBe(0.85);
    expect(config.faceTrackingYuNetNmsThreshold).toBe(0.3);
    expect(config.faceTrackingYuNetTopK).toBe(500);
    expect(config.faceTrackingTraceLog).toBe(path.join(projectRoot, "logs/face-tracking.ndjson"));
    expect(config.faceTrackingDetectorScript).toBe(path.join(projectRoot, "desktop/scripts/face_detector.py"));
  });

  it("loads local .env values without overriding explicit environment variables", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "stackchan-config-"));
    tempDirs.push(projectRoot);
    writeFileSync(
      path.join(projectRoot, ".env"),
      [
        "STACKCHAN_VOLCENGINE_TTS_ENABLED=1",
        `${"VOLCENGINE_TTS_API_KEY"}=from-dot-env`,
        "VOLCENGINE_TTS_VOICE_ID=voice-from-dot-env",
        "STACKCHAN_CODEX_COMPLETION_TTS_VOLUME=91",
        "STACKCHAN_FACE_TRACKING_DETECTOR=desktop/scripts/custom_detector.py",
        "STACKCHAN_FACE_TRACKING_YAW_DIRECTION=-1",
        "STACKCHAN_FACE_TRACKING_PITCH_DIRECTION=1",
        "STACKCHAN_FACE_TRACKING_YUNET_MODEL=desktop/models/custom-yunet.onnx",
        "STACKCHAN_FACE_TRACKING_YUNET_SCORE_THRESHOLD=0.91",
        "STACKCHAN_FACE_TRACKING_YUNET_NMS_THRESHOLD=0.25",
        "STACKCHAN_FACE_TRACKING_YUNET_TOP_K=120"
      ].join("\n")
    );

    const env = {
      HOME: projectRoot,
      STACKCHAN_PROJECT_ROOT: projectRoot,
      VOLCENGINE_TTS_API_KEY: "explicit-token"
    };
    const config = loadConfig(env);

    expect(config.volcengineTtsEnabled).toBe(true);
    expect(config.volcengineTtsApiKey).toBe("explicit-token");
    expect(config.volcengineTtsVoiceId).toBe("voice-from-dot-env");
    expect(config.volcengineTtsCompletionVolume).toBe(91);
    expect(config.faceTrackingDetectorScript).toBe(path.join(projectRoot, "desktop/scripts/custom_detector.py"));
    expect(config.faceTrackingYawDirection).toBe(-1);
    expect(config.faceTrackingPitchDirection).toBe(1);
    expect(config.faceTrackingYuNetModel).toBe(path.join(projectRoot, "desktop/models/custom-yunet.onnx"));
    expect(config.faceTrackingYuNetScoreThreshold).toBe(0.91);
    expect(config.faceTrackingYuNetNmsThreshold).toBe(0.25);
    expect(config.faceTrackingYuNetTopK).toBe(120);
  });
});
