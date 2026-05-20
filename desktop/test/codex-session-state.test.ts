import { describe, expect, it } from "vitest";

import { CodexSessionStateMachine } from "../src/codex/session-state.js";

function entry(type: string, payload: Record<string, unknown>) {
  return {
    timestamp: new Date().toISOString(),
    type,
    payload
  };
}

describe("CodexSessionStateMachine", () => {
  it("enters thinking when a user message starts a turn", () => {
    const machine = new CodexSessionStateMachine();

    const change = machine.handleEntry(entry("event_msg", { type: "user_message", message: "do work" }));

    expect(change).toEqual({
      mode: "thinking",
      reason: "codex user message"
    });
  });

  it("briefly enters speaking when Codex writes a commentary message", () => {
    const machine = new CodexSessionStateMachine();

    machine.handleEntry(entry("event_msg", { type: "user_message", message: "do work" }));
    const change = machine.handleEntry(
      entry("event_msg", { type: "agent_message", phase: "commentary", message: "working on it" })
    );

    expect(change).toEqual({
      mode: "speaking",
      reason: "codex commentary",
      ttlMs: 2500
    });
  });

  it("returns to idle when the task completes", () => {
    const machine = new CodexSessionStateMachine();

    machine.handleEntry(entry("event_msg", { type: "user_message", message: "do work" }));
    const change = machine.handleEntry(entry("event_msg", { type: "task_complete" }));

    expect(change).toEqual({
      mode: "idle",
      reason: "codex task complete"
    });
  });

  it("enters error when a tool call exits with a non-zero code", () => {
    const machine = new CodexSessionStateMachine();

    const change = machine.handleEntry(
      entry("response_item", {
        type: "function_call_output",
        output: "Chunk ID: test\nProcess exited with code 2\nOutput:\nfailed\n"
      })
    );

    expect(change).toEqual({
      mode: "error",
      reason: "codex tool failed",
      ttlMs: 6000
    });
  });
});
