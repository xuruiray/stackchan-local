import type { RobotMode } from "@stackchan-local/protocol";

export interface CodexLogEntry {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    role?: string;
    phase?: string;
    output?: string;
    [key: string]: unknown;
  };
}

export interface CodexStateChange {
  mode: RobotMode;
  reason: string;
  ttlMs?: number;
}

export class CodexSessionStateMachine {
  private activeTurn = false;
  private mode: RobotMode = "idle";

  handleEntry(entry: CodexLogEntry): CodexStateChange | undefined {
    const payload = entry.payload ?? {};

    if (entry.type === "event_msg" && payload.type === "user_message") {
      this.activeTurn = true;
      return this.change("thinking", "codex user message");
    }

    if (entry.type === "response_item" && payload.type === "reasoning") {
      this.activeTurn = true;
      return this.change("thinking", "codex reasoning");
    }

    if (entry.type === "response_item" && payload.type === "function_call") {
      this.activeTurn = true;
      return this.change("thinking", "codex tool call");
    }

    if (entry.type === "response_item" && payload.type === "function_call_output") {
      const output = typeof payload.output === "string" ? payload.output : "";
      if (/Process exited with code\s+([1-9]\d*)/.test(output)) {
        return this.change("error", "codex tool failed", 6000);
      }
      if (/Process running/.test(output)) {
        this.activeTurn = true;
        return this.change("thinking", "codex tool running");
      }
      return undefined;
    }

    if (entry.type === "event_msg" && payload.type === "agent_message") {
      if (payload.phase === "final_answer") {
        this.activeTurn = false;
        return this.change("idle", "codex final answer");
      }
      if (payload.phase === "commentary") {
        return this.change("speaking", "codex commentary", 2500);
      }
    }

    if (entry.type === "response_item" && payload.type === "message" && payload.role === "assistant") {
      if (payload.phase === "final_answer") {
        this.activeTurn = false;
        return this.change("idle", "codex final answer");
      }
      if (payload.phase === "commentary") {
        return this.change("speaking", "codex commentary", 2500);
      }
    }

    if (entry.type === "event_msg" && payload.type === "task_complete") {
      this.activeTurn = false;
      return this.change("idle", "codex task complete");
    }

    return undefined;
  }

  resumeAfterTemporary(): CodexStateChange {
    return this.change(this.activeTurn ? "thinking" : "idle", this.activeTurn ? "codex still working" : "codex idle");
  }

  private change(mode: RobotMode, reason: string, ttlMs?: number): CodexStateChange {
    this.mode = mode;
    return ttlMs ? { mode, reason, ttlMs } : { mode, reason };
  }
}
