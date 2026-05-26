import { useMemo, useState } from "react";

import type { PreviewSnapshot } from "../../../src/preview/public-types";
import { useMjpegStream, type MjpegFrame } from "../hooks/useMjpegStream";
import { dash } from "../model/format";

type CameraFrame = NonNullable<PreviewSnapshot["frame"]>;
type CameraStreamKind = "raw" | "processed";
type DisplayedFrame = MjpegFrame & { displayedAt: string };

function timestampMs(value: unknown): number | undefined {
  if (typeof value !== "string" || !value) {
    return undefined;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

function deltaMs(start: unknown, end: unknown): number | undefined {
  const startMs = timestampMs(start);
  const endMs = timestampMs(end);
  if (startMs === undefined || endMs === undefined) {
    return undefined;
  }
  const delta = endMs - startMs;
  return delta >= 0 ? delta : undefined;
}

function firstFinite(...values: Array<number | undefined>): number | undefined {
  return values.find((value) => typeof value === "number" && Number.isFinite(value));
}

function frameDelayMs(
  frame: CameraFrame | undefined,
  snapshot: PreviewSnapshot | null,
  streamKind: CameraStreamKind,
  displayedFrame?: DisplayedFrame
): number | undefined {
  const browserDecodeDelay = deltaMs(displayedFrame?.receivedAt, displayedFrame?.displayedAt);
  const latency = snapshot?.status.latency;
  if (streamKind === "processed") {
    return firstFinite(
      deltaMs(displayedFrame?.detectorFinishedAt, displayedFrame?.displayedAt),
      deltaMs(frame?.captureTimestamp, frame?.trace?.detectorFinishedAt) ??
        deltaMs(frame?.timestamp, frame?.trace?.detectorFinishedAt),
      snapshot?.status.detectorLatencyMs,
      latency?.detectorEndToEndMs,
      browserDecodeDelay
    );
  }
  return firstFinite(
    deltaMs(displayedFrame?.daemonReceivedAt, displayedFrame?.displayedAt),
    browserDecodeDelay,
    latency?.frameAgeMs,
    latency?.captureToDaemonMs,
    latency?.deviceToDaemonMs,
    deltaMs(frame?.captureTimestamp, frame?.receivedAt),
    deltaMs(frame?.sentAt, frame?.receivedAt)
  );
}

function delayText(value: number | undefined, streamKind: CameraStreamKind): string {
  const label = streamKind === "processed" ? "processed display" : "raw display";
  return typeof value === "number" && Number.isFinite(value) ? `${label} ${Math.round(value)} ms` : `${label} -`;
}

export function CameraPreview({
  snapshot,
  compact = false,
  streamKind = "raw",
  showTrackingOverlay = streamKind === "processed"
}: {
  snapshot: PreviewSnapshot | null;
  compact?: boolean;
  streamKind?: CameraStreamKind;
  showTrackingOverlay?: boolean;
}): JSX.Element {
  const frame = snapshot?.frame;
  const target = snapshot?.target;
  const streamSrc = streamKind === "processed" ? "/processed-stream.mjpg" : "/stream.mjpg";
  const stream = useMjpegStream(streamSrc);
  const [displayedFrame, setDisplayedFrame] = useState<DisplayedFrame | undefined>();
  const imageFrame = stream.frame;
  const imageSrc = imageFrame?.objectUrl ?? (stream.error ? streamSrc : undefined);
  const delay = frameDelayMs(frame, snapshot, streamKind, displayedFrame);
  const frameId = displayedFrame?.frameId ?? imageFrame?.frameId ?? frame?.frameId;
  const dimensions = useMemo(() => (frame ? `${frame.width} x ${frame.height}` : "-"), [frame]);

  return (
    <section className={`camera-preview ${compact ? "camera-preview-compact" : ""}`}>
      <div className="frame-shell">
        {imageSrc ? (
          <img
            alt={streamKind === "processed" ? "StackChan processed camera stream" : "StackChan raw camera stream"}
            src={imageSrc}
            onLoad={() => {
              const loadedFrame = imageFrame;
              if (loadedFrame) {
                setDisplayedFrame({ ...loadedFrame, displayedAt: new Date().toISOString() });
              }
            }}
          />
        ) : null}
        <div className="frame-overlay">
          {showTrackingOverlay && target ? (
            <div
              className="face-box"
              style={{
                left: `${target.x * 100}%`,
                top: `${target.y * 100}%`,
                width: `${target.width * 100}%`,
                height: `${target.height * 100}%`
              }}
            >
              {Math.round((target.confidence ?? 0) * 100)}%
            </div>
          ) : null}
        </div>
      </div>
      <div className="frame-meta">
        <span>frame {dash(frameId)}</span>
        <span>{dimensions}</span>
        <span>{delayText(delay, streamKind)}</span>
      </div>
      {stream.error ? <div className="stream-error">{stream.error}</div> : null}
    </section>
  );
}
