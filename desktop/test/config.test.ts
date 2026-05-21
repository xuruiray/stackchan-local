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
  it("loads local .env values without overriding explicit environment variables", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "stackchan-config-"));
    tempDirs.push(projectRoot);
    writeFileSync(
      path.join(projectRoot, ".env"),
      [
        "STACKCHAN_VOLCENGINE_TTS_ENABLED=1",
        `${"VOLCENGINE_TTS_API_KEY"}=from-dot-env`,
        "VOLCENGINE_TTS_VOICE_ID=voice-from-dot-env",
        "STACKCHAN_CODEX_COMPLETION_TTS_VOLUME=91"
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
  });
});
