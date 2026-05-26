import { useEffect, useState } from "react";

export interface MjpegFrame {
  objectUrl: string;
  frameId?: string;
  timestamp?: string;
  captureTimestamp?: string;
  deviceSentAt?: string;
  daemonReceivedAt?: string;
  detectorFinishedAt?: string;
  mimeType: string;
  byteLength: number;
  receivedAt: string;
}

export interface MjpegStreamState {
  connected: boolean;
  frame?: MjpegFrame;
  error?: string;
}

type ByteBuffer = Uint8Array<ArrayBufferLike>;

const boundaryBytes = new TextEncoder().encode("--stackchanframe\r\n");
const headerEndBytes = new TextEncoder().encode("\r\n\r\n");
const textDecoder = new TextDecoder();

export function useMjpegStream(src: string): MjpegStreamState {
  const [state, setState] = useState<MjpegStreamState>({ connected: false });

  useEffect(() => {
    const controller = new AbortController();
    let activeObjectUrl: string | undefined;

    async function readStream(): Promise<void> {
      let buffer: ByteBuffer = new Uint8Array();
      const response = await fetch(src, {
        cache: "no-store",
        signal: controller.signal
      });
      if (!response.ok || !response.body) {
        throw new Error(`stream failed: ${response.status}`);
      }
      setState((current) => ({ ...current, connected: true, error: undefined }));
      const reader = response.body.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        if (!value) {
          continue;
        }
        buffer = appendBytes(buffer, value);
        const parsed = consumeFrames(buffer, (frameBytes, headers) => {
          const mimeType = headers.get("content-type") ?? "image/jpeg";
          const objectUrl = URL.createObjectURL(new Blob([copyBytes(frameBytes)], { type: mimeType }));
          const nextFrame: MjpegFrame = {
            objectUrl,
            frameId: headers.get("x-frame-id") ?? undefined,
            timestamp: headers.get("x-frame-timestamp") ?? undefined,
            captureTimestamp: headers.get("x-frame-capture-timestamp") ?? headers.get("x-frame-timestamp") ?? undefined,
            deviceSentAt: headers.get("x-frame-sent-at") ?? undefined,
            daemonReceivedAt: headers.get("x-frame-received-at") ?? undefined,
            detectorFinishedAt: headers.get("x-detector-finished-at") ?? undefined,
            mimeType,
            byteLength: frameBytes.byteLength,
            receivedAt: new Date().toISOString()
          };
          setState((current) => {
            if (current.frame?.objectUrl) {
              URL.revokeObjectURL(current.frame.objectUrl);
            }
            activeObjectUrl = objectUrl;
            return { connected: true, frame: nextFrame, error: undefined };
          });
        });
        buffer = parsed;
      }
    }

    readStream().catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setState((current) => ({
          ...current,
          connected: false,
          error: error instanceof Error ? error.message : String(error)
        }));
      }
    });

    return () => {
      controller.abort();
      if (activeObjectUrl) {
        URL.revokeObjectURL(activeObjectUrl);
      }
    };
  }, [src]);

  return state;
}

function consumeFrames(buffer: ByteBuffer, onFrame: (frameBytes: ByteBuffer, headers: Map<string, string>) => void): ByteBuffer {
  let remaining = buffer;
  while (true) {
    const boundaryIndex = indexOfBytes(remaining, boundaryBytes);
    if (boundaryIndex < 0) {
      return remaining.length > boundaryBytes.length ? remaining.slice(remaining.length - boundaryBytes.length) : remaining;
    }
    if (boundaryIndex > 0) {
      remaining = remaining.slice(boundaryIndex);
    }

    const headerEndIndex = indexOfBytes(remaining, headerEndBytes);
    if (headerEndIndex < 0) {
      return remaining;
    }

    const headerText = textDecoder.decode(remaining.slice(boundaryBytes.length, headerEndIndex));
    const headers = parseHeaders(headerText);
    const contentLength = Number(headers.get("content-length"));
    if (!Number.isFinite(contentLength) || contentLength <= 0) {
      return remaining.slice(headerEndIndex + headerEndBytes.length);
    }

    const bodyStart = headerEndIndex + headerEndBytes.length;
    let nextStart = bodyStart + contentLength;
    if (remaining.length < nextStart + 2) {
      return remaining;
    }
    const frameBytes = remaining.slice(bodyStart, nextStart);
    if (remaining[nextStart] === 13 && remaining[nextStart + 1] === 10) {
      nextStart += 2;
    }
    onFrame(frameBytes, headers);
    remaining = remaining.slice(nextStart);
  }
}

function parseHeaders(source: string): Map<string, string> {
  const headers = new Map<string, string>();
  for (const line of source.split("\r\n")) {
    const separator = line.indexOf(":");
    if (separator > 0) {
      headers.set(line.slice(0, separator).toLowerCase(), line.slice(separator + 1).trim());
    }
  }
  return headers;
}

function appendBytes(left: ByteBuffer, right: ByteBuffer): ByteBuffer {
  const next = new Uint8Array(left.byteLength + right.byteLength);
  next.set(left, 0);
  next.set(right, left.byteLength);
  return next;
}

function copyBytes(source: ByteBuffer): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy;
}

function indexOfBytes(source: ByteBuffer, target: ByteBuffer): number {
  if (target.byteLength === 0 || source.byteLength < target.byteLength) {
    return -1;
  }
  for (let i = 0; i <= source.byteLength - target.byteLength; i++) {
    let matched = true;
    for (let j = 0; j < target.byteLength; j++) {
      if (source[i + j] !== target[j]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return i;
    }
  }
  return -1;
}
