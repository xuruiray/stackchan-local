import type { DesktopConfig, Logger } from "../config.js";

export interface SynthesizedSpeech {
  requestId: string;
  format: "ogg_opus";
  mimeType: "audio/ogg";
  sampleRate: 16000 | 24000;
  dataBase64: string;
  text: string;
}

export interface TtsClient {
  synthesize(text: string): Promise<SynthesizedSpeech>;
}

type VolcengineChunk = {
  code?: number;
  message?: string;
  data?: string | null;
};

export class VolcengineTtsClient implements TtsClient {
  constructor(
    private readonly config: DesktopConfig,
    private readonly logger: Logger
  ) {}

  async synthesize(text: string): Promise<SynthesizedSpeech> {
    if (!this.config.volcengineTtsApiKey) {
      throw new Error("VOLCENGINE_TTS_API_KEY is not configured");
    }

    const apiKey = this.config.volcengineTtsApiKey;
    const requestId = crypto.randomUUID();
    const abortController = new AbortController();
    const { response, body } = await withTimeout(
      async () => {
        const response = await fetch(this.config.volcengineTtsEndpoint, {
          method: "POST",
          signal: abortController.signal,
          headers: {
            "content-type": "application/json",
            "X-Api-Key": apiKey,
            "X-Api-Resource-Id": this.config.volcengineTtsResourceId,
            "X-Api-Request-Id": requestId
          },
          body: JSON.stringify({
            user: {
              uid: "stackchan-local"
            },
            namespace: "BidirectionalTTS",
            req_params: {
              text,
              speaker: this.config.volcengineTtsVoiceId,
              audio_params: {
                format: "ogg_opus",
                sample_rate: this.config.volcengineTtsSampleRate
              }
            }
          })
        });
        return {
          response,
          body: await response.text()
        };
      },
      this.config.volcengineTtsTimeoutMs,
      abortController
    );
    if (!response.ok) {
      throw new Error(`Volcengine TTS failed with HTTP ${response.status}: ${body.slice(0, 240)}`);
    }

    const chunks = parseVolcengineChunks(body);
    const audioChunks: string[] = [];
    for (const chunk of chunks) {
      if (chunk.code !== undefined && !isSuccessCode(chunk.code)) {
        throw new Error(`Volcengine TTS failed with code ${chunk.code}: ${chunk.message ?? "unknown error"}`);
      }
      if (chunk.data) {
        audioChunks.push(chunk.data);
      }
    }

    if (audioChunks.length === 0) {
      throw new Error("Volcengine TTS returned no audio data");
    }

    const audio = Buffer.concat(audioChunks.map((chunk) => Buffer.from(chunk, "base64")));
    this.logger.info("volcengine tts synthesized", {
      type: "system",
      requestId,
      textLength: text.length,
      audioBytes: audio.byteLength,
      resourceId: this.config.volcengineTtsResourceId,
      voiceId: this.config.volcengineTtsVoiceId
    });

    return {
      requestId,
      format: "ogg_opus",
      mimeType: "audio/ogg",
      sampleRate: this.config.volcengineTtsSampleRate,
      dataBase64: audio.toString("base64"),
      text
    };
  }
}

async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  abortController: AbortController
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          abortController.abort();
          reject(new Error(`Volcengine TTS timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        timeout.unref?.();
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function isSuccessCode(code: number): boolean {
  return code === 0 || code === 20_000_000;
}

export function parseVolcengineChunks(body: string): VolcengineChunk[] {
  const chunks: VolcengineChunk[] = [];
  const trimmed = body.trim();
  if (!trimmed) {
    return chunks;
  }

  for (const event of trimmed.split(/\n\n+/)) {
    const dataLines = event
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim())
      .filter((line) => line && line !== "[DONE]");
    for (const line of dataLines) {
      chunks.push(JSON.parse(line) as VolcengineChunk);
    }
  }

  if (chunks.length > 0) {
    return chunks;
  }

  for (const line of trimmed.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    chunks.push(JSON.parse(line) as VolcengineChunk);
  }
  return chunks;
}
