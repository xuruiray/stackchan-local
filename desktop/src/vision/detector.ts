import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

import type { NormalizedFaceBox } from "@stackchan-local/protocol";

import type { Logger } from "../config.js";

export interface CameraFrameInput {
  frameId: string;
  width: number;
  height: number;
  dataBase64: string;
}

export interface FaceDetectionResult {
  frameId: string;
  faces: NormalizedFaceBox[];
}

export interface FaceDetector {
  detect(frame: CameraFrameInput): Promise<FaceDetectionResult>;
  close(): void;
}

interface PendingRequest {
  resolve: (result: FaceDetectionResult) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class OpenCvSidecarFaceDetector implements FaceDetector {
  private child?: ChildProcessWithoutNullStreams;
  private stdout?: Interface;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(
    private readonly pythonCommand: string,
    private readonly scriptPath: string,
    private readonly logger: Logger,
    private readonly timeoutMs = 2000
  ) {}

  async detect(frame: CameraFrameInput): Promise<FaceDetectionResult> {
    this.ensureStarted();
    const child = this.child;
    if (!child || child.stdin.destroyed) {
      throw new Error("face detector sidecar is not running");
    }

    return new Promise<FaceDetectionResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(frame.frameId);
        reject(new Error(`face detector timed out for frame ${frame.frameId}`));
      }, this.timeoutMs);

      this.pending.set(frame.frameId, { resolve, reject, timeout });
      child.stdin.write(`${JSON.stringify(frame)}\n`, (error) => {
        if (!error) {
          return;
        }
        clearTimeout(timeout);
        this.pending.delete(frame.frameId);
        reject(error);
      });
    });
  }

  close(): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new Error("face detector sidecar closed"));
    }
    this.pending.clear();
    this.stdout?.close();
    this.child?.kill();
    this.child = undefined;
    this.stdout = undefined;
  }

  private ensureStarted(): void {
    if (this.child && !this.child.killed) {
      return;
    }

    const child = spawn(this.pythonCommand, [this.scriptPath], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child = child;
    this.stdout = createInterface({ input: child.stdout });

    this.stdout.on("line", (line) => this.handleLine(line));
    child.stderr.on("data", (chunk: Buffer) => {
      this.logger.warn("face detector stderr", { message: chunk.toString("utf8").trim() });
    });
    child.once("exit", (code, signal) => {
      this.logger.warn("face detector exited", { code, signal });
      this.rejectAll(new Error(`face detector exited with code ${code ?? "null"}`));
      this.child = undefined;
      this.stdout = undefined;
    });
    child.once("error", (error) => {
      this.logger.error("face detector failed to start", { error: error.message });
      this.rejectAll(error);
    });
  }

  private handleLine(line: string): void {
    let parsed: FaceDetectionResult | { error?: string; frameId?: string };
    try {
      parsed = JSON.parse(line) as FaceDetectionResult | { error?: string; frameId?: string };
    } catch {
      this.logger.warn("invalid face detector output", { line });
      return;
    }

    if (!parsed.frameId) {
      this.logger.warn("face detector output without frameId", { line });
      return;
    }

    const request = this.pending.get(parsed.frameId);
    if (!request) {
      return;
    }
    this.pending.delete(parsed.frameId);
    clearTimeout(request.timeout);

    if ("error" in parsed && parsed.error) {
      request.reject(new Error(parsed.error));
      return;
    }

    request.resolve({
      frameId: parsed.frameId,
      faces: "faces" in parsed && Array.isArray(parsed.faces) ? parsed.faces : []
    });
  }

  private rejectAll(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    this.pending.clear();
  }
}
