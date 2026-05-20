import { mkdtemp, rm, writeFile, appendFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { Logger } from "../src/config.js";
import {
  CodexSessionWatcher,
  type CodexCompletionEvent
} from "../src/codex/session-watcher.js";
import type { RobotController } from "../src/robot/controller.js";

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {}
};

function jsonl(type: string, payload: Record<string, unknown>): string {
  return JSON.stringify({ timestamp: new Date().toISOString(), type, payload });
}

describe("CodexSessionWatcher", () => {
  it("does not announce historical completions and gives appended completions a stable id", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "stackchan-session-"));
    const filePath = path.join(root, "session.jsonl");
    await writeFile(filePath, `${jsonl("event_msg", { type: "task_complete" })}\n`, "utf8");

    const completions: CodexCompletionEvent[] = [];
    const controller = {
      setMode: () => ({ sent: true, deviceId: "stackchan-001" })
    } as unknown as RobotController;
    const watcher = new CodexSessionWatcher(controller, logger, {
      sessionsRoot: root,
      pollMs: 20,
      latestScanMs: 30_000,
      onCompletion: (event) => completions.push(event)
    });

    try {
      watcher.start();
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(completions).toEqual([]);

      await appendFile(
        filePath,
        `${jsonl("event_msg", {
          type: "user_message",
          message: "# In app browser:\\n- Current URL: http://localhost:8788/\\n\\n## My request for Codex:\\n音频提示音大一点，同时说明是哪个任务执行完了\\n"
        })}\n${jsonl("event_msg", { type: "task_complete" })}\n`,
        "utf8"
      );
      await vi.waitFor(() => expect(completions).toHaveLength(1));
      expect(completions[0]?.id).toMatch(/session\.jsonl:\d+$/);
      expect(completions[0]?.change.reason).toBe("codex task complete");
      expect(completions[0]?.taskSummary).toBe("音频提示音大一点，同时说明是哪个任务执行完了");
    } finally {
      watcher.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
});
