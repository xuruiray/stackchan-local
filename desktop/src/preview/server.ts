import { Buffer } from "node:buffer";
import { createRequire } from "node:module";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Logger, LogLevel } from "../config.js";
import type { DebugLogBuffer, DebugLogType } from "../debug/log-buffer.js";
import type { DeviceRegistry } from "../device/registry.js";
import type {
  VisionPreviewSnapshot,
  VisionTrackingService,
  VisionTrackingSettingsPatch
} from "../vision/tracking.js";
import { renderPreviewHtml } from "./ui.js";

const require = createRequire(import.meta.url);
const threeBuildDir = dirname(require.resolve("three"));
const threeVendorFiles = new Set(["three.module.js", "three.core.js"]);

export interface PreviewServerOptions {
  host: string;
  port: number;
}

export interface PreviewServerExtras {
  registry?: DeviceRegistry;
  debugLog?: DebugLogBuffer;
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

export class PreviewServer {
  private server?: Server;
  private unsubscribeVision?: () => void;
  private unsubscribeLog?: () => void;
  private readonly snapshotClients = new Set<ServerResponse>();
  private readonly logClients = new Set<ServerResponse>();

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
    this.unsubscribeVision = this.visionTracking.onPreviewUpdate(() => this.broadcastSnapshot());
    this.unsubscribeLog = this.extras.debugLog?.onEntry((entry) => this.broadcastLog(entry));
    await new Promise<void>((resolve) => this.server?.listen(this.options.port, this.options.host, resolve));
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
    this.unsubscribeLog?.();
    this.unsubscribeVision = undefined;
    this.unsubscribeLog = undefined;

    for (const client of this.snapshotClients) {
      client.end();
    }
    this.snapshotClients.clear();
    for (const client of this.logClients) {
      client.end();
    }
    this.logClients.clear();

    await new Promise<void>((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    this.server = undefined;
  }

  port(): number {
    const address = this.server?.address();
    if (!address || typeof address === "string") {
      return this.options.port;
    }
    return address.port;
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
      "cache-control": "no-store"
    });
    response.end(Buffer.from(frame.dataBase64, "base64"));
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
            timestamp: snapshot.frame.timestamp
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
