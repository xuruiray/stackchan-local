import { useRef, useState } from "react";

import { setExpression } from "../../api/client";
import { Button } from "../../components/Button";
import { CommandPanel } from "../../components/CommandPanel";
import { CommandStatus } from "../../components/CommandStatus";
import { MetricGrid } from "../../components/MetricGrid";
import { RawPanel } from "../../components/RawPanel";
import { useCommand } from "../../hooks/useCommand";
import { boolText, integerText } from "../../model/format";
import type { AvatarExpressionItem, AvatarExpressionPayload, PreviewSnapshot, RobotEmotion } from "../../../../src/preview/public-types";

type ExpressionOption = {
  emotion: RobotEmotion;
  label: string;
  detail: string;
};

type AvatarPart = "leftEye" | "rightEye" | "mouth";
type AvatarField = keyof AvatarExpressionItem;

type AvatarFieldConfig = {
  key: AvatarField;
  label: string;
  min: number;
  max: number;
  step: number;
};

const EXPRESSION_OPTIONS: ExpressionOption[] = [
  { emotion: "neutral", label: "Neutral", detail: "默认" },
  { emotion: "happy", label: "Happy", detail: "眼笑 + 暖灯" },
  { emotion: "laughing", label: "Laughing", detail: "大笑 + 摇头" },
  { emotion: "love", label: "Love", detail: "爱心 + 害羞" },
  { emotion: "angry", label: "Angry", detail: "怒符 + 红灯" },
  { emotion: "sad", label: "Sad", detail: "垂眼 + 低头" },
  { emotion: "crying", label: "Crying", detail: "泪滴 + 低头" },
  { emotion: "sleepy", label: "Sleepy", detail: "困眼 + Zzz" },
  { emotion: "thinking", label: "Thinking", detail: "偏头 + 省略号" },
  { emotion: "surprised", label: "Surprised", detail: "睁眼 + 张嘴" },
  { emotion: "doubtful", label: "Doubtful", detail: "歪眼 + 偏头" }
];

const AVATAR_PARTS: Array<{ key: AvatarPart; label: string }> = [
  { key: "leftEye", label: "Left eye" },
  { key: "rightEye", label: "Right eye" },
  { key: "mouth", label: "Mouth" }
];

const AVATAR_FIELDS: AvatarFieldConfig[] = [
  { key: "x", label: "X", min: -100, max: 100, step: 1 },
  { key: "y", label: "Y", min: -100, max: 100, step: 1 },
  { key: "rotation", label: "Rotation", min: -1800, max: 1800, step: 10 },
  { key: "weight", label: "Weight", min: 0, max: 100, step: 1 },
  { key: "size", label: "Size", min: -100, max: 100, step: 1 }
];

const DEFAULT_AVATAR_ITEM: AvatarExpressionItem = {
  x: 0,
  y: 0,
  rotation: 0,
  weight: 0,
  size: 0
};

const DEFAULT_AVATAR_EXPRESSION: AvatarExpressionPayload = {
  type: "bleAvatar",
  leftEye: { ...DEFAULT_AVATAR_ITEM, weight: 100 },
  rightEye: { ...DEFAULT_AVATAR_ITEM, weight: 100 },
  mouth: { ...DEFAULT_AVATAR_ITEM }
};

const EXPRESSION_COMMAND_COOLDOWN_MS = 450;

export function ExpressionControlApp({
  snapshot
}: {
  snapshot: PreviewSnapshot | null;
  setSnapshot?: (snapshot: PreviewSnapshot) => void;
}): JSX.Element {
  const activeDevice = snapshot?.devices?.find((device) => device.status === "online");
  const supportsExpression = Boolean(
    activeDevice?.capabilities.includes("display") || activeDevice?.capabilities.includes("face")
  );
  const command = useCommand();
  const [durationMs, setDurationMs] = useState(2000);
  const [flash, setFlash] = useState(false);
  const [rgbColor, setRgbColor] = useState("#43D5B0");
  const [customAvatar, setCustomAvatar] = useState(false);
  const [avatarJson, setAvatarJson] = useState<AvatarExpressionPayload>(cloneAvatarExpression(DEFAULT_AVATAR_EXPRESSION));
  const cooldownUntilRef = useRef(0);
  const [cooldownActive, setCooldownActive] = useState(false);
  const [lastExpression, setLastExpression] = useState<{
    emotion: RobotEmotion;
    durationMs: number;
    flash: boolean;
    rgbColor?: string;
    avatarJson: AvatarExpressionPayload | undefined;
  }>();

  async function applyExpression(emotion: RobotEmotion) {
    const now = Date.now();
    if (now < cooldownUntilRef.current) {
      return { ok: false, error: "expression command cooling down" };
    }
    startCommandCooldown();
    const nextAvatarJson = customAvatar ? avatarJson : undefined;
    const result = await setExpression({
      emotion,
      durationMs,
      flash,
      rgbColor: flash ? rgbColor : undefined,
      avatarJson: nextAvatarJson
    });
    if (result.ok !== false) {
      setLastExpression({
        emotion: result.emotion,
        durationMs: result.durationMs,
        flash: result.flash,
        rgbColor: result.rgbColor,
        avatarJson: result.avatarJson
      });
    }
    return result;
  }

  function startCommandCooldown() {
    const until = Date.now() + EXPRESSION_COMMAND_COOLDOWN_MS;
    cooldownUntilRef.current = until;
    setCooldownActive(true);
    window.setTimeout(() => {
      if (cooldownUntilRef.current === until) {
        cooldownUntilRef.current = 0;
        setCooldownActive(false);
      }
    }, EXPRESSION_COMMAND_COOLDOWN_MS);
  }

  function updateAvatarValue(part: AvatarPart, field: AvatarField, value: number) {
    setAvatarJson((current) => ({
      ...current,
      [part]: {
        ...current[part],
        [field]: value
      }
    }));
  }

  function resetAvatarValues() {
    setAvatarJson(cloneAvatarExpression(DEFAULT_AVATAR_EXPRESSION));
  }

  const lastExpressionText = lastExpression
    ? `${lastExpression.emotion}${lastExpression.avatarJson ? " + avatar" : ""} / ${integerText(lastExpression.durationMs, " ms")}`
    : "-";
  const activeEmotion = lastExpression?.emotion;

  return (
    <div className="content-stack">
      <header className="module-header">
        <div>
          <div className="module-kicker">Application</div>
          <h2>硬件表情控制</h2>
          <p>发送 StackChan 表情 preset，并可附带 bleAvatar 眼睛和嘴巴参数。</p>
        </div>
      </header>
      <section className="panel-block">
        <h3>状态</h3>
        <MetricGrid
          metrics={[
            { label: "Device", value: activeDevice?.status ?? "offline", tone: activeDevice ? "ok" : "bad" },
            { label: "Expression capability", value: boolText(supportsExpression), tone: supportsExpression ? "ok" : "warn" },
            { label: "Mode", value: activeDevice?.mode ?? "-" },
            { label: "Last command", value: lastExpressionText }
          ]}
        />
      </section>
      <CommandPanel title="表情指令">
        <div className="expression-control-grid">
          <label className="field">
            Duration
            <input
              type="range"
              min="300"
              max="8000"
              step="100"
              value={durationMs}
              onChange={(event) => setDurationMs(Number(event.target.value))}
            />
            <strong>{durationMs} ms</strong>
          </label>
          <label className="field expression-toggle">
            RGB flash
            <input type="checkbox" checked={flash} onChange={(event) => setFlash(event.target.checked)} />
          </label>
          <label className="field">
            Flash color
            <input type="color" value={rgbColor} disabled={!flash} onChange={(event) => setRgbColor(event.target.value)} />
          </label>
        </div>
        <div className="expression-grid">
          {EXPRESSION_OPTIONS.map((option) => {
            const isActive = activeEmotion === option.emotion;
            return (
              <Button
                key={option.emotion}
                aria-pressed={isActive}
                className={isActive ? "expression-button-active" : ""}
                disabled={command.pending || cooldownActive}
                onClick={() => void command.run(() => applyExpression(option.emotion))}
              >
                <span>{option.label}</span>
                <small>{option.detail}</small>
              </Button>
            );
          })}
        </div>
        <div className="avatar-editor-toolbar">
          <label className="field expression-toggle">
            Custom bleAvatar
            <input type="checkbox" checked={customAvatar} onChange={(event) => setCustomAvatar(event.target.checked)} />
          </label>
          <Button type="button" disabled={command.pending} onClick={resetAvatarValues}>
            Reset avatar
          </Button>
        </div>
        {customAvatar ? (
          <div className="avatar-editor">
            {AVATAR_PARTS.map((part) => (
              <AvatarPartEditor
                key={part.key}
                label={part.label}
                value={avatarJson[part.key]}
                onChange={(field, value) => updateAvatarValue(part.key, field, value)}
              />
            ))}
          </div>
        ) : null}
        <CommandStatus status={command.status} />
      </CommandPanel>
      <RawPanel value={{ activeDevice, lastExpression, avatarJson: customAvatar ? avatarJson : undefined }} />
    </div>
  );
}

function AvatarPartEditor({
  label,
  value,
  onChange
}: {
  label: string;
  value: AvatarExpressionItem;
  onChange: (field: AvatarField, value: number) => void;
}): JSX.Element {
  return (
    <div className="avatar-editor-group">
      <h4>{label}</h4>
      {AVATAR_FIELDS.map((field) => (
        <label key={field.key} className="avatar-slider">
          <span>{field.label}</span>
          <input
            type="range"
            min={field.min}
            max={field.max}
            step={field.step}
            value={value[field.key]}
            onChange={(event) => onChange(field.key, Number(event.target.value))}
          />
          <strong>{value[field.key]}</strong>
        </label>
      ))}
    </div>
  );
}

function cloneAvatarExpression(value: AvatarExpressionPayload): AvatarExpressionPayload {
  return {
    type: "bleAvatar",
    leftEye: { ...value.leftEye },
    rightEye: { ...value.rightEye },
    mouth: { ...value.mouth }
  };
}
