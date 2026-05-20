import { open, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { RobotMode } from "@stackchan-local/protocol";

import type { Logger } from "../config.js";
import type { RobotController } from "../robot/controller.js";
import { CodexSessionStateMachine, type CodexLogEntry, type CodexStateChange } from "./session-state.js";

export interface CodexSessionWatcherOptions {
  sessionsRoot: string;
  pollMs: number;
  latestScanMs?: number;
  onCompletion?: (event: CodexCompletionEvent) => void;
}

interface SessionFileCandidate {
  path: string;
  mtimeMs: number;
}

export interface CodexCompletionEvent {
  id: string;
  change: CodexStateChange;
  filePath: string;
  offset: number;
  taskSummary?: string;
}

export class CodexSessionWatcher {
  private readonly machine = new CodexSessionStateMachine();
  private currentFile?: string;
  private offset = 0;
  private pending = "";
  private pollTimer?: NodeJS.Timeout;
  private resumeTimer?: NodeJS.Timeout;
  private retryTimer?: NodeJS.Timeout;
  private lastLatestScanAt = 0;
  private lastSentMode?: RobotMode;
  private pendingChange?: CodexStateChange;
  private currentTaskSummary?: string;
  private running = false;

  constructor(
    private readonly controller: RobotController,
    private readonly logger: Logger,
    private readonly options: CodexSessionWatcherOptions
  ) {}

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    void this.tick();
    this.pollTimer = setInterval(() => void this.tick(), this.options.pollMs);
    this.pollTimer.unref?.();
    this.logger.info("codex session watcher started", {
      sessionsRoot: this.options.sessionsRoot,
      pollMs: this.options.pollMs
    });
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = undefined;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
  }

  private async tick(): Promise<void> {
    if (!this.running) {
      return;
    }

    if (this.currentFile) {
      const readSucceeded = await this.readNewLines(this.currentFile).then(
        () => true,
        (error: unknown) => {
          this.logger.debug("codex session read failed", {
            filePath: this.currentFile,
            error: error instanceof Error ? error.message : String(error)
          });
          this.currentFile = undefined;
          return false;
        }
      );
      if (readSucceeded && Date.now() - this.lastLatestScanAt < (this.options.latestScanMs ?? 30_000)) {
        return;
      }
    }

    const latest = await this.findLatestSessionFile(this.options.sessionsRoot).catch((error: unknown) => {
      this.logger.debug("codex session scan failed", { error: error instanceof Error ? error.message : String(error) });
      return undefined;
    });
    this.lastLatestScanAt = Date.now();
    if (!latest) {
      return;
    }

    if (latest !== this.currentFile) {
      await this.initializeFile(latest);
      return;
    }

    await this.readNewLines(latest);
  }

  private async initializeFile(filePath: string): Promise<void> {
    const content = await readFile(filePath, "utf8");
    this.currentFile = filePath;
    this.offset = Buffer.byteLength(content);
    this.pending = "";
    this.currentTaskSummary = undefined;

    let lastChange: CodexStateChange | undefined;
    for (const line of content.split(/\r?\n/)) {
      const change = this.processLine(line);
      if (change) {
        lastChange = change;
      }
    }

    if (lastChange) {
      this.applyChange(lastChange, { announceCompletion: false });
    }

    this.logger.info("codex session watcher attached", { filePath });
  }

  private async readNewLines(filePath: string): Promise<void> {
    const fileStat = await stat(filePath);
    if (fileStat.size < this.offset) {
      await this.initializeFile(filePath);
      return;
    }
    if (fileStat.size === this.offset) {
      return;
    }

    const previousOffset = this.offset;
    const length = fileStat.size - this.offset;
    const buffer = Buffer.alloc(length);
    const file = await open(filePath, "r");
    try {
      await file.read(buffer, 0, length, this.offset);
    } finally {
      await file.close();
    }
    this.offset = fileStat.size;

    const previousPendingBytes = Buffer.byteLength(this.pending);
    const text = this.pending + buffer.toString("utf8");
    const lines = text.split(/\r?\n/);
    this.pending = text.endsWith("\n") ? "" : (lines.pop() ?? "");

    let lineOffset = Math.max(0, previousOffset - previousPendingBytes);
    for (const line of lines) {
      const currentLineOffset = lineOffset;
      lineOffset += Buffer.byteLength(line) + 1;
      const change = this.processLine(line);
      if (change) {
        this.applyChange(change, {
          completionEvent: isCompletionChange(change)
            ? {
                id: `${filePath}:${currentLineOffset}`,
                change,
                filePath,
                offset: currentLineOffset,
                taskSummary: this.currentTaskSummary
              }
            : undefined
        });
      }
    }
  }

  private processLine(line: string): CodexStateChange | undefined {
    if (!line.trim()) {
      return undefined;
    }

    let entry: CodexLogEntry;
    try {
      entry = JSON.parse(line) as CodexLogEntry;
    } catch {
      return undefined;
    }
    const taskSummary = extractUserTaskSummary(entry);
    if (taskSummary) {
      this.currentTaskSummary = taskSummary;
    }
    return this.machine.handleEntry(entry);
  }

  private applyChange(
    change: CodexStateChange,
    options: { announceCompletion?: boolean; completionEvent?: CodexCompletionEvent } = {}
  ): void {
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = undefined;
    }

    if (this.lastSentMode !== change.mode) {
      void this.dispatchModeChange(change);
    }

    if (change.ttlMs) {
      this.resumeTimer = setTimeout(() => this.applyChange(this.machine.resumeAfterTemporary()), change.ttlMs);
      this.resumeTimer.unref?.();
    }

    if (options.announceCompletion !== false && options.completionEvent) {
      this.options.onCompletion?.(options.completionEvent);
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer || !this.pendingChange) {
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      const change = this.pendingChange;
      if (change) {
        this.applyChange(change, { announceCompletion: false });
      }
    }, 1000);
    this.retryTimer.unref?.();
  }

  private async dispatchModeChange(change: CodexStateChange): Promise<void> {
    const result = await this.controller.setMode(change.mode, change.reason);
    const accepted = result.sent && (!result.ack || result.ack.status === "accepted");
    this.logger.info("codex state dispatched", {
      mode: change.mode,
      reason: change.reason,
      sent: result.sent,
      ack: result.ack,
      deviceId: result.deviceId,
      dispatchReason: result.reason
    });
    if (accepted) {
      this.lastSentMode = change.mode;
      this.pendingChange = undefined;
      return;
    }

    this.pendingChange = change;
    this.scheduleRetry();
  }

  private async findLatestSessionFile(root: string): Promise<string | undefined> {
    const candidates: SessionFileCandidate[] = [];
    await this.collectSessionFiles(root, candidates);
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return candidates[0]?.path;
  }

  private async collectSessionFiles(dir: string, candidates: SessionFileCandidate[]): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await this.collectSessionFiles(fullPath, candidates);
          return;
        }
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
          return;
        }
        const fileStat = await stat(fullPath);
        candidates.push({ path: fullPath, mtimeMs: fileStat.mtimeMs });
      })
    );
  }
}

function isCompletionChange(change: CodexStateChange): boolean {
  return change.mode === "idle" && (change.reason === "codex final answer" || change.reason === "codex task complete");
}

function extractUserTaskSummary(entry: CodexLogEntry): string | undefined {
  if (entry.type !== "event_msg" || entry.payload?.type !== "user_message") {
    return undefined;
  }
  const message = entry.payload.message;
  if (typeof message !== "string") {
    return undefined;
  }
  return normalizeUserTaskMessage(message);
}

function normalizeUserTaskMessage(message: string): string | undefined {
  let text = message.replace(/\\n/g, "\n").replace(/<environment_context>[\s\S]*?<\/environment_context>/g, " ");
  const requestMarker = "## My request for Codex:";
  const markerIndex = text.lastIndexOf(requestMarker);
  if (markerIndex >= 0) {
    text = text.slice(markerIndex + requestMarker.length);
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("# In app browser"))
    .filter((line) => !line.startsWith("- The user has"))
    .filter((line) => !line.startsWith("- Current URL:"));
  if (lines.length === 0) {
    return undefined;
  }

  const first = stripMarkdownHeading(lines[0]);
  const second = stripMarkdownHeading(lines[1] ?? "");
  const summary =
    /^please implement this plan:?$/i.test(first) && second ? `${first}: ${second}` : first;
  const normalized = summary.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.length > 120 ? `${normalized.slice(0, 120)}...` : normalized;
}

function stripMarkdownHeading(line: string): string {
  return line.replace(/^#+\s*/, "").trim();
}
