import { describe, expect, it } from "vitest";

import { createLogger } from "../src/config.js";
import { DeviceRegistry } from "../src/device/registry.js";
import { RobotController } from "../src/robot/controller.js";

describe("RobotController", () => {
  it("returns a useful result when no device is online", async () => {
    const logger = createLogger("error");
    const registry = new DeviceRegistry(logger);
    const controller = new RobotController(registry, logger);

    const result = await controller.say("hello");

    expect(result.sent).toBe(false);
    expect(result.reason).toBe("no online StackChan device");
    expect(result.command?.kind).toBe("say");
  });
});
