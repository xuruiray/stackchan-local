import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import type { Logger } from "../config.js";
import type { RobotController } from "../robot/controller.js";
import type { VisionTrackingService } from "../vision/tracking.js";

function jsonText(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

export async function startMcpServer(
  controller: RobotController,
  logger: Logger,
  visionTracking?: VisionTrackingService
): Promise<void> {
  const server = new McpServer({
    name: "stackchan-local",
    version: "0.1.0"
  });

  server.registerTool(
    "stackchan_status",
    {
      title: "StackChan status",
      description: "Return connected StackChan devices and the active local robot state.",
      inputSchema: {}
    },
    async () => jsonText(controller.status())
  );

  server.registerTool(
    "stackchan_say",
    {
      title: "Make StackChan speak",
      description: "Send text to the active StackChan device.",
      inputSchema: {
        text: z.string().min(1),
        interrupt: z.boolean().optional(),
        voice: z.string().optional()
      }
    },
    async ({ text, interrupt, voice }) => jsonText(await controller.say(text, { interrupt, voice }))
  );

  server.registerTool(
    "stackchan_react",
    {
      title: "Set StackChan expression",
      description: "Send an emotion and optional avatar/RGB JSON to StackChan.",
      inputSchema: {
        emotion: z.enum(["neutral", "happy", "sad", "angry", "surprised", "sleepy", "thinking", "love"]),
        durationMs: z.number().int().positive().optional(),
        avatarJson: z.record(z.unknown()).optional(),
        rgbJson: z.record(z.unknown()).optional()
      }
    },
    async (input) => jsonText(await controller.react(input))
  );

  server.registerTool(
    "stackchan_move_head",
    {
      title: "Move StackChan head",
      description: "Move the active StackChan device head by yaw and pitch.",
      inputSchema: {
        yaw: z.number().min(-90).max(90),
        pitch: z.number().min(-45).max(45),
        speed: z.number().nonnegative().optional()
      }
    },
    async (input) => jsonText(await controller.moveHead(input))
  );

  server.registerTool(
    "stackchan_play_animation",
    {
      title: "Play StackChan animation",
      description: "Send a StackChan keyframe sequence to the active device.",
      inputSchema: {
        sequence: z.array(z.unknown()),
        loop: z.boolean().optional()
      }
    },
    async ({ sequence, loop }) => jsonText(await controller.playAnimation(sequence, loop ?? false))
  );

  server.registerTool(
    "stackchan_capture_image",
    {
      title: "Capture StackChan image",
      description: "Ask the active StackChan device to capture a JPEG image.",
      inputSchema: {
        requestId: z.string().optional()
      }
    },
    async ({ requestId }) => jsonText(await controller.captureImage(requestId))
  );

  server.registerTool(
    "stackchan_set_mode",
    {
      title: "Set StackChan mode",
      description: "Set the local robot UI state.",
      inputSchema: {
        mode: z.enum(["idle", "connecting", "listening", "thinking", "speaking", "pairing", "sleeping", "error"]),
        reason: z.string().optional()
      }
    },
    async ({ mode, reason }) => jsonText(await controller.setMode(mode, reason))
  );

  server.registerTool(
    "stackchan_face_tracking",
    {
      title: "Control StackChan face tracking",
      description: "Enable, disable, or inspect local face tracking from the StackChan camera.",
      inputSchema: {
        enabled: z.boolean().optional(),
        control: z
          .object({
            speed: z.number().min(0).max(1000).optional(),
            control: z
              .object({
                deadband: z.number().min(0).max(0.3).optional(),
                yaw: z
                  .object({
                    kp: z.number().min(0).max(150).optional(),
                    ki: z.number().min(0).max(50).optional(),
                    kd: z.number().min(0).max(80).optional()
                  })
                  .optional(),
                pitch: z
                  .object({
                    kp: z.number().min(0).max(150).optional(),
                    ki: z.number().min(0).max(50).optional(),
                    kd: z.number().min(0).max(80).optional()
                  })
                  .optional(),
                integralLimit: z.number().min(0).max(2).optional(),
                outputLimitDeg: z.number().min(1).max(45).optional()
              })
              .optional()
          })
          .optional()
      }
    },
    async ({ enabled, control }) => {
      if (!visionTracking) {
        return jsonText({ enabled: false, detectorAvailable: false, reason: "vision tracking service unavailable" });
      }
      if (control) {
        visionTracking.setControl(control);
      }
      if (typeof enabled === "boolean") {
        return jsonText(visionTracking.setEnabled(enabled));
      }
      return jsonText(visionTracking.status());
    }
  );

  await server.connect(new StdioServerTransport());
  logger.info("mcp stdio server started");
}
