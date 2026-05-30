import type {
  FaceTrackingControl,
  NormalizedFaceBox,
  RobotCommand,
  RobotCommandMessage,
  RobotEventMessage,
  RobotEmotion,
  RobotMode
} from "@stackchan-local/protocol";

import type { Logger } from "../config.js";
import type { CommandDispatchResult, DeviceRegistry, DeviceSnapshot } from "../device/registry.js";
import { MotionArbitrator, type MotionArbitrationSnapshot } from "./motion-arbitrator.js";

const AUDIO_CHUNK_BYTES = 4096;
const MAX_AUDIO_BYTES = 262_144;
const DEFAULT_ACK_TIMEOUT_MS = 1500;
const DEFAULT_COMPLETION_TIMEOUT_MS = 3000;
const AUDIO_ACK_TIMEOUT_MS = 2500;
const CAMERA_STREAM_ACK_TIMEOUT_MS = 5000;
const MANUAL_MOTION_HOLD_MS = 2500;
const ANIMATION_MOTION_HOLD_MS = 10_000;
const AUDIO_MOTION_HOLD_MS = 20_000;
const FACE_TRACKING_HOLD_MS = 900;

export interface CommandAckResult {
  received: boolean;
  status: "accepted" | "rejected" | "timeout";
  message?: string;
  requestId?: string;
}

export interface CommandStatusResult {
  received: boolean;
  status: "started" | "completed" | "failed" | "cancelled" | "timeout";
  message?: string;
  requestId?: string;
  progress?: number;
}

export interface RobotActionResult extends CommandDispatchResult {
  command?: RobotCommand;
  ack?: CommandAckResult;
  completion?: CommandStatusResult;
  motion?: MotionArbitrationSnapshot;
}

export interface DispatchOptions {
  waitForAck?: boolean;
  ackTimeoutMs?: number;
  waitForCompletion?: boolean;
  completionTimeoutMs?: number;
  bypassMotionGate?: boolean;
}

interface PendingAck {
  resolve: (ack: CommandAckResult) => void;
  timer: NodeJS.Timeout;
}

interface PendingCompletion {
  resolve: (status: CommandStatusResult) => void;
  timer: NodeJS.Timeout;
}

export class RobotController {
  private readonly pendingAcks = new Map<string, PendingAck>();
  private readonly pendingCompletions = new Map<string, PendingCompletion>();
  private readonly motion = new MotionArbitrator();
  private commandSeq = 0;

  constructor(
    private readonly registry: DeviceRegistry,
    private readonly logger: Logger
  ) {
    this.registry.onEvent((message) => this.handleDeviceEvent(message));
  }

  status(): { devices: DeviceSnapshot[]; activeDevice?: DeviceSnapshot; motion: MotionArbitrationSnapshot } {
    const devices = this.registry.listSnapshots();
    return {
      devices,
      activeDevice: devices.find((device) => device.status === "online"),
      motion: this.motion.snapshot()
    };
  }

  say(
    text: string,
    options: { interrupt?: boolean; voice?: string } = {},
    dispatchOptions?: DispatchOptions
  ): Promise<RobotActionResult> {
    return this.dispatch({ kind: "say", text, ...options }, dispatchOptions);
  }

  react(options: {
    emotion: RobotEmotion;
    durationMs?: number;
    avatarJson?: Record<string, unknown>;
    rgbJson?: Record<string, unknown>;
  }, dispatchOptions?: DispatchOptions): Promise<RobotActionResult> {
    return this.dispatch({ kind: "react", ...options }, dispatchOptions);
  }

  async moveHead(options: { yaw: number; pitch: number; speed?: number }, dispatchOptions?: DispatchOptions): Promise<RobotActionResult> {
    this.motion.reserve("manual", MANUAL_MOTION_HOLD_MS, "manual moveHead command");
    await this.suspendFaceTracking("manual moveHead command");
    return this.dispatch({ kind: "moveHead", ...options }, dispatchOptions);
  }

  cameraStream(
    options: { enabled: boolean; fps?: number; width?: number; height?: number; quality?: number; format?: "jpeg" },
    dispatchOptions?: DispatchOptions
  ): Promise<RobotActionResult> {
    return this.dispatch(
      { kind: "cameraStream", ...options, format: options.format ?? "jpeg" },
      { ackTimeoutMs: CAMERA_STREAM_ACK_TIMEOUT_MS, ...dispatchOptions }
    );
  }

  trackFace(options: {
    detected: boolean;
    centerX?: number;
    centerY?: number;
    bbox?: NormalizedFaceBox;
    confidence?: number;
    speed?: number;
    control?: FaceTrackingControl;
    reason?: string;
  }, dispatchOptions: DispatchOptions = { waitForAck: false }): Promise<RobotActionResult> {
    if (!dispatchOptions.bypassMotionGate) {
      const block = this.motion.blockFor("faceTracking");
      if (block.blocked) {
        return Promise.resolve({
          sent: false,
          reason: `motion reserved by ${block.owner}: ${block.reason}`,
          command: { kind: "trackFace", ...options },
          motion: this.motion.snapshot()
        });
      }
    }
    if (options.detected) {
      this.motion.reserve("faceTracking", FACE_TRACKING_HOLD_MS, "face tracking target");
    } else {
      this.motion.release("faceTracking");
    }
    return this.dispatch({ kind: "trackFace", ...options }, dispatchOptions);
  }

  async playAnimation(sequence: unknown[], loop = false, dispatchOptions?: DispatchOptions): Promise<RobotActionResult> {
    this.motion.reserve("animation", loop ? 60_000 : ANIMATION_MOTION_HOLD_MS, "playAnimation command");
    await this.suspendFaceTracking("playAnimation command");
    return this.dispatch({ kind: "playAnimation", sequence, loop }, dispatchOptions);
  }

  async playAudio(options: {
    requestId?: string;
    format: "ogg_opus";
    mimeType: "audio/ogg";
    sampleRate: 16000 | 24000;
    dataBase64: string;
    text?: string;
    interrupt?: boolean;
    volume?: number;
  }): Promise<RobotActionResult> {
    const requestId = options.requestId ?? crypto.randomUUID();
    const audio = Buffer.from(options.dataBase64, "base64");
    if (audio.byteLength === 0) {
      throw new Error("audio payload is empty");
    }
    if (audio.byteLength > MAX_AUDIO_BYTES) {
      throw new Error(`audio payload is too large: ${audio.byteLength} bytes`);
    }

    const chunks = splitAudioChunks(audio);
    this.motion.reserve("audio", AUDIO_MOTION_HOLD_MS, "playAudio command");
    await this.suspendFaceTracking("playAudio command");

    const startResult = await this.dispatch({
      kind: "playAudioStart",
      requestId,
      format: options.format,
      mimeType: options.mimeType,
      sampleRate: options.sampleRate,
      totalBytes: audio.byteLength,
      totalChunks: chunks.length,
      text: options.text,
      interrupt: options.interrupt,
      volume: sanitizeVolume(options.volume)
    }, { ackTimeoutMs: AUDIO_ACK_TIMEOUT_MS });
    if (!isAccepted(startResult)) {
      this.motion.release("audio");
      return startResult;
    }

    for (const [chunkIndex, chunk] of chunks.entries()) {
      const chunkResult = await this.dispatch({
        kind: "playAudioChunk",
        requestId,
        chunkIndex,
        dataBase64: chunk.toString("base64")
      }, { ackTimeoutMs: AUDIO_ACK_TIMEOUT_MS });
      if (!isAccepted(chunkResult)) {
        this.motion.release("audio");
        return chunkResult;
      }
    }

    const endResult = await this.dispatch({
      kind: "playAudioEnd",
      requestId
    }, { ackTimeoutMs: AUDIO_ACK_TIMEOUT_MS });
    if (!isAccepted(endResult)) {
      this.motion.release("audio");
    }
    return endResult;
  }

  captureImage(requestId: string = crypto.randomUUID(), dispatchOptions?: DispatchOptions): Promise<RobotActionResult> {
    return this.dispatch({ kind: "captureImage", requestId, format: "jpeg" }, dispatchOptions);
  }

  setMode(mode: RobotMode, reason?: string, dispatchOptions?: DispatchOptions): Promise<RobotActionResult> {
    return this.dispatch({ kind: "setMode", mode, reason }, dispatchOptions);
  }

  setRgb(
    options: { enabled: boolean; color?: string; brightness?: number },
    dispatchOptions?: DispatchOptions
  ): Promise<RobotActionResult> {
    return this.dispatch({ kind: "setRgb", ...options }, dispatchOptions);
  }

  telemetryConfig(
    options: { hardwareStatusHz?: 0 | 0.5 | 1 | 2; includeI2cScan?: boolean; reason?: string },
    dispatchOptions?: DispatchOptions
  ): Promise<RobotActionResult> {
    return this.dispatch({ kind: "telemetryConfig", ...options }, dispatchOptions);
  }

  mediaFlowControl(
    options: { stream: "camera"; creditFrames: number; maxInFlight?: number; reason?: string },
    dispatchOptions: DispatchOptions = { waitForAck: false }
  ): Promise<RobotActionResult> {
    return this.dispatch({ kind: "mediaFlowControl", ...options }, dispatchOptions);
  }

  private async dispatch(command: RobotCommand, options: DispatchOptions = {}): Promise<RobotActionResult> {
    const message: RobotCommandMessage = {
      type: "robot.command",
      seq: this.nextCommandSeq(),
      commandId: crypto.randomUUID(),
      command
    };
    const shouldWaitForAck = options.waitForAck !== false;
    const shouldWaitForCompletion = options.waitForCompletion === true;
    const ackPromise = shouldWaitForAck
      ? this.waitForAck(message.commandId, options.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS)
      : undefined;
    const completionPromise = shouldWaitForCompletion
      ? this.waitForCompletion(message.commandId, options.completionTimeoutMs ?? DEFAULT_COMPLETION_TIMEOUT_MS)
      : undefined;
    const result = this.registry.sendToActiveDevice(message);
    const logCommandDispatch =
      command.kind === "mediaFlowControl" || (command.kind === "trackFace" && command.detected)
        ? this.logger.debug
        : this.logger.info;
    logCommandDispatch.call(this.logger, "robot command dispatched", {
      type: "command",
      sent: result.sent,
      commandId: message.commandId,
      kind: command.kind,
      ...summarizeCommand(command),
      deviceId: result.deviceId,
      dispatchReason: result.reason,
      waitForAck: shouldWaitForAck,
      waitForCompletion: shouldWaitForCompletion,
      seq: message.seq
    });

    if (!result.sent) {
      this.cancelPendingAck(message.commandId);
      this.cancelPendingCompletion(message.commandId);
      return {
        ...result,
        command,
        motion: this.motion.snapshot()
      };
    }

    const ack = ackPromise ? await ackPromise : undefined;
    const completion = completionPromise ? await completionPromise : undefined;
    return {
      ...result,
      command,
      ack,
      completion,
      motion: this.motion.snapshot()
    };
  }

  private async suspendFaceTracking(reason: string): Promise<void> {
    this.motion.release("faceTracking");
    await this.dispatch(
      {
        kind: "trackFace",
        detected: false,
        reason,
        speed: 0
      },
      { waitForAck: false, bypassMotionGate: true }
    );
  }

  private waitForAck(commandId: string, timeoutMs: number): Promise<CommandAckResult> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingAcks.delete(commandId);
        resolve({
          received: false,
          status: "timeout",
          message: `command ack timed out after ${timeoutMs}ms`
        });
      }, timeoutMs);
      timer.unref?.();
      this.pendingAcks.set(commandId, { resolve, timer });
    });
  }

  private cancelPendingAck(commandId: string): void {
    const pending = this.pendingAcks.get(commandId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pendingAcks.delete(commandId);
  }

  private waitForCompletion(commandId: string, timeoutMs: number): Promise<CommandStatusResult> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingCompletions.delete(commandId);
        resolve({
          received: false,
          status: "timeout",
          message: `command completion timed out after ${timeoutMs}ms`
        });
      }, timeoutMs);
      timer.unref?.();
      this.pendingCompletions.set(commandId, { resolve, timer });
    });
  }

  private cancelPendingCompletion(commandId: string): void {
    const pending = this.pendingCompletions.get(commandId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pendingCompletions.delete(commandId);
  }

  private handleDeviceEvent(message: RobotEventMessage): void {
    if (message.event.kind === "commandAck") {
      const pending = this.pendingAcks.get(message.event.commandId);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timer);
      this.pendingAcks.delete(message.event.commandId);
      pending.resolve({
        received: true,
        status: message.event.status,
        message: message.event.message,
        requestId: message.event.requestId
      });
      return;
    }

    if (message.event.kind === "commandStatus") {
      this.logger.debug("robot command status received", {
        type: "command",
        commandId: message.event.commandId,
        kind: message.event.commandKind,
        status: message.event.status,
        progress: message.event.progress,
        message: message.event.message
      });
      const terminal =
        message.event.status === "completed" ||
        message.event.status === "failed" ||
        message.event.status === "cancelled";
      if (terminal) {
        const pending = this.pendingCompletions.get(message.event.commandId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingCompletions.delete(message.event.commandId);
          pending.resolve({
            received: true,
            status: message.event.status,
            message: message.event.message,
            requestId: message.event.requestId,
            progress: message.event.progress
          });
        }
      }
      return;
    }

    if (message.event.kind === "playback") {
      if (message.event.state === "started") {
        this.motion.reserve("audio", AUDIO_MOTION_HOLD_MS, "device playback active");
        return;
      }
      this.motion.release("audio");
    }
  }

  private nextCommandSeq(): number {
    this.commandSeq = (this.commandSeq + 1) % Number.MAX_SAFE_INTEGER;
    return this.commandSeq;
  }
}

function isAccepted(result: RobotActionResult): boolean {
  return result.sent && (!result.ack || result.ack.status === "accepted");
}

function summarizeCommand(command: RobotCommand): Record<string, unknown> {
  switch (command.kind) {
    case "trackFace":
      return {
        detected: command.detected,
        centerX: command.centerX,
        centerY: command.centerY,
        confidence: command.confidence,
        speed: command.speed,
        reason: command.reason
      };
    case "cameraStream":
      return {
        enabled: command.enabled,
        fps: command.fps,
        format: command.format
      };
    case "setMode":
      return {
        mode: command.mode,
        reason: command.reason
      };
    case "setRgb":
      return {
        enabled: command.enabled,
        color: command.color,
        brightness: command.brightness
      };
    case "telemetryConfig":
      return {
        hardwareStatusHz: command.hardwareStatusHz,
        includeI2cScan: command.includeI2cScan,
        reason: command.reason
      };
    case "mediaFlowControl":
      return {
        stream: command.stream,
        creditFrames: command.creditFrames,
        maxInFlight: command.maxInFlight,
        reason: command.reason
      };
    case "moveHead":
      return {
        yaw: command.yaw,
        pitch: command.pitch,
        speed: command.speed
      };
    case "say":
      return {
        textLength: command.text.length,
        interrupt: command.interrupt,
        voice: command.voice
      };
    case "react":
      return {
        emotion: command.emotion,
        durationMs: command.durationMs
      };
    case "captureImage":
      return {
        requestId: command.requestId,
        format: command.format
      };
    case "playAnimation":
      return {
        frames: command.sequence.length,
        loop: command.loop
      };
    case "playAudioStart":
      return {
        requestId: command.requestId,
        format: command.format,
        sampleRate: command.sampleRate,
        audioBytes: command.totalBytes,
        totalChunks: command.totalChunks,
        textLength: command.text?.length,
        interrupt: command.interrupt,
        volume: command.volume
      };
    case "playAudioChunk":
      return {
        requestId: command.requestId,
        chunkIndex: command.chunkIndex,
        chunkBytes: Buffer.byteLength(command.dataBase64, "base64")
      };
    case "playAudioEnd":
      return {
        requestId: command.requestId
      };
  }
}

function sanitizeVolume(volume: number | undefined): number | undefined {
  if (typeof volume !== "number" || !Number.isFinite(volume)) {
    return undefined;
  }
  return Math.min(100, Math.max(0, Math.round(volume)));
}

function splitAudioChunks(audio: Buffer): Buffer[] {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < audio.byteLength; offset += AUDIO_CHUNK_BYTES) {
    chunks.push(audio.subarray(offset, Math.min(offset + AUDIO_CHUNK_BYTES, audio.byteLength)));
  }
  return chunks;
}
