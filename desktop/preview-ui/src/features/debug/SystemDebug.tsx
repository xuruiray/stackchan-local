import { MetricGrid } from "../../components/MetricGrid";
import { RawPanel } from "../../components/RawPanel";
import { ageText, dash, latencyText } from "../../model/format";
import { activeDevice } from "../../model/snapshot";
import type { PreviewSnapshot } from "../../../../src/preview/public-types";

export function SystemDebug({ snapshot }: { snapshot: PreviewSnapshot | null }): JSX.Element {
  const device = activeDevice(snapshot);
  const latency = snapshot?.status.latency;
  return (
    <div className="content-stack">
      <header className="module-header">
        <div>
          <div className="module-kicker">Debug</div>
          <h2>System</h2>
          <p>系统级连接、协议、延迟和计数器。</p>
        </div>
      </header>
      <section className="panel-block">
        <h3>Device Session</h3>
        <MetricGrid
          metrics={[
            { label: "Device", value: dash(device?.deviceId) },
            { label: "Status", value: dash(device?.status), tone: device?.status === "online" ? "ok" : "bad" },
            { label: "Session", value: dash(device?.sessionId) },
            { label: "Firmware", value: dash(device?.firmwareVersion) },
            { label: "Last seen", value: ageText(device?.lastSeenAt) },
            { label: "Heartbeat", value: dash(device?.heartbeatIntervalMs) },
            { label: "Audio frames", value: dash(device?.audioFramesReceived) },
            { label: "Last event", value: dash(device?.lastEvent?.kind) }
          ]}
        />
      </section>
      <section className="panel-block">
        <h3>Counters</h3>
        <MetricGrid
          metrics={[
            { label: "Vision frames", value: dash(snapshot?.status.framesReceived) },
            { label: "Vision drops", value: dash(snapshot?.status.framesDropped) },
            { label: "Detector latency", value: latencyText(snapshot?.status.detectorLatencyMs) },
            { label: "Frame age", value: latencyText(latency?.frameAgeMs) },
            { label: "Device to daemon", value: latencyText(latency?.captureToDaemonMs ?? latency?.deviceToDaemonMs) },
            { label: "Detector E2E", value: latencyText(latency?.detectorEndToEndMs) },
            {
              label: "Media credit",
              value: snapshot?.status.mediaCredit
                ? `${snapshot.status.mediaCredit.grantedFrames} granted / ${snapshot.status.mediaCredit.outstandingFrames} open`
                : "-"
            }
          ]}
        />
      </section>
      <RawPanel value={{ device, status: snapshot?.status }} />
    </div>
  );
}
