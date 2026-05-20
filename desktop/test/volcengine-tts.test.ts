import { describe, expect, it } from "vitest";

import type { DesktopConfig } from "../src/config.js";
import { parseVolcengineChunks } from "../src/tts/volcengine.js";
import { VolcengineTtsClient } from "../src/tts/volcengine.js";

describe("Volcengine TTS response parsing", () => {
  it("parses SSE audio chunks", () => {
    const chunks = parseVolcengineChunks(
      [
        'event: message\ndata: {"code":0,"message":"","data":"T2dn"}',
        'event: message\ndata: {"code":0,"message":"","data":"Uw=="}'
      ].join("\n\n")
    );

    expect(chunks).toEqual([
      { code: 0, message: "", data: "T2dn" },
      { code: 0, message: "", data: "Uw==" }
    ]);
  });

  it("parses newline-delimited JSON chunks", () => {
    const chunks = parseVolcengineChunks('{"code":0,"data":"T2dn"}\n{"code":0,"data":"Uw=="}');

    expect(chunks).toEqual([
      { code: 0, data: "T2dn" },
      { code: 0, data: "Uw==" }
    ]);
  });

  it("aborts timed out synthesis requests", async () => {
    const previousFetch = globalThis.fetch;
    let capturedSignal: AbortSignal | undefined;
    globalThis.fetch = ((_url, init) => {
      capturedSignal = init?.signal as AbortSignal;
      return new Promise<Response>(() => undefined);
    }) as typeof fetch;

    const client = new VolcengineTtsClient(
      {
        volcengineTtsApiKey: "token",
        volcengineTtsEndpoint: "https://example.test/tts",
        volcengineTtsResourceId: "seed-tts-2.0",
        volcengineTtsVoiceId: "voice",
        volcengineTtsSampleRate: 16000,
        volcengineTtsTimeoutMs: 5
      } as DesktopConfig,
      { debug() {}, info() {}, warn() {}, error() {} }
    );

    try {
      await expect(client.synthesize("done")).rejects.toThrow("timed out");
      expect(capturedSignal?.aborted).toBe(true);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
