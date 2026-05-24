import { Buffer } from "node:buffer";
import { createRequire } from "node:module";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Logger, LogLevel } from "../config.js";
import type { DebugLogBuffer, DebugLogType } from "../debug/log-buffer.js";
import type { DeviceRegistry } from "../device/registry.js";
import type { RobotController } from "../robot/controller.js";
import type {
  VisionPreviewSnapshot,
  VisionTrackingService,
  VisionTrackingSettingsPatch
} from "../vision/tracking.js";
import { renderPreviewHtml } from "./ui.js";

const require = createRequire(import.meta.url);
const threeBuildDir = dirname(require.resolve("three"));
const threeVendorFiles = new Set(["three.module.js", "three.core.js"]);
const VISION_SNAPSHOT_BROADCAST_MIN_MS = 200;
const DEVICE_SNAPSHOT_BROADCAST_MIN_MS = 500;
const FRAME_STREAM_MAX_BUFFER_BYTES = 512 * 1024;

export interface PreviewServerOptions {
  host: string;
  port: number;
}

export interface PreviewServerExtras {
  registry?: DeviceRegistry;
  debugLog?: DebugLogBuffer;
  robotController?: Pick<RobotController, "setRgb">;
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

type PublicVisionSnapshot = Omit<VisionPreviewSnapshot, "frame"> & {
  frame?: Omit<NonNullable<VisionPreviewSnapshot["frame"]>, "dataBase64">;
};

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
  private readonly frameStreamClients = new Map<ServerResponse, FrameStreamClientState>();
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
      this.broadcastFrameStream();
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
    for (const client of this.frameStreamClients.keys()) {
      client.end();
    }
    this.frameStreamClients.clear();

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
        this.sendHtml(response);
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
        this.sendFrame(response);
        return;
      }

      if (request.method === "GET" && url.pathname === "/stream.mjpg") {
        this.handleFrameStream(response);
        return;
      }

      if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/vendor/")) {
        await this.sendVendorModule(response, request.method, url.pathname);
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

  private sendHtml(response: ServerResponse): void {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    });
    response.end(renderPreviewHtml(this.publicSnapshot()));
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

  private sendFrame(response: ServerResponse): void {
    const frame = this.visionTracking.previewSnapshot().frame;
    if (!frame) {
      response.writeHead(404, {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store"
      });
      response.end("no frame");
      return;
    }

    response.writeHead(200, {
      "content-type": frame.mimeType,
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      pragma: "no-cache",
      expires: "0",
      "x-frame-id": frame.frameId,
      "x-frame-timestamp": frame.timestamp
    });
    response.end(Buffer.from(frame.dataBase64, "base64"));
  }

  private handleFrameStream(response: ServerResponse): void {
    response.writeHead(200, {
      "content-type": "multipart/x-mixed-replace; boundary=stackchanframe",
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      pragma: "no-cache",
      expires: "0",
      "x-accel-buffering": "no",
      connection: "keep-alive"
    });
    this.frameStreamClients.set(response, { draining: false });
    this.writeFrameStream(response);
    response.on("close", () => this.frameStreamClients.delete(response));
  }

  private async sendVendorModule(response: ServerResponse, method: string, pathname: string): Promise<void> {
    const filename = pathname.slice("/vendor/".length);
    if (!threeVendorFiles.has(filename)) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }

    const source = await readFile(join(threeBuildDir, filename), "utf8");
    response.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "public, max-age=3600"
    });
    response.end(method === "HEAD" ? undefined : source);
  }

  private publicSnapshot(): PublicVisionSnapshot & {
    devices?: ReturnType<DeviceRegistry["listSnapshots"]>;
    completionTts?: { enabled: boolean; lightEnabled: boolean; volume: number };
  } {
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

  private debugSnapshot(): unknown {
    return {
      vision: this.publicSnapshot(),
      devices: this.extras.registry?.listSnapshots() ?? [],
      completionTts: this.completionTtsSnapshot(),
      logs: this.extras.debugLog?.list({ limit: 50 }) ?? []
    };
  }

  private completionTtsSnapshot(): { enabled: boolean; lightEnabled: boolean; volume: number } {
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

  private broadcastFrameStream(): void {
    if (this.frameStreamClients.size === 0) {
      return;
    }
    const frame = this.visionTracking.previewSnapshot().frame;
    if (!frame) {
      return;
    }
    for (const client of this.frameStreamClients.keys()) {
      this.writeFrameStream(client, frame);
    }
  }

  private writeFrameStream(
    response: ServerResponse,
    frame = this.visionTracking.previewSnapshot().frame
  ): void {
    if (!frame || response.writableEnded || response.destroyed) {
      return;
    }
    const state = this.frameStreamClients.get(response);
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
      `--stackchanframe\r\ncontent-type: ${frame.mimeType}\r\ncontent-length: ${jpeg.length}\r\nx-frame-id: ${frame.frameId}\r\nx-frame-timestamp: ${frame.timestamp}\r\n\r\n`
      ) &&
      response.write(jpeg) &&
      response.write("\r\n");
    state.lastFrameId = frame.frameId;
    if (!ok) {
      state.draining = true;
      response.once("drain", () => {
        const current = this.frameStreamClients.get(response);
        if (current) {
          current.draining = false;
        }
      });
    }
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

function usesIpv4Loopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost";
}
