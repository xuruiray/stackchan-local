import type { LogEntryInput, LogLevel } from "../config.js";

export type DebugLogType = "system" | "device" | "vision" | "command";

export interface DebugLogEntry extends LogEntryInput {
  id: number;
  type: DebugLogType;
  context?: Record<string, unknown>;
}

export interface DebugLogFilter {
  limit?: number;
  level?: LogLevel;
  type?: DebugLogType;
  search?: string;
}

export type DebugLogListener = (entry: DebugLogEntry) => void;

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export class DebugLogBuffer {
  private nextId = 1;
  private readonly entries: DebugLogEntry[] = [];
  private readonly listeners = new Set<DebugLogListener>();

  constructor(private readonly capacity = 500) {}

  append(input: LogEntryInput): void {
    const entry: DebugLogEntry = {
      id: this.nextId++,
      time: input.time,
      level: input.level,
      message: input.message,
      type: classifyLog(input.message, input.context),
      context: sanitizeContext(input.context)
    };

    this.entries.push(entry);
    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity);
    }

    for (const listener of this.listeners) {
      listener(entry);
    }
  }

  list(filter: DebugLogFilter = {}): DebugLogEntry[] {
    const minimum = filter.level ? LEVEL_ORDER[filter.level] : undefined;
    const search = filter.search?.trim().toLowerCase();
    let entries = this.entries.filter((entry) => {
      if (minimum !== undefined && LEVEL_ORDER[entry.level] < minimum) {
        return false;
      }
      if (filter.type && entry.type !== filter.type) {
        return false;
      }
      if (search) {
        const haystack = `${entry.message} ${JSON.stringify(entry.context ?? {})}`.toLowerCase();
        if (!haystack.includes(search)) {
          return false;
        }
      }
      return true;
    });

    const limit = Math.max(1, Math.min(filter.limit ?? 200, this.capacity));
    entries = entries.slice(-limit);
    return entries;
  }

  onEntry(listener: DebugLogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function classifyLog(message: string, context?: Record<string, unknown>): DebugLogType {
  const explicitType = context?.type;
  if (explicitType === "device" || explicitType === "vision" || explicitType === "command") {
    return explicitType;
  }
  if (message.includes("device") || message.includes("websocket") || message.includes("pairing")) {
    return "device";
  }
  if (message.includes("face tracking") || message.includes("detector")) {
    return "vision";
  }
  if (message.includes("command")) {
    return "command";
  }
  return "system";
}

function sanitizeContext(context: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!context) {
    return undefined;
  }
  return sanitizeValue(context, 0) as Record<string, unknown>;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 4) {
    return "[truncated]";
  }
  if (typeof value === "string") {
    if (value.length > 240) {
      return `${value.slice(0, 120)}...[${value.length} chars]`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (key.toLowerCase().includes("base64") || key.toLowerCase().includes("database64")) {
        next[key] = "[redacted]";
      } else {
        next[key] = sanitizeValue(child, depth + 1);
      }
    }
    return next;
  }
  return value;
}
