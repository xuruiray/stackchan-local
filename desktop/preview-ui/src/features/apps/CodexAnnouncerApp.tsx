import { useEffect, useState } from "react";

import { setCompletionTts, testCompletionTts } from "../../api/client";
import { Button } from "../../components/Button";
import { CommandPanel } from "../../components/CommandPanel";
import { CommandStatus } from "../../components/CommandStatus";
import { MetricGrid } from "../../components/MetricGrid";
import { RawPanel } from "../../components/RawPanel";
import { useCommand } from "../../hooks/useCommand";
import { boolText, dash, integerText } from "../../model/format";
import type { PreviewSnapshot } from "../../../../src/preview/public-types";

export function CodexAnnouncerApp({
  snapshot,
  setSnapshot
}: {
  snapshot: PreviewSnapshot | null;
  setSnapshot?: (snapshot: PreviewSnapshot) => void;
}): JSX.Element {
  const settings = snapshot?.completionTts;
  const command = useCommand();
  const [volume, setVolume] = useState(settings?.volume ?? 80);

  useEffect(() => {
    if (!command.pending && settings?.volume !== undefined) {
      setVolume(settings.volume);
    }
  }, [command.pending, settings?.volume]);

  async function updateSettings(payload: Parameters<typeof setCompletionTts>[0]) {
    const result = await setCompletionTts(payload);
    if (result.ok !== false && snapshot) {
      setSnapshot?.({
        ...snapshot,
        completionTts: result
      });
    }
    return result;
  }

  return (
    <div className="content-stack">
      <header className="module-header">
        <div>
          <div className="module-kicker">Application</div>
          <h2>Codex 播报 + 灯光提醒</h2>
          <p>任务完成播报、提示音量和灯光提醒状态。</p>
        </div>
      </header>
      <section className="panel-block">
        <h3>状态</h3>
        <MetricGrid
          metrics={[
            { label: "Codex 播报", value: boolText(settings?.enabled), tone: settings?.enabled ? "ok" : "warn" },
            { label: "灯光提醒", value: boolText(settings?.lightEnabled), tone: settings?.lightEnabled ? "ok" : "warn" },
            { label: "Volume", value: integerText(settings?.volume, " / 100") },
            { label: "TTS provider", value: dash(settings?.provider), tone: settings?.provider === "volcengine" ? "ok" : "warn" },
            { label: "Configured voice", value: dash(settings?.configuredVoice) },
            { label: "Active voice", value: dash(settings?.activeVoice), tone: settings?.provider === "volcengine" ? "ok" : "warn" },
            { label: "Cloud TTS", value: boolText(settings?.cloudEnabled), tone: settings?.cloudEnabled ? "ok" : "warn" },
            { label: "Cloud key", value: boolText(settings?.cloudConfigured), tone: settings?.cloudConfigured ? "ok" : "warn" },
            { label: "Reason", value: dash(settings?.reason) }
          ]}
        />
      </section>
      <CommandPanel title="参数输入">
        <label className="field">Volume <input type="range" min="0" max="100" value={volume} onChange={(event) => setVolume(Number(event.target.value))} /></label>
        <div className="button-row">
          <Button disabled={command.pending} onClick={() => void command.run(() => updateSettings({ enabled: !settings?.enabled }))}>
            Toggle TTS
          </Button>
          <Button
            disabled={command.pending}
            onClick={() => void command.run(() => updateSettings({ lightEnabled: !settings?.lightEnabled }))}
          >
            Toggle Light
          </Button>
          <Button variant="primary" disabled={command.pending} onClick={() => void command.run(() => updateSettings({ volume }))}>
            Save Volume
          </Button>
          <Button disabled={command.pending || !settings?.enabled} onClick={() => void command.run(testCompletionTts)}>
            Test
          </Button>
        </div>
        <CommandStatus status={command.status} />
      </CommandPanel>
      <RawPanel value={settings} />
    </div>
  );
}
