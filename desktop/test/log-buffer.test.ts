import { describe, expect, it } from "vitest";

import { DebugLogBuffer } from "../src/debug/log-buffer.js";

describe("DebugLogBuffer", () => {
  it("redacts sensitive context values before exposing logs", () => {
    const buffer = new DebugLogBuffer(10);

    buffer.append({
      time: new Date(0).toISOString(),
      level: "info",
      message: "device pairing",
      context: {
        pairingToken: "real-token",
        password: "wifi-password",
        nested: {
          apiKey: "provider-key",
          dataBase64: "abcdef"
        }
      }
    });

    expect(buffer.list()).toEqual([
      expect.objectContaining({
        context: {
          pairingToken: "[redacted]",
          password: "[redacted]",
          nested: {
            apiKey: "[redacted]",
            dataBase64: "[redacted]"
          }
        }
      })
    ]);
  });
});
