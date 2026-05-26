import { Buffer } from "node:buffer";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, normalize } from "node:path";

import type { RobotEmotion } from "@stackchan-local/protocol";

import type { Logger, LogLevel } from "../config.js";
import type { DebugLogBuffer, DebugLogType } from "../debug/log-buffer.js";
import type { DeviceRegistry } from "../device/registry.js";
import type { RobotActionResult, RobotController } from "../robot/controller.js";
import type {
  VisionTrackingService,
  RawPreviewSettingsPatch,
  VisionTrackingSettingsPatch
} from "../vision/tracking.js";
import type { AvatarExpressionPayload, CompletionTtsSnapshot, DebugSnapshot, PreviewSnapshot } from "./public-types.js";

const VISION_SNAPSHOT_BROADCAST_MIN_MS = 200;
const DEVICE_SNAPSHOT_BROADCAST_MIN_MS = 500;
const FRAME_STREAM_MAX_BUFFER_BYTES = 512 * 1024;
const previewUiDistDir = new URL("../../preview-ui/dist/", import.meta.url);
const previewUiIndexFile = new URL("index.html", previewUiDistDir);

export interface PreviewServerOptions {
  host: string;
  port: number;
}

export interface PreviewServerExtras {
  registry?: DeviceRegistry;
  debugLog?: DebugLogBuffer;
  robotController?: Pick<RobotController, "setRgb"> &
    Partial<Pick<RobotController, "react" | "moveHead" | "cameraStream" | "captureImage" | "telemetryConfig">>;
  completionAnnouncer?: {
    announce(completion: { id: string; reason: string; taskSummary?: string }): void;
    isEnabled(): boolean;
    setEnabled(enabled: boolean): boolean;
    isLightEnabled(): boolean;
    setLightEnabled(enabled: boolean): boolean;
    getVolume(): number;
    setVolume(volume: number): number;
  };
}

interface FrameStreamClientState {
  lastFrameId?: string;
  draining: boolean;
}

export class PreviewServer {
  private server?: Server;
  private loopbackIpv6Server?: Server;
  private unsubscribeVision?: () => void;
  private unsubscribeDevice?: () => void;
  private unsubscribeLog?: () => void;
  private readonly snapshotClients = new Set<ServerResponse>();
  private readonly logClients = new Set<ServerResponse>();
  private readonly rawFrameStreamClients = new Map<ServerResponse, FrameStreamClientState>();
  private readonly processedFrameStreamClients = new Map<ServerResponse, FrameStreamClientState>();
  private snapshotBroadcastTimer?: NodeJS.Timeout;
  private lastSnapshotBroadcastAt = 0;

  constructor(
    private readonly options: PreviewServerOptions,
    private readonly visionTracking: VisionTrackingService,
    private readonly logger: Logger,
    private readonly extras: PreviewServerExtras = {}
  ) {}

  async start(): Promise<number> {
    if (this.server) {
      return this.port();
    }

    this.server = createServer((request, response) => void this.handleRequest(request, response));
    this.unsubscribeVision = this.visionTracking.onPreviewUpdate(() => {
      this.broadcastFrameStreams();
      this.scheduleSnapshotBroadcast(VISION_SNAPSHOT_BROADCAST_MIN_MS);
    });
    this.unsubscribeDevice = this.extras.registry?.onEvent((message) => {
      if (message.event.kind !== "cameraFrame") {
        this.scheduleSnapshotBroadcast(DEVICE_SNAPSHOT_BROADCAST_MIN_MS);
      }
    });
    this.unsubscribeLog = this.extras.debugLog?.onEntry((entry) => this.broadcastLog(entry));
    await listenServer(this.server, this.options.port, this.options.host);
    await this.startLoopbackIpv6Alias();
    this.logger.info("preview server listening", {
      type: "system",
      host: this.options.host,
      port: this.port(),
      url: `http://${this.options.host === "0.0.0.0" ? "localhost" : this.options.host}:${this.port()}/`
    });
    return this.port();
  }

  async stop(): Promise<void> {
    this.unsubscribeVision?.();
    this.unsubscribeDevice?.();
    this.unsubscribeLog?.();
    this.unsubscribeVision = undefined;
    this.unsubscribeDevice = undefined;
    this.unsubscribeLog = undefined;
    if (this.snapshotBroadcastTimer) {
      clearTimeout(this.snapshotBroadcastTimer);
      this.snapshotBroadcastTimer = undefined;
    }

    for (const client of this.snapshotClients) {
      client.end();
    }
    this.snapshotClients.clear();
    for (const client of this.logClients) {
      client.end();
    }
    this.logClients.clear();
    for (const client of this.rawFrameStreamClients.keys()) {
      client.end();
    }
    this.rawFrameStreamClients.clear();
    for (const client of this.processedFrameStreamClients.keys()) {
      client.end();
    }
    this.processedFrameStreamClients.clear();

    await closeServer(this.loopbackIpv6Server);
    await closeServer(this.server);
    this.loopbackIpv6Server = undefined;
    this.server = undefined;
  }

  port(): number {
    const address = this.server?.address();
    if (!address || typeof address === "string") {
      return this.options.port;
    }
    return address.port;
  }

  private async startLoopbackIpv6Alias(): Promise<void> {
    if (!usesIpv4Loopback(this.options.host)) {
      return;
    }

    this.loopbackIpv6Server = createServer((request, response) => void this.handleRequest(request, response));
    try {
      await listenServer(this.loopbackIpv6Server, this.port(), "::1");
      this.logger.info("preview server IPv6 loopback alias listening", {
        type: "system",
        host: "::1",
        port: this.port(),
        url: `http://[::1]:${this.port()}/`
      });
    } catch (error) {
      this.logger.warn("preview IPv6 loopback alias unavailable", {
        type: "system",
        host: "::1",
        port: this.port(),
        error: error instanceof Error ? error.message : String(error)
      });
      await closeServer(this.loopbackIpv6Server);
      this.loopbackIpv6Server = undefined;
    }
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    try {
      if (request.method === "GET" && url.pathname === "/") {
        await this.sendPreviewIndex(response, request.method);
        return;
      }

      if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/assets/")) {
        await this.sendPreviewAsset(response, request.method, url.pathname);
        return;
      }

      if (request.method === "GET" && url.pathname === "/events") {
        this.handleSnapshotEvents(response);
        return;
      }

      if (request.method === "GET" && url.pathname === "/status") {
        this.sendJson(response, this.publicSnapshot());
        return;
      }

      if (request.method === "GET" && url.pathname === "/debug/snapshot") {
        this.sendJson(response, this.debugSnapshot());
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/completion-tts") {
        this.sendJson(response, this.completionTtsSnapshot());
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/rgb") {
        if (!this.extras.robotController) {
          this.sendJson(response, { ok: false, error: "robot controller unavailable" });
          return;
        }
        const body = await readBody(request);
        const parsed = body ? (JSON.parse(body) as { enabled?: unknown; color?: unknown; brightness?: unknown }) : {};
        const enabled = typeof parsed.enabled === "boolean" ? parsed.enabled : undefined;
        if (typeof enabled !== "boolean") {
          this.sendJson(response, { ok: false, error: "missing enabled" });
          return;
        }
        const color = sanitizeRgbColor(parsed.color);
        if (enabled && !color) {
          this.sendJson(response, { ok: false, error: "invalid color" });
          return;
        }
        const brightness = sanitizeRgbBrightness(parsed.brightness);
        if (parsed.brightness !== undefined && brightness === undefined) {
          this.sendJson(response, { ok: false, error: "invalid brightness" });
          return;
        }
        const result = await this.extras.robotController.setRgb({
          enabled,
          color: color ?? "#000000",
          brightness
        });
        this.sendJson(response, {
          ok: result.sent && (!result.ack || result.ack.status === "accepted"),
          sent: result.sent,
          reason: result.reason,
          ack: result.ack,
          color: color ?? "#000000",
          enabled,
          brightness
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/expression") {
        if (!this.extras.robotController?.react) {
          this.sendJson(response, { ok: false, error: "expression control unavailable" });
          return;
        }
        const body = await readBody(request);
        const parsed = body
          ? (JSON.parse(body) as {
              emotion?: unknown;
              durationMs?: unknown;
              flash?: unknown;
              rgbColor?: unknown;
              avatarJson?: unknown;
            })
          : {};
        const emotion = sanitizeRobotEmotion(parsed.emotion);
        if (!emotion) {
          this.sendJson(response, { ok: false, error: "invalid emotion" });
          return;
        }
        const avatarJson = parsed.avatarJson === undefined ? undefined : sanitizeAvatarExpression(parsed.avatarJson);
        if (parsed.avatarJson !== undefined && !avatarJson) {
          this.sendJson(response, { ok: false, error: "invalid avatarJson" });
          return;
        }
        const durationMs = sanitizeInteger(parsed.durationMs, 100, 10_000) ?? 2000;
        const rgbColor = sanitizeRgbColor(parsed.rgbColor);
        const flash = parsed.flash === true;
        if (flash && !rgbColor) {
          this.sendJson(response, { ok: false, error: "invalid rgbColor" });
          return;
        }
        const result = await this.extras.robotController.react(
          {
            emotion,
            durationMs,
            avatarJson,
            rgbJson: flash
              ? {
                  leftRgbDuration: 0.14,
                  leftRgbColor: rgbColor,
                  rightRgbDuration: 0.14,
                  rightRgbColor: rgbColor
                }
              : undefined
          },
          { waitForAck: true, waitForCompletion: false }
        );
        this.sendJson(response, {
          ...commandResponse(result),
          emotion,
          durationMs,
          flash,
          rgbColor: flash ? rgbColor : undefined,
          avatarJson
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/debug/logs") {
        this.sendJson(response, {
          logs: this.extras.debugLog?.list(parseLogFilter(url)) ?? []
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/debug/log-events") {
        this.handleLogEvents(response);
        return;
      }

      if (request.method === "GET" && url.pathname === "/frame.jpg") {
        this.sendFrame(response, "raw");
        return;
      }

      if (request.method === "GET" && (url.pathname === "/processed-frame.jpg" || url.pathname === "/face-frame.jpg")) {
        this.sendFrame(response, "processed");
        return;
      }

      if (request.method === "GET" && url.pathname === "/stream.mjpg") {
        this.handleFrameStream(response, "raw");
        return;
      }

      if (request.method === "GET" && (url.pathname === "/processed-stream.mjpg" || url.pathname === "/face-stream.mjpg")) {
        this.handleFrameStream(response, "processed");
        return;
      }

      if (request.method === "GET" && url.pathname === "/favicon.ico") {
        response.writeHead(204, { "cache-control": "public, max-age=86400" });
        response.end();
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/tracking") {
        const body = await readBody(request);
        const parsed = body ? (JSON.parse(body) as { enabled?: boolean; control?: VisionTrackingSettingsPatch }) : {};
        if (parsed.control) {
          this.visionTracking.setControl(parsed.control);
        }
        if (typeof parsed.enabled === "boolean") {
          this.visionTracking.setEnabled(parsed.enabled);
        }
        this.sendJson(response, this.publicSnapshot());
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/raw-preview") {
        const body = await readBody(request);
        const parsed = body
          ? (JSON.parse(body) as { enabled?: unknown; fps?: unknown; width?: unknown; height?: unknown; quality?: unknown })
          : {};
        if (typeof parsed.enabled !== "boolean") {
          this.sendJson(response, { ok: false, error: "missing enabled" });
          return;
        }
        const patch: RawPreviewSettingsPatch = {
          enabled: parsed.enabled,
          fps: sanitizeNumber(parsed.fps, 1, 15),
          width: 320,
          height: 240,
          quality: sanitizeNumber(parsed.quality, 1, 35)
        };
        this.visionTracking.setRawPreview(patch);
        this.sendJson(response, { ok: true, snapshot: this.publicSnapshot() });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/hardware/move-head") {
        if (!this.extras.robotController?.moveHead) {
          this.sendJson(response, { ok: false, error: "moveHead unavailable" });
          return;
        }
        const body = await readBody(request);
        const parsed = body ? (JSON.parse(body) as { yaw?: unknown; pitch?: unknown; speed?: unknown }) : {};
        const yaw = sanitizeNumber(parsed.yaw, -1800, 1800);
        const pitch = sanitizeNumber(parsed.pitch, -1200, 1200);
        const speed = sanitizeNumber(parsed.speed, 0, 1000);
        if (yaw === undefined || pitch === undefined) {
          this.sendJson(response, { ok: false, error: "invalid yaw or pitch" });
          return;
        }
        const result = await this.extras.robotController.moveHead(
          { yaw, pitch, speed },
          { waitForAck: true, waitForCompletion: false }
        );
        this.sendJson(response, commandResponse(result));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/hardware/camera-stream") {
        if (!this.extras.robotController?.cameraStream) {
          this.sendJson(response, { ok: false, error: "cameraStream unavailable" });
          return;
        }
        const body = await readBody(request);
        const parsed = body
          ? (JSON.parse(body) as { enabled?: unknown; fps?: unknown; width?: unknown; height?: unknown; quality?: unknown })
          : {};
        if (typeof parsed.enabled !== "boolean") {
          this.sendJson(response, { ok: false, error: "missing enabled" });
          return;
        }
        const result = await this.extras.robotController.cameraStream(
          {
            enabled: parsed.enabled,
            fps: sanitizeNumber(parsed.fps, 0, 30),
            width: 320,
            height: 240,
            quality: sanitizeNumber(parsed.quality, 1, 63),
            format: "jpeg"
          },
          { waitForAck: true, waitForCompletion: false }
        );
        this.sendJson(response, commandResponse(result));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/hardware/capture-image") {
        if (!this.extras.robotController?.captureImage) {
          this.sendJson(response, { ok: false, error: "captureImage unavailable" });
          return;
        }
        const result = await this.extras.robotController.captureImage(undefined, {
          waitForAck: true,
          waitForCompletion: false
        });
        this.sendJson(response, commandResponse(result));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/hardware/telemetry") {
        if (!this.extras.robotController?.telemetryConfig) {
          this.sendJson(response, { ok: false, error: "telemetryConfig unavailable" });
          return;
        }
        const body = await readBody(request);
        const parsed = body
          ? (JSON.parse(body) as {
              sensorSnapshotHz?: unknown;
              imuHz?: unknown;
              includeI2cScan?: unknown;
              reason?: unknown;
            })
          : {};
        const sensorSnapshotHz = sanitizeEnumNumber(parsed.sensorSnapshotHz, [0, 0.5, 1, 2] as const);
        const imuHz = sanitizeEnumNumber(parsed.imuHz, [0, 1, 2, 4, 10] as const);
        const result = await this.extras.robotController.telemetryConfig(
          {
            sensorSnapshotHz,
            imuHz,
            includeI2cScan: typeof parsed.includeI2cScan === "boolean" ? parsed.includeI2cScan : undefined,
            reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 120) : "preview-ui"
          },
          { waitForAck: true, waitForCompletion: false }
        );
        this.sendJson(response, commandResponse(result));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/completion-tts") {
        if (!this.extras.completionAnnouncer) {
          this.sendJson(response, { ok: false, error: "completion announcer unavailable" });
          return;
        }
        const body = await readBody(request);
        const parsed = body ? (JSON.parse(body) as { enabled?: boolean; lightEnabled?: boolean; volume?: number }) : {};
        let changed = false;
        let enabled: boolean | undefined;
        let lightEnabled: boolean | undefined;
        let volume: number | undefined;
        if (typeof parsed.enabled === "boolean") {
          enabled = this.extras.completionAnnouncer.setEnabled(parsed.enabled);
          changed = true;
        }
        if (typeof parsed.lightEnabled === "boolean") {
          lightEnabled = this.extras.completionAnnouncer.setLightEnabled(parsed.lightEnabled);
          changed = true;
        }
        if (typeof parsed.volume !== "undefined") {
          if (typeof parsed.volume !== "number" || !Number.isFinite(parsed.volume)) {
            this.sendJson(response, { ok: false, error: "invalid volume", ...this.completionTtsSnapshot() });
            return;
          }
          volume = this.extras.completionAnnouncer.setVolume(parsed.volume);
          changed = true;
        }
        if (!changed) {
          this.sendJson(response, { ok: false, error: "missing settings", ...this.completionTtsSnapshot() });
          return;
        }
        this.logger.info("preview completion tts settings updated", {
          type: "system",
          enabled,
          lightEnabled,
          volume
        });
        this.sendJson(response, { ok: true, ...this.completionTtsSnapshot() });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/completion-tts-test") {
        if (!this.extras.completionAnnouncer) {
          this.sendJson(response, { ok: false, error: "completion announcer unavailable" });
          return;
        }
        if (!this.extras.completionAnnouncer.isEnabled()) {
          this.sendJson(response, { ok: false, error: "completion announcer disabled", ...this.completionTtsSnapshot() });
          return;
        }
        const id = `preview-test-${Date.now()}`;
        this.extras.completionAnnouncer.announce({
          id,
          reason: "manual preview tts test",
          taskSummary: "调试播报"
        });
        this.sendJson(response, { ok: true, id });
        return;
      }

      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
    } catch (error) {
      this.logger.warn("preview request failed", {
        type: "system",
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error)
      });
      response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "bad_request" }));
    }
  }

  private async sendPreviewIndex(response: ServerResponse, method: string): Promise<void> {
    await this.sendStaticFile(response, method, previewUiIndexFile, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    });
  }

  private handleSnapshotEvents(response: ServerResponse): void {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive"
    });
    response.write(`data: ${JSON.stringify(this.publicSnapshot())}\n\n`);
    this.snapshotClients.add(response);
    response.on("close", () => this.snapshotClients.delete(response));
  }

  private handleLogEvents(response: ServerResponse): void {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive"
    });
    this.logClients.add(response);
    response.on("close", () => this.logClients.delete(response));
  }

  private sendJson(response: ServerResponse, value: unknown): void {
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    });
    response.end(JSON.stringify(value));
  }

  private sendFrame(response: ServerResponse, kind: "raw" | "processed"): void {
    const frame = this.frameForKind(kind);
    if (!frame) {
      response.writeHead(404, {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store"
      });
      response.end(kind === "processed" ? "no processed frame" : "no frame");
      return;
    }

    response.writeHead(200, {
      "content-type": frame.mimeType,
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      pragma: "no-cache",
      expires: "0",
      "x-frame-id": frame.frameId,
      "x-frame-timestamp": frame.timestamp,
      "x-frame-received-at": frame.receivedAt,
      ...(frame.sentAt ? { "x-frame-sent-at": frame.sentAt } : {}),
      ...(frame.captureTimestamp ? { "x-frame-capture-timestamp": frame.captureTimestamp } : {}),
      ...(frame.trace?.deviceEncodedAt ? { "x-frame-device-encoded-at": frame.trace.deviceEncodedAt } : {}),
      ...(frame.trace?.deviceQueuedAt ? { "x-frame-device-queued-at": frame.trace.deviceQueuedAt } : {}),
      ...(frame.trace?.deviceTxStartAt ? { "x-frame-device-tx-start-at": frame.trace.deviceTxStartAt } : {}),
      "x-frame-stream": kind,
      ...(frame.trace?.detectorFinishedAt ? { "x-detector-finished-at": frame.trace.detectorFinishedAt } : {})
    });
    response.end(Buffer.from(frame.dataBase64, "base64"));
  }

  private handleFrameStream(response: ServerResponse, kind: "raw" | "processed"): void {
    response.writeHead(200, {
      "content-type": "multipart/x-mixed-replace; boundary=stackchanframe",
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      pragma: "no-cache",
      expires: "0",
      "x-accel-buffering": "no",
      connection: "keep-alive",
      "x-frame-stream": kind
    });
    this.frameStreamClients(kind).set(response, { draining: false });
    this.writeFrameStream(response, kind);
    response.on("close", () => this.frameStreamClients(kind).delete(response));
  }

  private async sendPreviewAsset(response: ServerResponse, method: string, pathname: string): Promise<void> {
    const relative = normalize(pathname.slice(1));
    if (relative.startsWith("..") || relative.includes("/../")) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }
    await this.sendStaticFile(response, method, new URL(relative, previewUiDistDir));
  }

  private async sendStaticFile(
    response: ServerResponse,
    method: string,
    fileUrl: URL,
    headers: Record<string, string> = {}
  ): Promise<void> {
    try {
      const data = await readFile(fileUrl);
      response.writeHead(200, {
        "content-type": contentTypeFor(fileUrl.pathname),
        "cache-control": "public, max-age=31536000, immutable",
        ...headers
      });
      response.end(method === "HEAD" ? undefined : data);
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("preview UI has not been built; run npm run preview:build -w @stackchan-local/desktop");
    }
  }

  private publicSnapshot(): PreviewSnapshot {
    const snapshot = this.visionTracking.previewSnapshot();
    return {
      status: snapshot.status,
      faces: snapshot.faces,
      target: snapshot.target,
      frame: snapshot.frame
        ? {
            frameId: snapshot.frame.frameId,
            mimeType: snapshot.frame.mimeType,
            width: snapshot.frame.width,
            height: snapshot.frame.height,
            timestamp: snapshot.frame.timestamp,
            seq: snapshot.frame.seq,
            receivedAt: snapshot.frame.receivedAt,
            captureTimestamp: snapshot.frame.captureTimestamp,
            sentAt: snapshot.frame.sentAt,
            trace: snapshot.frame.trace
          }
        : undefined,
      devices: this.extras.registry?.listSnapshots(),
      completionTts: this.completionTtsSnapshot()
    };
  }

  private debugSnapshot(): DebugSnapshot {
    return {
      vision: this.publicSnapshot(),
      devices: this.extras.registry?.listSnapshots() ?? [],
      completionTts: this.completionTtsSnapshot(),
      logs: this.extras.debugLog?.list({ limit: 50 }) ?? []
    };
  }

  private completionTtsSnapshot(): CompletionTtsSnapshot {
    return {
      enabled: this.extras.completionAnnouncer?.isEnabled() ?? false,
      lightEnabled: this.extras.completionAnnouncer?.isLightEnabled() ?? false,
      volume: this.extras.completionAnnouncer?.getVolume() ?? 0
    };
  }

  private broadcastSnapshot(): void {
    const payload = `data: ${JSON.stringify(this.publicSnapshot())}\n\n`;
    for (const client of this.snapshotClients) {
      client.write(payload);
    }
    this.lastSnapshotBroadcastAt = Date.now();
  }

  private broadcastFrameStreams(): void {
    this.broadcastFrameStream("raw");
    this.broadcastFrameStream("processed");
  }

  private broadcastFrameStream(kind: "raw" | "processed"): void {
    const clients = this.frameStreamClients(kind);
    if (clients.size === 0) {
      return;
    }
    const frame = this.frameForKind(kind);
    if (!frame) {
      return;
    }
    for (const client of clients.keys()) {
      this.writeFrameStream(client, kind, frame);
    }
  }

  private writeFrameStream(
    response: ServerResponse,
    kind: "raw" | "processed",
    frame = this.frameForKind(kind)
  ): void {
    if (!frame || response.writableEnded || response.destroyed) {
      return;
    }
    const state = this.frameStreamClients(kind).get(response);
    if (!state) {
      return;
    }
    if (state.lastFrameId === frame.frameId) {
      return;
    }
    if (state.draining || response.writableLength > FRAME_STREAM_MAX_BUFFER_BYTES) {
      return;
    }

    const jpeg = Buffer.from(frame.dataBase64, "base64");
    const ok =
      response.write(
      `--stackchanframe\r\ncontent-type: ${frame.mimeType}\r\ncontent-length: ${jpeg.length}\r\nx-frame-id: ${frame.frameId}\r\nx-frame-timestamp: ${frame.timestamp}\r\nx-frame-received-at: ${frame.receivedAt}${
        frame.sentAt ? `\r\nx-frame-sent-at: ${frame.sentAt}` : ""
      }${frame.captureTimestamp ? `\r\nx-frame-capture-timestamp: ${frame.captureTimestamp}` : ""}${
        frame.trace?.deviceEncodedAt ? `\r\nx-frame-device-encoded-at: ${frame.trace.deviceEncodedAt}` : ""
      }${frame.trace?.deviceQueuedAt ? `\r\nx-frame-device-queued-at: ${frame.trace.deviceQueuedAt}` : ""}${
        frame.trace?.deviceTxStartAt ? `\r\nx-frame-device-tx-start-at: ${frame.trace.deviceTxStartAt}` : ""
      }\r\nx-frame-stream: ${kind}${
        frame.trace?.detectorFinishedAt ? `\r\nx-detector-finished-at: ${frame.trace.detectorFinishedAt}` : ""
      }\r\n\r\n`
      ) &&
      response.write(jpeg) &&
      response.write("\r\n");
    state.lastFrameId = frame.frameId;
    if (!ok) {
      state.draining = true;
      response.once("drain", () => {
        const current = this.frameStreamClients(kind).get(response);
        if (current) {
          current.draining = false;
        }
      });
    }
  }

  private frameStreamClients(kind: "raw" | "processed"): Map<ServerResponse, FrameStreamClientState> {
    return kind === "processed" ? this.processedFrameStreamClients : this.rawFrameStreamClients;
  }

  private frameForKind(kind: "raw" | "processed"): ReturnType<VisionTrackingService["previewSnapshot"]>["frame"] {
    const frame = this.visionTracking.previewSnapshot().frame;
    if (kind === "processed" && !frame?.trace?.detectorFinishedAt) {
      return undefined;
    }
    return frame;
  }

  private scheduleSnapshotBroadcast(minIntervalMs: number): void {
    if (this.snapshotClients.size === 0 || this.snapshotBroadcastTimer) {
      return;
    }

    const elapsed = Date.now() - this.lastSnapshotBroadcastAt;
    const delay = Math.max(0, minIntervalMs - elapsed);
    this.snapshotBroadcastTimer = setTimeout(() => {
      this.snapshotBroadcastTimer = undefined;
      this.broadcastSnapshot();
    }, delay);
  }

  private broadcastLog(entry: unknown): void {
    const payload = `data: ${JSON.stringify(entry)}\n\n`;
    for (const client of this.logClients) {
      client.write(payload);
    }
  }
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseLogFilter(url: URL): { limit?: number; level?: LogLevel; type?: DebugLogType; search?: string } {
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
  const levelParam = url.searchParams.get("level");
  const typeParam = url.searchParams.get("type");
  const search = url.searchParams.get("search") ?? undefined;
  return {
    limit: Number.isFinite(limit) ? limit : undefined,
    level: isLogLevel(levelParam) ? levelParam : undefined,
    type: isDebugLogType(typeParam) ? typeParam : undefined,
    search
  };
}

function isLogLevel(value: string | null): value is LogLevel {
  return value === "debug" || value === "info" || value === "warn" || value === "error";
}

function isDebugLogType(value: string | null): value is DebugLogType {
  return value === "system" || value === "device" || value === "vision" || value === "command";
}

function listenServer(server: Server, port: number, host: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function closeServer(server: Server | undefined): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (!server) {
      resolve();
      return;
    }
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function sanitizeRgbColor(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const color = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toUpperCase() : undefined;
}

function sanitizeRgbBrightness(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.min(1, Math.max(0, value));
}

const ROBOT_EMOTIONS = [
  "neutral",
  "happy",
  "laughing",
  "love",
  "sad",
  "crying",
  "angry",
  "thinking",
  "surprised",
  "sleepy",
  "doubtful"
] as const;

function sanitizeRobotEmotion(value: unknown): RobotEmotion | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return (ROBOT_EMOTIONS as readonly string[]).includes(value) ? (value as RobotEmotion) : undefined;
}

function sanitizeAvatarExpression(value: unknown): AvatarExpressionPayload | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const source = value as Record<string, unknown>;
  const leftEye = sanitizeAvatarExpressionItem(source.leftEye);
  const rightEye = sanitizeAvatarExpressionItem(source.rightEye);
  const mouth = sanitizeAvatarExpressionItem(source.mouth);
  if (!leftEye || !rightEye || !mouth) {
    return undefined;
  }
  return {
    type: "bleAvatar",
    leftEye,
    rightEye,
    mouth
  };
}

function sanitizeAvatarExpressionItem(value: unknown): AvatarExpressionPayload["leftEye"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const source = value as Record<string, unknown>;
  return {
    x: sanitizeInteger(source.x, -100, 100) ?? 0,
    y: sanitizeInteger(source.y, -100, 100) ?? 0,
    rotation: sanitizeInteger(source.rotation, -1800, 1800) ?? 0,
    weight: sanitizeInteger(source.weight, 0, 100) ?? 0,
    size: sanitizeInteger(source.size, -100, 100) ?? 0
  };
}

function sanitizeNumber(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.min(max, Math.max(min, value));
}

function sanitizeInteger(value: unknown, min: number, max: number): number | undefined {
  const number = sanitizeNumber(value, min, max);
  return number === undefined ? undefined : Math.round(number);
}

function sanitizeEnumNumber<const T extends readonly number[]>(value: unknown, allowed: T): T[number] | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return allowed.includes(value) ? (value as T[number]) : undefined;
}

function commandResponse(result: RobotActionResult): Record<string, unknown> {
  return {
    ok: result.sent && (!result.ack || result.ack.status === "accepted"),
    sent: result.sent,
    reason: result.reason,
    ack: result.ack,
    completion: result.completion,
    command: result.command,
    motion: result.motion
  };
}

function contentTypeFor(pathname: string): string {
  switch (extname(pathname)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function usesIpv4Loopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost";
}
