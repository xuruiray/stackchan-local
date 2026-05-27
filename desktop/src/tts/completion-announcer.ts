import type { DesktopConfig, Logger } from "../config.js";
import type { DeviceRegistry } from "../device/registry.js";
import type { RobotController } from "../robot/controller.js";
import type { TtsClient } from "./volcengine.js";

export interface CodexCompletionAnnouncement {
  id: string;
  reason: string;
  taskSummary?: string;
}

interface PendingPlayback {
  text: string;
  timer: NodeJS.Timeout;
}

export interface CompletionTtsRouteSnapshot {
  provider: "volcengine" | "disabled" | "unconfigured";
  configuredVoice: string;
  activeVoice: string;
  cloudEnabled: boolean;
  cloudConfigured: boolean;
  reason?: string;
}

export class CodexCompletionAnnouncer {
  private enabled = true;
  private lightEnabled = true;
  private lightFlashRun = 0;
  private inFlight = false;
  private lastStartedAt = 0;
  private readonly announcedIds: string[] = [];
  private readonly announcedIdSet = new Set<string>();
  private readonly pendingPlayback = new Map<string, PendingPlayback>();

  constructor(
    private readonly controller: RobotController,
    private readonly tts: TtsClient,
    private readonly logger: Logger,
    private readonly config: DesktopConfig,
    eventSource?: Pick<DeviceRegistry, "onEvent">
  ) {
    eventSource?.onEvent((message) => {
      if (message.event.kind !== "playback") {
        return;
      }
      void this.handlePlaybackEvent(message.event.requestId, message.event.state, message.event.message);
    });
  }

  announce(completion: CodexCompletionAnnouncement): void {
    if (this.hasAnnounced(completion.id)) {
      this.logger.debug("codex completion notification skipped by event id", {
        type: "system",
        reason: completion.reason,
        completionId: completion.id
      });
      return;
    }
    this.rememberCompletion(completion.id);

    if (this.lightEnabled) {
      void this.flashCompletionLights(completion);
    }

    if (!this.enabled) {
      this.logger.info("codex completion tts skipped because announcements are disabled", {
        type: "system",
        reason: completion.reason,
        completionId: completion.id,
        lightEnabled: this.lightEnabled
      });
      return;
    }

    if (!this.config.volcengineTtsEnabled) {
      this.logger.info("codex completion tts skipped because cloud tts is disabled", {
        type: "system",
        reason: completion.reason,
        completionId: completion.id,
        configuredVoice: this.config.volcengineTtsVoiceId
      });
      return;
    }
    if (!this.config.volcengineTtsApiKey) {
      this.logger.warn("codex completion tts skipped because api key is missing", {
        type: "system",
        reason: completion.reason,
        completionId: completion.id,
        configuredVoice: this.config.volcengineTtsVoiceId
      });
      return;
    }

    const now = Date.now();
    if (this.inFlight || now - this.lastStartedAt < this.config.volcengineTtsDebounceMs) {
      this.logger.debug("codex completion tts skipped by debounce", { type: "system", reason: completion.reason });
      return;
    }

    this.inFlight = true;
    this.lastStartedAt = now;
    void this.run(completion);
  }

  getVolume(): number {
    return this.config.volcengineTtsCompletionVolume;
  }

  getRouteSnapshot(): CompletionTtsRouteSnapshot {
    const cloudConfigured = Boolean(this.config.volcengineTtsApiKey);
    if (!this.enabled) {
      return {
        provider: "disabled",
        configuredVoice: this.config.volcengineTtsVoiceId,
        activeVoice: "-",
        cloudEnabled: this.config.volcengineTtsEnabled,
        cloudConfigured,
        reason: "codex completion tts disabled"
      };
    }
    if (this.config.volcengineTtsEnabled && cloudConfigured) {
      return {
        provider: "volcengine",
        configuredVoice: this.config.volcengineTtsVoiceId,
        activeVoice: this.config.volcengineTtsVoiceId,
        cloudEnabled: true,
        cloudConfigured: true
      };
    }
    return {
      provider: "unconfigured",
      configuredVoice: this.config.volcengineTtsVoiceId,
      activeVoice: "-",
      cloudEnabled: this.config.volcengineTtsEnabled,
      cloudConfigured,
      reason: this.config.volcengineTtsEnabled ? "cloud tts api key missing" : "cloud tts disabled"
    };
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isLightEnabled(): boolean {
    return this.lightEnabled;
  }

  setEnabled(enabled: boolean): boolean {
    this.enabled = enabled;
    this.logger.info("codex completion tts announcements updated", {
      type: "system",
      enabled
    });
    return this.enabled;
  }

  setLightEnabled(enabled: boolean): boolean {
    this.lightEnabled = enabled;
    if (!enabled) {
      this.lightFlashRun += 1;
    }
    this.logger.info("codex completion light notification updated", {
      type: "system",
      enabled
    });
    return this.lightEnabled;
  }

  setVolume(volume: number): number {
    const nextVolume = clampVolume(volume);
    this.config.volcengineTtsCompletionVolume = nextVolume;
    this.logger.info("codex completion tts volume updated", {
      type: "system",
      volume: nextVolume
    });
    return nextVolume;
  }

  private async flashCompletionLights(completion: CodexCompletionAnnouncement): Promise<void> {
    const runId = ++this.lightFlashRun;
    const steps: Array<{ color: string; holdMs: number }> = [
      { color: "#43D5B0", holdMs: 130 },
      { color: "#000000", holdMs: 90 },
      { color: "#6CB6FF", holdMs: 130 },
      { color: "#000000", holdMs: 90 },
      { color: "#E3B341", holdMs: 150 },
      { color: "#000000", holdMs: 0 }
    ];

    for (const [index, step] of steps.entries()) {
      if (!this.lightEnabled || runId !== this.lightFlashRun) {
        return;
      }
      try {
        const result = await this.controller.react(
          {
            emotion: "neutral",
            durationMs: 160,
            rgbJson: {
              leftRgbDuration: 0.04,
              leftRgbColor: step.color,
              rightRgbDuration: 0.04,
              rightRgbColor: step.color
            }
          },
          { waitForAck: false, bypassMotionGate: true }
        );
        if (index === 0) {
          this.logger.info("codex completion light dispatched", {
            type: "command",
            sent: result.sent,
            deviceId: result.deviceId,
            dispatchReason: result.reason,
            reason: completion.reason,
            completionId: completion.id
          });
        }
      } catch (error) {
        this.logger.warn("codex completion light failed", {
          type: "system",
          reason: completion.reason,
          completionId: completion.id,
          error: error instanceof Error ? error.message : String(error)
        });
        return;
      }
      if (step.holdMs > 0) {
        await delay(step.holdMs);
      }
    }
  }

  private async run(completion: CodexCompletionAnnouncement): Promise<void> {
    const text = buildCompletionText(this.config.volcengineTtsCompletionText, completion.taskSummary);
    try {
      const speech = await this.tts.synthesize(text);
      const result = await this.controller.playAudio({
        requestId: speech.requestId,
        format: speech.format,
        mimeType: speech.mimeType,
        sampleRate: speech.sampleRate,
        dataBase64: speech.dataBase64,
        text: speech.text,
        interrupt: true,
        volume: this.config.volcengineTtsCompletionVolume
      });
      this.logger.info("codex completion tts dispatched", {
        type: "command",
        sent: result.sent,
        deviceId: result.deviceId,
        dispatchReason: result.reason,
        reason: completion.reason,
        taskSummaryLength: completion.taskSummary?.length,
        volume: this.config.volcengineTtsCompletionVolume,
        requestId: speech.requestId,
        provider: "volcengine",
        voice: this.config.volcengineTtsVoiceId
      });
      if (result.sent && (!result.ack || result.ack.status === "accepted")) {
        this.waitForPlayback(speech.requestId, text);
      } else {
        this.logger.warn("codex completion tts audio command was not accepted", {
          type: "command",
          sent: result.sent,
          deviceId: result.deviceId,
          dispatchReason: result.reason,
          ack: result.ack,
          reason: completion.reason,
          requestId: speech.requestId,
          provider: "volcengine"
        });
      }
    } catch (error) {
      this.logger.warn("codex completion tts failed", {
        type: "system",
        reason: completion.reason,
        taskSummaryLength: completion.taskSummary?.length,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.inFlight = false;
    }
  }

  private waitForPlayback(requestId: string, text: string): void {
    const timeoutMs = estimateSpeechDurationMs(text) + 5000;
    const timer = setTimeout(() => {
      const pending = this.pendingPlayback.get(requestId);
      if (!pending) {
        return;
      }
      this.pendingPlayback.delete(requestId);
      this.logger.warn("playback finished event timed out", {
        type: "device",
        requestId,
        timeoutMs
      });
      void this.controller.setMode("idle", "codex completion tts timeout");
    }, timeoutMs);
    timer.unref?.();
    this.pendingPlayback.set(requestId, { text, timer });
  }

  private async handlePlaybackEvent(requestId: string, state: "started" | "finished" | "failed", message?: string): Promise<void> {
    const pending = this.pendingPlayback.get(requestId);
    if (!pending) {
      return;
    }

    if (state === "started") {
      return;
    }

    clearTimeout(pending.timer);
    this.pendingPlayback.delete(requestId);
    if (state === "finished") {
      await this.controller.setMode("idle", "codex completion tts done");
      return;
    }

    this.logger.warn("device playback failed", {
      type: "device",
      requestId,
      message
    });
    await this.controller.setMode("idle", "codex completion playback failed");
  }

  private hasAnnounced(id: string): boolean {
    return this.announcedIdSet.has(id);
  }

  private rememberCompletion(id: string): void {
    this.announcedIds.push(id);
    this.announcedIdSet.add(id);
    while (this.announcedIds.length > 200) {
      const removed = this.announcedIds.shift();
      if (removed) {
        this.announcedIdSet.delete(removed);
      }
    }
  }
}

function estimateSpeechDurationMs(text: string): number {
  return Math.max(1800, Math.min(12000, text.length * 260 + 700));
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return 80;
  }
  return Math.min(100, Math.max(0, Math.round(volume)));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildCompletionText(baseText: string, taskSummary: string | undefined): string {
  const summary = normalizeSpeechSummary(taskSummary);
  if (!summary) {
    return baseText;
  }

  const prefix = baseText.replace(/[。.!！\s]+$/u, "");
  return `${prefix}：${summary}。`;
}

function normalizeSpeechSummary(taskSummary: string | undefined): string {
  if (!taskSummary) {
    return "";
  }

  const normalized = taskSummary
    .replace(/[`*_>#\[\](){}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= 56) {
    return normalized;
  }
  return `${normalized.slice(0, 56)}...`;
}
