import { describe, expect, it } from "vitest";

import { createLogger, type LogEntryInput } from "../src/config.js";
import { DeviceRegistry } from "../src/device/registry.js";
import { RobotController } from "../src/robot/controller.js";

describe("RobotController logging", () => {
  it("includes safe command details for tracking debug logs", async () => {
    const entries: LogEntryInput[] = [];
    const logger = createLogger("info", (entry) => entries.push(entry));
    const registry = new DeviceRegistry(logger);
    const controller = new RobotController(registry, logger);

    await controller.trackFace({
      detected: true,
      centerX: 0.4,
      centerY: 0.6,
      confidence: 0.68,
      speed: 420
    }, { waitForAck: false });

    const commandEntries = entries.filter((entry) => entry.message === "robot command dispatched");
    expect(commandEntries[0]?.context).toMatchObject({
      kind: "trackFace",
      detected: true,
      centerX: 0.4,
      centerY: 0.6,
      confidence: 0.68,
      speed: 420
    });
  });

  it("does not write audio payloads to command logs", async () => {
    const entries: LogEntryInput[] = [];
    const logger = createLogger("info", (entry) => entries.push(entry));
    const sentMessages: unknown[] = [];
    const listeners: Array<(message: unknown) => void> = [];
    const registry = {
      listSnapshots: () => [],
      sendToActiveDevice: (message: unknown) => {
        sentMessages.push(message);
        const commandMessage = message as { commandId: string; command: { kind: string; requestId?: string } };
        queueMicrotask(() => {
          for (const listener of listeners) {
            listener({
              type: "robot.event",
              eventId: `ack-${commandMessage.commandId}`,
              deviceId: "stackchan-001",
              timestamp: new Date().toISOString(),
              event: {
                kind: "commandAck",
                commandId: commandMessage.commandId,
                commandKind: commandMessage.command.kind,
                requestId: commandMessage.command.requestId,
                status: "accepted"
              }
            });
          }
        });
        return { sent: true, deviceId: "stackchan-001", commandId: commandMessage.commandId };
      },
      onEvent: (listener: (message: unknown) => void) => {
        listeners.push(listener);
        return () => {}
      }
    } as unknown as DeviceRegistry;
    const controller = new RobotController(registry, logger);

    await controller.playAudio({
      requestId: "audio-1",
      format: "ogg_opus",
      mimeType: "audio/ogg",
      sampleRate: 16000,
      dataBase64: Buffer.from("fake ogg data").toString("base64"),
      text: "done",
      interrupt: true,
      volume: 93.6
    });

    expect(sentMessages.map((message) => (message as { command: { kind: string } }).command.kind)).toEqual([
      "trackFace",
      "playAudioStart",
      "playAudioChunk",
      "playAudioEnd"
    ]);
    expect(entries.map((entry) => entry.context?.kind)).toEqual([
      "trackFace",
      "playAudioStart",
      "playAudioChunk",
      "playAudioEnd"
    ]);
    expect((sentMessages[1] as { command: { volume: number } }).command.volume).toBe(94);
    expect(entries[1]?.context?.volume).toBe(94);
    expect(JSON.stringify(entries.map((entry) => entry.context))).not.toContain("ZmFrZSBvZ2cgZGF0YQ==");
  });
});
