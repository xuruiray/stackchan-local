type PreviewInitialSnapshot = {
  status?: Record<string, any>;
  faces?: Array<Record<string, any>>;
  target?: Record<string, any>;
  frame?: Record<string, any>;
  devices?: Array<Record<string, any>>;
  completionTts?: Record<string, any>;
};

type InitialView = ReturnType<typeof buildInitialView>;

export function renderPreviewHtml(snapshot: PreviewInitialSnapshot = {}): string {
  const initial = buildInitialView(snapshot);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>StackChan Vision Debug</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0a0b0d;
      --panel: #141618;
      --panel-2: #1b1f22;
      --panel-3: #22272b;
      --line: #30363d;
      --text: #eef2f3;
      --muted: #9aa6ad;
      --accent: #43d5b0;
      --accent-2: #6cb6ff;
      --warn: #e3b341;
      --bad: #f47067;
      --ok: #7ee787;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
      overflow-x: hidden;
    }
    .shell {
      width: 100%;
      min-width: 0;
      min-height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr;
      overflow-x: hidden;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 10;
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
      align-items: stretch;
      min-width: 0;
      max-width: 100%;
      padding: 10px 12px;
      background: #101214;
      border-bottom: 1px solid var(--line);
    }
    header > * { min-width: 0; }
    h1 { margin: 0; font-size: 16px; font-weight: 700; }
    .subtitle {
      margin-top: 3px;
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .status-strip {
      display: flex;
      gap: 8px;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      overflow-x: auto;
      padding-bottom: 2px;
      scrollbar-width: thin;
    }
    .pill {
      min-width: 0;
      padding: 7px 9px;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: #171b1e;
      font-size: 12px;
      line-height: 1.2;
    }
    .status-strip .pill { flex: 0 0 92px; }
    .pill .k { display: block; color: var(--muted); margin-bottom: 3px; white-space: nowrap; }
    .pill .v { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .ok { color: var(--ok); }
    .warn { color: var(--warn); }
    .bad { color: var(--bad); }
    .actions {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      overflow: visible;
      padding-bottom: 0;
      scrollbar-width: thin;
    }
    button {
      min-height: 34px;
      padding: 0 11px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--panel-2);
      color: var(--text);
      font: inherit;
      font-size: 13px;
      cursor: pointer;
      transition: border-color 120ms ease, background 120ms ease, color 120ms ease, opacity 120ms ease;
      white-space: nowrap;
    }
    button:hover:not(:disabled) { border-color: #59646c; background: var(--panel-3); }
    button:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
    button.active,
    button[aria-pressed="true"] {
      border-color: rgba(67, 213, 176, .75);
      background: #12312b;
      color: #d8fff5;
    }
    button.pending { border-color: rgba(108, 182, 255, .8); color: #cfe7ff; }
    button:disabled { cursor: default; opacity: .45; }
    main {
      display: block;
      min-width: 0;
      max-width: 100%;
      min-height: auto;
    }
    .stage {
      min-width: 0;
      max-width: 100%;
      min-height: auto;
      display: block;
      background: #050607;
      overflow: visible;
    }
    .video-area {
      display: block;
      min-height: 0;
      padding: 10px;
    }
    .video-wrap {
      position: relative;
      width: 100%;
      max-height: none;
      aspect-ratio: 4 / 3;
      background: #000;
      border: 1px solid #20262b;
      border-radius: 8px;
      overflow: hidden;
    }
    .video-wrap img, .video-wrap canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
      object-fit: contain;
    }
    .empty {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      color: var(--muted);
      font-size: 14px;
    }
    .frame-footer {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      padding: 0 10px 10px;
    }
    .side {
      min-width: 0;
      max-width: 100%;
      min-height: 0;
      overflow: visible;
      background: var(--panel);
      border-top: 1px solid var(--line);
    }
    .tabs {
      position: sticky;
      top: 0;
      z-index: 2;
      display: flex;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      overflow-x: auto;
      scrollbar-width: thin;
      background: var(--line);
      border-bottom: 1px solid var(--line);
    }
    .tab {
      flex: 0 0 auto;
      min-width: 96px;
      border: 0;
      border-radius: 0;
      background: #15181a;
      color: var(--muted);
    }
    .tab.selected { background: var(--panel); color: var(--text); }
    .panel { display: none; padding: 12px; }
    .panel.selected { display: block; }
    .group {
      padding: 13px 0;
      border-bottom: 1px solid var(--line);
    }
    .group:first-child { padding-top: 0; }
    .group:last-child { border-bottom: 0; }
    .group-title {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      margin-bottom: 10px;
    }
    .tuning-group {
      margin-bottom: 12px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #111416;
    }
    .tuning-group:first-child { padding-top: 12px; }
    .tuning-group:last-child { margin-bottom: 0; border-bottom: 1px solid var(--line); }
    .metric {
      display: grid;
      grid-template-columns: minmax(92px, .9fr) minmax(0, 1.3fr);
      gap: 10px;
      padding: 7px 0;
      border-top: 1px solid rgba(255,255,255,.04);
      font-size: 13px;
    }
    .metric:first-of-type { border-top: 0; }
    .metric span:first-child { color: var(--muted); }
    .metric > span:last-child,
    .metric > .metric-value {
      text-align: right;
      overflow-wrap: anywhere;
      white-space: normal;
      font-variant-numeric: tabular-nums;
    }
    .metric > .metric-value {
      min-width: 0;
      display: grid;
      justify-items: end;
      gap: 6px;
    }
    .meter {
      position: relative;
      width: min(160px, 100%);
      height: 9px;
      overflow: hidden;
      border-radius: 999px;
      background: #090b0d;
      border: 1px solid rgba(255,255,255,.08);
    }
    .meter-fill {
      position: absolute;
      inset: 0 auto 0 0;
      width: 0%;
      background: linear-gradient(90deg, var(--accent), var(--warn));
      transition: width 120ms linear;
    }
    .meter-readout {
      color: var(--muted);
      font-size: 12px;
    }
    .rgb-controls {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
      padding: 8px 0 10px;
    }
    .color-field {
      display: grid;
      grid-template-columns: auto 44px;
      gap: 8px;
      align-items: center;
      min-width: 0;
      color: var(--muted);
      font-size: 13px;
    }
    input[type="color"] {
      width: 44px;
      height: 34px;
      padding: 2px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--panel-2);
    }
    .swatch-row {
      grid-column: 1 / -1;
      display: flex;
      gap: 6px;
      overflow-x: auto;
      padding-bottom: 2px;
    }
    .swatch {
      width: 32px;
      min-width: 32px;
      padding: 0;
      color: transparent;
      border-color: rgba(255,255,255,.18);
    }
    .control-row {
      display: grid;
      grid-template-columns: minmax(72px, 92px) minmax(0, 1fr) minmax(44px, 58px);
      gap: 9px;
      align-items: center;
      padding: 8px 0;
      border-top: 1px solid rgba(255,255,255,.04);
      font-size: 13px;
    }
    .control-row:first-of-type { border-top: 0; }
    .control-row label { color: var(--muted); }
    .control-row output { text-align: right; font-variant-numeric: tabular-nums; }
    .imu-visual {
      position: relative;
      height: 230px;
      margin-bottom: 12px;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #090b0d;
    }
    .imu-scene {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      perspective: 760px;
      perspective-origin: 50% 48%;
    }
    .imu-cube {
      position: relative;
      width: min(42%, 150px);
      aspect-ratio: 1.55;
      transform-style: preserve-3d;
      transition: transform 90ms linear;
    }
    .imu-cube-face {
      position: absolute;
      inset: 0;
      border: 1px solid rgba(255,255,255,.22);
      border-radius: 6px;
      background: rgba(67, 213, 176, .82);
      box-shadow: 0 18px 42px rgba(0,0,0,.34);
    }
    .imu-cube-front {
      transform: translateZ(34px);
      display: grid;
      place-items: center;
      background: linear-gradient(135deg, rgba(67,213,176,.92), rgba(108,182,255,.72));
    }
    .imu-cube-front::after {
      content: "";
      width: 42%;
      height: 34%;
      border-radius: 5px;
      background: rgba(8,10,12,.86);
    }
    .imu-cube-back { transform: rotateY(180deg) translateZ(34px); background: rgba(36, 98, 117, .78); }
    .imu-cube-top { transform: rotateX(90deg) translateZ(34px); background: rgba(126, 231, 135, .58); }
    .imu-cube-bottom { transform: rotateX(-90deg) translateZ(34px); background: rgba(244, 112, 103, .54); }
    .imu-cube-left { transform: rotateY(-90deg) translateZ(34px); background: rgba(108, 182, 255, .58); }
    .imu-cube-right { transform: rotateY(90deg) translateZ(34px); background: rgba(227, 179, 65, .58); }
    .imu-gravity {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 3px;
      height: 76px;
      border-radius: 999px;
      background: #e3b341;
      transform-origin: 50% 0;
      box-shadow: 0 0 18px rgba(227,179,65,.38);
      transition: transform 90ms linear, height 90ms linear;
    }
    .imu-gravity::after {
      content: "";
      position: absolute;
      left: 50%;
      bottom: -4px;
      width: 12px;
      height: 12px;
      border-radius: 999px;
      background: #e3b341;
      transform: translateX(-50%);
    }
    .imu-hud {
      position: absolute;
      left: 10px;
      top: 9px;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      max-width: calc(100% - 20px);
      pointer-events: none;
    }
    .imu-hud span, .imu-legend span {
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 6px;
      background: rgba(10, 12, 14, .76);
      color: #d7dee2;
      padding: 4px 7px;
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .imu-legend {
      position: absolute;
      left: 10px;
      bottom: 9px;
      display: flex;
      gap: 6px;
      pointer-events: none;
    }
    .axis-dot {
      display: inline-block;
      width: 7px;
      height: 7px;
      margin-right: 5px;
      border-radius: 999px;
      vertical-align: 1px;
    }
    .axis-x { background: #f47067; }
    .axis-y { background: #7ee787; }
    .axis-z { background: #6cb6ff; }
    .axis-g { background: #e3b341; }
    input[type="range"] { width: 100%; accent-color: var(--accent); }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
    .segmented {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
      gap: 8px;
      margin-bottom: 12px;
    }
    .segmented button {
      width: 100%;
      min-width: 0;
    }
    pre {
      margin: 0;
      padding: 10px;
      max-height: 360px;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: #0b0d0f;
      color: #d7dee2;
      font-size: 12px;
      line-height: 1.45;
      white-space: pre-wrap;
    }
    .log-controls {
      display: grid;
      grid-template-columns: 1fr 90px 92px;
      gap: 8px;
      margin-bottom: 10px;
    }
    input, select {
      height: 34px;
      min-width: 0;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #0f1214;
      color: var(--text);
      padding: 0 9px;
      font: inherit;
      font-size: 13px;
    }
    .logs {
      display: grid;
      gap: 7px;
      max-height: calc(100vh - 210px);
      overflow: auto;
    }
    .log {
      border: 1px solid var(--line);
      border-radius: 7px;
      padding: 8px;
      background: #101315;
      font-size: 12px;
    }
    .log-head {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      color: var(--muted);
      margin-bottom: 5px;
      font-variant-numeric: tabular-nums;
    }
    .log-msg { color: var(--text); margin-bottom: 5px; }
    .log-context { color: #c8d1d6; white-space: pre-wrap; overflow-wrap: anywhere; }
    .logs { max-height: 460px; }
    @media (max-width: 520px) {
      .frame-footer { grid-template-columns: 1fr; }
      .log-controls { grid-template-columns: 1fr; }
      .control-row {
        grid-template-columns: minmax(0, 1fr) 58px;
        gap: 6px 10px;
      }
      .control-row label { grid-column: 1 / -1; }
      .segmented { grid-template-columns: 1fr; }
      .metric { grid-template-columns: minmax(84px, .8fr) minmax(0, 1.2fr); }
    }
    @media (min-width: 1120px) {
      .shell { height: 100vh; }
      header {
        grid-template-columns: minmax(180px, 260px) minmax(0, 1fr);
        align-items: start;
        gap: 8px 16px;
        padding: 10px 16px;
      }
      .status-strip {
        grid-column: 1 / -1;
        display: grid;
        grid-template-columns: repeat(10, minmax(0, 1fr));
        overflow: visible;
        padding-bottom: 0;
      }
      .status-strip .pill { min-width: 0; }
      .actions {
        grid-column: 2;
        grid-row: 1;
        flex-wrap: nowrap;
        justify-content: flex-end;
        overflow: visible;
        padding-bottom: 0;
      }
      main {
        display: grid;
        grid-template-columns: minmax(0, 1fr) clamp(430px, 36vw, 520px);
        height: 100%;
        min-height: 0;
        overflow: hidden;
      }
      .stage {
        height: 100%;
        min-height: 0;
        display: grid;
        grid-template-rows: 1fr auto;
        overflow: hidden;
      }
      .video-area {
        display: grid;
        place-items: center;
        min-height: 0;
        padding: 14px;
      }
      .video-wrap {
        width: min(100%, calc((100vh - 198px) * 1.333));
        max-height: calc(100vh - 198px);
      }
      .frame-footer {
        grid-template-columns: repeat(4, 1fr);
        padding: 0 14px 14px;
      }
      .side {
        min-height: 0;
        overflow: auto;
        border-left: 1px solid var(--line);
        border-top: 0;
      }
      .tabs {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        overflow: visible;
      }
      .tab {
        min-width: 0;
        flex: initial;
      }
      .panel { padding: 14px; }
      .logs { max-height: calc(100vh - 210px); }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <div>
        <h1>StackChan Vision Debug</h1>
        <div class="subtitle" id="subtitle">${html(initial.subtitle)}</div>
      </div>
      <div class="status-strip">
        <div class="pill"><span class="k">Device</span><span class="v ${attr(initial.statDeviceClass)}" id="statDevice">${html(initial.statDevice)}</span></div>
        <div class="pill"><span class="k">Face</span><span class="v ${attr(initial.statFaceClass)}" id="statFace">${html(initial.statFace)}</span></div>
        <div class="pill"><span class="k">Faces</span><span class="v" id="statFaces">${html(initial.statFaces)}</span></div>
        <div class="pill"><span class="k">FPS</span><span class="v" id="statFps">${html(initial.statFps)}</span></div>
        <div class="pill"><span class="k">Battery</span><span class="v ${attr(initial.statBatteryClass)}" id="statBattery">${html(initial.statBattery)}</span></div>
        <div class="pill"><span class="k">Wi-Fi</span><span class="v ${attr(initial.statWifiClass)}" id="statWifi">${html(initial.statWifi)}</span></div>
        <div class="pill"><span class="k">IMU</span><span class="v" id="statImu">${html(initial.statImu)}</span></div>
        <div class="pill"><span class="k">Dropped</span><span class="v ${attr(initial.statDroppedClass)}" id="statDropped">${html(initial.statDropped)}</span></div>
        <div class="pill"><span class="k">Detector</span><span class="v ${attr(initial.statDetectorClass)}" id="statDetector">${html(initial.statDetector)}</span></div>
        <div class="pill"><span class="k">Error</span><span class="v" id="statError">${html(initial.statError)}</span></div>
      </div>
		      <div class="actions">
		        <button id="toggleTracking" class="${attr(initial.toggleTrackingClass)}" type="button">${html(initial.toggleTrackingText)}</button>
		        <button id="toggleCompletionTts" class="${attr(initial.ttsToggleClass)}" type="button">${html(initial.ttsToggleText)}</button>
		        <button id="toggleCompletionLight" class="${attr(initial.ttsLightToggleClass)}" type="button">${html(initial.ttsLightToggleText)}</button>
		        <button id="testCompletionTts" type="button">Test TTS</button>
		      </div>
    </header>

    <main>
      <section class="stage">
        <div class="video-area">
          <div class="video-wrap">
            <div id="empty" class="empty" style="${attr(initial.emptyStyle)}">Waiting for camera frame</div>
            <img id="frame" alt="StackChan camera frame" src="${attr(initial.frameSrc)}" data-frame-id="${attr(initial.frameId === "-" ? "" : initial.frameId)}" decoding="async" />
            <canvas id="overlay"></canvas>
          </div>
        </div>
        <div class="frame-footer">
          <div class="pill"><span class="k">Frame</span><span class="v" id="frameId">${html(initial.frameId)}</span></div>
          <div class="pill"><span class="k">Size</span><span class="v" id="frameSize">${html(initial.frameSize)}</span></div>
          <div class="pill"><span class="k">Last frame</span><span class="v" id="lastFrame">${html(initial.frameAge)}</span></div>
          <div class="pill"><span class="k">Target</span><span class="v" id="targetSummary">${html(initial.targetSummary)}</span></div>
        </div>
      </section>

      <aside class="side">
        <div class="tabs">
          <button class="tab selected" data-tab="overview" type="button">Overview</button>
          <button class="tab" data-tab="hardware" type="button">Hardware</button>
          <button class="tab" data-tab="tuning" type="button">Tuning</button>
          <button class="tab" data-tab="debug" type="button">Debug</button>
          <button class="tab" data-tab="logs" type="button">Logs</button>
        </div>

        <section id="overview" class="panel selected">
          <div class="group">
            <div class="group-title">Face Tracking</div>
            <div class="metric"><span>Enabled</span><span class="${attr(initial.faceEnabledClass)}" id="faceEnabled">${html(initial.faceEnabled)}</span></div>
            <div class="metric"><span>Last face</span><span id="lastFace">${html(initial.lastFace)}</span></div>
            <div class="metric"><span>Last command</span><span id="lastFaceCommand">${html(initial.lastCommand)}</span></div>
            <div class="metric"><span>Target box</span><span id="targetBox">${html(initial.targetBox)}</span></div>
          </div>
          <div class="group">
            <div class="group-title">Expression</div>
            <div class="metric"><span>Emotion</span><span id="expressionEmotion">${html(initial.expressionEmotion)}</span></div>
            <div class="metric"><span>Smile</span><span id="expressionSmile">${html(initial.expressionSmile)}</span></div>
            <div class="metric"><span>Eyes</span><span id="expressionEyes">${html(initial.expressionEyes)}</span></div>
            <div class="metric"><span>Mouth</span><span id="expressionMouth">${html(initial.expressionMouth)}</span></div>
            <div class="metric"><span>Top blendshapes</span><span id="expressionBlendshapes">${html(initial.expressionBlendshapes)}</span></div>
            <div class="metric"><span>Synced</span><span id="expressionSynced">${html(initial.expressionSynced)}</span></div>
          </div>
          <div class="group">
            <div class="group-title">Device</div>
            <div class="metric"><span>Status</span><span id="deviceStatus">${html(initial.deviceStatus)}</span></div>
            <div class="metric"><span>Mode</span><span id="deviceMode">${html(initial.deviceMode)}</span></div>
            <div class="metric"><span>Last seen</span><span id="deviceSeen">${html(initial.deviceSeen)}</span></div>
            <div class="metric"><span>Capabilities</span><span id="deviceCaps">${html(initial.deviceCaps)}</span></div>
          </div>
        </section>

        <section id="hardware" class="panel">
          <div class="group">
            <div class="group-title">Power & IO</div>
            <div class="metric"><span>Battery</span><span id="sensorBatteryLevel">${html(initial.batteryLevel)}</span></div>
            <div class="metric"><span>Charging</span><span id="sensorBatteryCharging">${html(initial.batteryCharging)}</span></div>
            <div class="metric"><span>Power monitor</span><span id="hardwarePowerMonitor">${html(initial.hardwarePowerMonitor)}</span></div>
            <div class="metric"><span>Backlight</span><span id="hardwareBacklight">${html(initial.hardwareBacklight)}</span></div>
            <div class="metric"><span>Speaker</span><span id="hardwareSpeaker">${html(initial.hardwareSpeaker)}</span></div>
            <div class="metric"><span>Servo power</span><span id="hardwareServoPower">${html(initial.hardwareServoPower)}</span></div>
            <div class="metric"><span>IO expander</span><span id="hardwareIoExpander">${html(initial.hardwareIoExpander)}</span></div>
            <div class="metric"><span>I2C scan</span><span id="hardwareI2cScan">${html(initial.hardwareI2cScan)}</span></div>
            <div class="metric"><span>Updated</span><span id="sensorBatteryAge">${html(initial.batteryAge)}</span></div>
          </div>
          <div class="group">
            <div class="group-title">Motion</div>
            <div class="imu-visual">
              <div id="imu3dScene" class="imu-scene"></div>
              <div class="imu-hud">
                <span id="imu3dStatus">Waiting</span>
                <span id="imuRoll">Roll -</span>
                <span id="imuPitch">Pitch -</span>
                <span id="imuYaw">Yaw -</span>
              </div>
              <div class="imu-legend">
                <span><i class="axis-dot axis-x"></i>X</span>
                <span><i class="axis-dot axis-y"></i>Y</span>
                <span><i class="axis-dot axis-z"></i>Z</span>
                <span><i class="axis-dot axis-g"></i>G</span>
              </div>
            </div>
            <div class="metric"><span>Motion</span><span id="sensorImuMotion">${html(initial.imuMotion)}</span></div>
            <div class="metric"><span>Accel X</span><span id="sensorImuX">${html(initial.imuX)}</span></div>
            <div class="metric"><span>Accel Y</span><span id="sensorImuY">${html(initial.imuY)}</span></div>
            <div class="metric"><span>Accel Z</span><span id="sensorImuZ">${html(initial.imuZ)}</span></div>
            <div class="metric"><span>Gyro X</span><span id="sensorImuGyroX">${html(initial.imuGyroX)}</span></div>
            <div class="metric"><span>Gyro Y</span><span id="sensorImuGyroY">${html(initial.imuGyroY)}</span></div>
            <div class="metric"><span>Gyro Z</span><span id="sensorImuGyroZ">${html(initial.imuGyroZ)}</span></div>
            <div class="metric"><span>Accel Magnitude</span><span id="sensorImuMagnitude">${html(initial.imuMagnitude)}</span></div>
            <div class="metric"><span>Gyro Magnitude</span><span id="sensorImuGyroMagnitude">${html(initial.imuGyroMagnitude)}</span></div>
            <div class="metric"><span>Fused Roll</span><span id="sensorImuRoll">-</span></div>
            <div class="metric"><span>Fused Pitch</span><span id="sensorImuPitch">-</span></div>
            <div class="metric"><span>Fused Yaw</span><span id="sensorImuYaw">-</span></div>
            <div class="metric"><span>Accel Roll</span><span id="sensorImuAccelRoll">-</span></div>
            <div class="metric"><span>Accel Pitch</span><span id="sensorImuAccelPitch">-</span></div>
            <div class="metric"><span>Roll Rate</span><span id="sensorImuRollRate">-</span></div>
            <div class="metric"><span>Pitch Rate</span><span id="sensorImuPitchRate">-</span></div>
            <div class="metric"><span>Filter dt</span><span id="sensorImuDt">-</span></div>
            <div class="metric"><span>Filter</span><span id="sensorImuFilter">-</span></div>
            <div class="metric"><span>Yaw servo</span><span id="hardwareYawServo">${html(initial.hardwareYawServo)}</span></div>
            <div class="metric"><span>Pitch servo</span><span id="hardwarePitchServo">${html(initial.hardwarePitchServo)}</span></div>
            <div class="metric"><span>Updated</span><span id="sensorImuAge">${html(initial.imuAge)}</span></div>
          </div>
          <div class="group">
            <div class="group-title">Interaction</div>
            <div class="metric"><span>Screen touch</span><span id="sensorTouchPoint">${html(initial.touchPoint)}</span></div>
            <div class="metric"><span>Touch surface</span><span id="sensorTouchSurface">${html(initial.touchSurface)}</span></div>
            <div class="metric"><span>Touch gesture</span><span id="sensorTouchGesture">${html(initial.touchGesture)}</span></div>
            <div class="metric"><span>Touch pressed</span><span id="sensorTouchPressed">${html(initial.touchPressed)}</span></div>
            <div class="metric"><span>Head touch</span><span id="hardwareHeadTouch">${html(initial.hardwareHeadTouch)}</span></div>
            <div class="metric"><span>Wake word</span><span id="hardwareWakeWord">${html(initial.hardwareWakeWord)}</span></div>
            <div class="metric"><span>Wi-Fi</span><span id="sensorWifiStatus">${html(initial.wifiStatus)}</span></div>
            <div class="metric"><span>SSID</span><span id="sensorWifiSsid">${html(initial.wifiSsid)}</span></div>
            <div class="metric"><span>RSSI</span><span id="sensorWifiRssi">${html(initial.wifiRssi)}</span></div>
            <div class="metric"><span>BLE</span><span id="hardwareBle">${html(initial.hardwareBle)}</span></div>
            <div class="metric"><span>Updated</span><span id="sensorTouchAge">${html(initial.touchAge)}</span></div>
          </div>
          <div class="group">
            <div class="group-title">Peripherals</div>
            <div class="metric"><span>Camera</span><span id="hardwareCamera">${html(initial.hardwareCamera)}</span></div>
            <div class="metric"><span>Requested</span><span id="hardwareCameraRequested">${html(initial.hardwareCameraRequested)}</span></div>
            <div class="metric"><span>Actual</span><span id="hardwareCameraActual">${html(initial.hardwareCameraActual)}</span></div>
            <div class="metric"><span>JPEG quality</span><span id="hardwareCameraQuality">${html(initial.hardwareCameraQuality)}</span></div>
            <div class="metric"><span>Fallback</span><span id="hardwareCameraFallback">${html(initial.hardwareCameraFallback)}</span></div>
            <div class="metric"><span>RGB</span><div class="metric-value" id="hardwareRgb">${html(initial.hardwareRgb)}</div></div>
            <div class="rgb-controls">
              <label class="color-field" for="rgbColor">RGB color <input id="rgbColor" type="color" value="${attr(initial.rgbColor)}" /></label>
              <button id="rgbToggle" class="${attr(initial.rgbToggleClass)}" type="button">${html(initial.rgbToggleText)}</button>
              <div class="swatch-row" aria-label="RGB presets">
                <button class="swatch" type="button" data-rgb="#43D5B0" style="background:#43D5B0">Mint</button>
                <button class="swatch" type="button" data-rgb="#6CB6FF" style="background:#6CB6FF">Blue</button>
                <button class="swatch" type="button" data-rgb="#E3B341" style="background:#E3B341">Amber</button>
                <button class="swatch" type="button" data-rgb="#F47067" style="background:#F47067">Red</button>
                <button class="swatch" type="button" data-rgb="#FFFFFF" style="background:#FFFFFF">White</button>
              </div>
            </div>
            <div class="metric"><span>RTC</span><span id="hardwareRtc">${html(initial.hardwareRtc)}</span></div>
            <div class="metric"><span>NFC</span><span id="hardwareNfc">${html(initial.hardwareNfc)}</span></div>
            <div class="metric"><span>IR</span><span id="hardwareIr">${html(initial.hardwareIr)}</span></div>
            <div class="metric"><span>Proximity</span><span id="hardwareProximity">${html(initial.hardwareProximity)}</span></div>
            <div class="metric"><span>Ambient light</span><span id="hardwareAmbientLight">${html(initial.hardwareAmbientLight)}</span></div>
            <div class="metric"><span>Magnetometer</span><span id="hardwareMagnetometer">${html(initial.hardwareMagnetometer)}</span></div>
            <div class="metric"><span>Mic</span><div class="metric-value" id="hardwareMic">${html(initial.hardwareMic)}</div></div>
            <div class="metric"><span>Mic level</span><div class="metric-value"><div class="meter"><i id="hardwareMicLevelFill" class="meter-fill" style="width:${attr(initial.hardwareMicLevelWidth)}"></i></div><span id="hardwareMicLevelText" class="meter-readout">${html(initial.hardwareMicLevelText)}</span></div></div>
            <div class="metric"><span>Frame age</span><span id="sensorFrameAge">${html(initial.frameAge)}</span></div>
            <div class="metric"><span>Face count</span><span id="sensorFaceCount">${html(initial.statFaces)}</span></div>
            <div class="metric"><span>Target</span><span id="sensorTarget">${html(initial.targetSummary)}</span></div>
            <div class="metric"><span>Mode</span><span id="sensorMode">${html(initial.deviceMode)}</span></div>
            <div class="metric"><span>Snapshot age</span><span id="hardwareSnapshotAge">${html(initial.hardwareSnapshotAge)}</span></div>
          </div>
        </section>

        <section id="tuning" class="panel">
          <div class="group tuning-group">
            <div class="group-title">Camera Presets</div>
            <div class="segmented">
              <button id="cameraPresetFast" type="button">Fast 10fps</button>
              <button id="cameraPresetAccurate" type="button">Clear 6fps</button>
              <button id="cameraPresetDebug" type="button">Inspect 2fps</button>
            </div>
            <div class="metric"><span>Current</span><span id="cameraPresetCurrent">${html(initial.cameraPresetCurrent)}</span></div>
            <div class="metric"><span>Requested</span><span id="cameraPresetRequested">${html(initial.cameraPresetRequested)}</span></div>
            <div class="metric"><span>Actual frame</span><span id="cameraPresetActual">${html(initial.cameraPresetActual)}</span></div>
            <div class="metric"><span>Detector latency</span><span id="cameraDetectorLatency">${html(initial.cameraDetectorLatency)}</span></div>
            <div class="metric"><span>Drop rate</span><span id="cameraDropRate">${html(initial.cameraDropRate)}</span></div>
            <div class="metric"><span>Fallback</span><span id="cameraPresetFallback">${html(initial.cameraPresetFallback)}</span></div>
          </div>
          <div class="group tuning-group">
            <div class="group-title">Detector Sensitivity</div>
            <div class="segmented">
              <button id="detectorPresetLoose" type="button">Loose</button>
              <button id="detectorPresetBalanced" type="button">Balanced</button>
              <button id="detectorPresetStrict" type="button">Strict</button>
            </div>
            <div class="control-row"><label for="detectorDetectionControl">Detection</label><input id="detectorDetectionControl" data-path="detector.minDetectionConfidence" type="range" min="0.05" max="0.8" step="0.01" /><output>-</output></div>
            <div class="control-row"><label for="detectorPresenceControl">Presence</label><input id="detectorPresenceControl" data-path="detector.minPresenceConfidence" type="range" min="0.05" max="0.8" step="0.01" /><output>-</output></div>
            <div class="control-row"><label for="detectorTrackingControl">Tracking</label><input id="detectorTrackingControl" data-path="detector.minTrackingConfidence" type="range" min="0.05" max="0.8" step="0.01" /><output>-</output></div>
            <div class="metric"><span>Current</span><span id="detectorThresholdSummary">${html(initial.detectorThresholdSummary)}</span></div>
          </div>
          <div class="group tuning-group">
            <div class="group-title">Expression Sync</div>
            <div class="metric"><span>Emotion</span><span id="tuneExpressionEmotion">${html(initial.expressionEmotion)}</span></div>
            <div class="metric"><span>Smile</span><span id="tuneExpressionSmile">${html(initial.expressionSmile)}</span></div>
            <div class="metric"><span>Eyes</span><span id="tuneExpressionEyes">${html(initial.expressionEyes)}</span></div>
            <div class="metric"><span>Synced</span><span id="tuneExpressionSynced">${html(initial.expressionSynced)}</span></div>
          </div>
          <div class="group tuning-group">
            <div class="group-title">Tracking PID Presets</div>
            <div class="segmented">
              <button id="presetOfficial" type="button">Official Range</button>
              <button id="presetFast" type="button">Responsive PID</button>
              <button id="presetStable" type="button">Smooth PID</button>
              <button id="presetDefaults" type="button">Reset Defaults</button>
            </div>
          </div>
          <div class="group tuning-group">
            <div class="group-title">PID Controls</div>
            <div class="control-row"><label for="speedControl">Speed</label><input id="speedControl" data-path="speed" type="range" min="0" max="1000" step="10" /><output>-</output></div>
            <div class="control-row"><label for="deadbandControl">Dead</label><input id="deadbandControl" data-path="control.deadband" type="range" min="0" max="0.2" step="0.005" /><output>-</output></div>
            <div class="control-row"><label for="integralLimitControl">I limit</label><input id="integralLimitControl" data-path="control.integralLimit" type="range" min="0" max="1" step="0.05" /><output>-</output></div>
            <div class="control-row"><label for="yawKpControl">Yaw P</label><input id="yawKpControl" data-path="control.yaw.kp" type="range" min="0" max="100" step="1" /><output>-</output></div>
            <div class="control-row"><label for="yawKiControl">Yaw I</label><input id="yawKiControl" data-path="control.yaw.ki" type="range" min="0" max="10" step="0.1" /><output>-</output></div>
            <div class="control-row"><label for="yawKdControl">Yaw D</label><input id="yawKdControl" data-path="control.yaw.kd" type="range" min="0" max="35" step="0.5" /><output>-</output></div>
            <div class="control-row"><label for="pitchKpControl">Pitch P</label><input id="pitchKpControl" data-path="control.pitch.kp" type="range" min="0" max="100" step="1" /><output>-</output></div>
            <div class="control-row"><label for="pitchKiControl">Pitch I</label><input id="pitchKiControl" data-path="control.pitch.ki" type="range" min="0" max="10" step="0.1" /><output>-</output></div>
            <div class="control-row"><label for="pitchKdControl">Pitch D</label><input id="pitchKdControl" data-path="control.pitch.kd" type="range" min="0" max="35" step="0.5" /><output>-</output></div>
            <div class="control-row"><label for="limitControl">Limit</label><input id="limitControl" data-path="control.outputLimitDeg" type="range" min="1" max="45" step="1" /><output>-</output></div>
          </div>
          <div class="group tuning-group">
            <div class="group-title">Servo Range</div>
            <div class="control-row"><label for="yawMinControl">Yaw min</label><input id="yawMinControl" data-path="control.servoRange.yawMin" type="range" min="-1800" max="0" step="10" /><output>-</output></div>
            <div class="control-row"><label for="yawMaxControl">Yaw max</label><input id="yawMaxControl" data-path="control.servoRange.yawMax" type="range" min="0" max="1800" step="10" /><output>-</output></div>
            <div class="control-row"><label for="pitchMinControl">Pitch min</label><input id="pitchMinControl" data-path="control.servoRange.pitchMin" type="range" min="-900" max="1200" step="10" /><output>-</output></div>
            <div class="control-row"><label for="pitchMaxControl">Pitch max</label><input id="pitchMaxControl" data-path="control.servoRange.pitchMax" type="range" min="-900" max="1200" step="10" /><output>-</output></div>
          </div>
          <div class="group tuning-group">
            <div class="group-title">Audio</div>
            <div class="metric"><span>Codex 播报</span><span class="${attr(initial.ttsEnabledClass)}" id="ttsEnabledSummary">${html(initial.ttsEnabledSummary)}</span></div>
            <div class="metric"><span>灯光闪烁</span><span class="${attr(initial.ttsLightEnabledClass)}" id="ttsLightSummary">${html(initial.ttsLightSummary)}</span></div>
            <div class="control-row"><label for="ttsVolumeControl">TTS Vol</label><input id="ttsVolumeControl" type="range" min="0" max="100" step="1" value="${attr(initial.ttsVolume)}" /><output id="ttsVolumeValue">${html(initial.ttsVolume)}</output></div>
            <div class="metric"><span>Completion</span><span id="ttsVolumeSummary">${html(initial.ttsVolumeSummary)}</span></div>
          </div>
          <div class="group tuning-group">
            <div class="group-title">Command</div>
            <div class="metric"><span>Save status</span><span id="tuningSaveState">ready</span></div>
            <div class="metric"><span>Last command</span><span id="tuneCommand">-</span></div>
            <div class="metric"><span>Target center</span><span id="tuneCenter">-</span></div>
          </div>
        </section>

        <section id="debug" class="panel">
          <div class="group">
            <div class="group-title">Device Session</div>
            <div class="metric"><span>Device id</span><span id="debugDeviceId">${html(initial.debugDeviceId)}</span></div>
            <div class="metric"><span>Session id</span><span id="debugSessionId">${html(initial.debugSessionId)}</span></div>
            <div class="metric"><span>Firmware</span><span id="debugFirmware">${html(initial.debugFirmware)}</span></div>
            <div class="metric"><span>Heartbeat</span><span id="debugHeartbeatInterval">${html(initial.debugHeartbeatInterval)}</span></div>
            <div class="metric"><span>Last heartbeat</span><span id="debugLastHeartbeat">${html(initial.debugLastHeartbeat)}</span></div>
            <div class="metric"><span>Offline deadline</span><span id="debugOfflineDeadline">${html(initial.debugOfflineDeadline)}</span></div>
            <div class="metric"><span>Audio frames</span><span id="debugAudioFrames">${html(initial.debugAudioFrames)}</span></div>
            <div class="metric"><span>Last event</span><span id="debugLastEvent">${html(initial.debugLastEvent)}</span></div>
          </div>
          <div class="group">
            <div class="group-title">Counters</div>
            <div class="metric"><span>Vision frames</span><span id="debugVisionFrames">${html(initial.debugVisionFrames)}</span></div>
            <div class="metric"><span>Vision drops</span><span id="debugVisionDrops">${html(initial.debugVisionDrops)}</span></div>
            <div class="metric"><span>Detector latency</span><span id="debugDetectorLatency">${html(initial.cameraDetectorLatency)}</span></div>
            <div class="metric"><span>Frame seq</span><span id="debugFrameSeq">${html(initial.debugFrameSeq)}</span></div>
            <div class="metric"><span>Frame age</span><span id="debugFrameLatency">${html(initial.debugFrameLatency)}</span></div>
            <div class="metric"><span>Device to daemon</span><span id="debugDeviceToDaemon">${html(initial.debugDeviceToDaemon)}</span></div>
            <div class="metric"><span>Capture to detector</span><span id="debugDetectorEndToEnd">${html(initial.debugDetectorEndToEnd)}</span></div>
            <div class="metric"><span>Camera preset</span><span id="debugCameraPreset">${html(initial.cameraPresetCurrent)}</span></div>
            <div class="metric"><span>Camera transport</span><span id="debugCameraTransport">${html(initial.debugCameraTransport)}</span></div>
            <div class="metric"><span>Adaptive stream</span><span id="debugAdaptiveStream">${html(initial.debugAdaptiveStream)}</span></div>
            <div class="metric"><span>Media credit</span><span id="debugMediaCredit">${html(initial.debugMediaCredit)}</span></div>
          </div>
          <div class="group">
            <div class="group-title">Raw Snapshot</div>
            <pre id="rawSnapshot">${html(initial.rawSnapshot)}</pre>
          </div>
        </section>

        <section id="logs" class="panel">
          <div class="log-controls">
            <input id="logSearch" placeholder="Search logs" />
            <select id="logType">
              <option value="">All types</option>
              <option value="system">system</option>
              <option value="device">device</option>
              <option value="vision">vision</option>
              <option value="command">command</option>
            </select>
            <select id="logLevel">
              <option value="">All levels</option>
              <option value="debug">debug+</option>
              <option value="info">info+</option>
              <option value="warn">warn+</option>
              <option value="error">error</option>
            </select>
          </div>
          <div class="toolbar">
            <button id="pauseLogs" type="button">Pause</button>
            <button id="clearLogs" type="button">Clear view</button>
          </div>
          <div id="logList" class="logs"></div>
        </section>
      </aside>
    </main>
  </div>

  <script>
    const $ = (id) => document.getElementById(id);
    const frame = $('frame');
    const overlay = $('overlay');
    const ctx = overlay.getContext('2d');
    const empty = $('empty');
    const controls = Array.from(document.querySelectorAll('[data-path]'));
	    const ttsVolumeControl = $('ttsVolumeControl');
	    const toggleCompletionTts = $('toggleCompletionTts');
	    const toggleCompletionLight = $('toggleCompletionLight');
	    const testCompletionTts = $('testCompletionTts');
    const rgbColorInput = $('rgbColor');
    const rgbToggle = $('rgbToggle');
    let imuFusion = null;
    let imu3d = null;
    let latest = null;
    let lastFrameId = frame.dataset.frameId || null;
    let frameStreamActive = (frame.getAttribute('src') || '').indexOf('/stream.mjpg') === 0;
    let frameStreamRestartTimer = null;
    let controlTimer = null;
    let controlSavedTimer = null;
    let ttsVolumeTimer = null;
    let logsPaused = false;
    let logRenderTimer = null;
    let lastRawSnapshotAt = 0;
    let logEntries = [];

    const officialServoRange = { yawMin: -1280, yawMax: 1280, pitchMin: 0, pitchMax: 900 };
    const presets = {
      official: { speed: 420, control: { deadband: 0.045, integralLimit: 0.35, outputLimitDeg: 20, yaw: { kp: 42, ki: 0, kd: 8 }, pitch: { kp: 30, ki: 0, kd: 6 }, servoRange: officialServoRange } },
      fast: { speed: 760, control: { deadband: 0.018, integralLimit: 0.22, outputLimitDeg: 32, yaw: { kp: 78, ki: 0, kd: 10 }, pitch: { kp: 54, ki: 0, kd: 8 }, servoRange: officialServoRange } },
      stable: { speed: 480, control: { deadband: 0.06, integralLimit: 0.2, outputLimitDeg: 16, yaw: { kp: 36, ki: 0, kd: 12 }, pitch: { kp: 26, ki: 0, kd: 8 }, servoRange: officialServoRange } },
      defaults: { speed: 760, control: { deadband: 0.018, integralLimit: 0.22, outputLimitDeg: 32, yaw: { kp: 78, ki: 0, kd: 10 }, pitch: { kp: 54, ki: 0, kd: 8 }, servoRange: officialServoRange } }
    };
    const cameraPresetIds = {
      fast: 'cameraPresetFast',
      accurate: 'cameraPresetAccurate',
      debug: 'cameraPresetDebug'
    };
    const pidPresetIds = {
      official: 'presetOfficial',
      fast: 'presetFast',
      stable: 'presetStable'
    };
    const detectorPresets = {
      loose: { detector: { minDetectionConfidence: 0.18, minPresenceConfidence: 0.18, minTrackingConfidence: 0.18 } },
      balanced: { detector: { minDetectionConfidence: 0.25, minPresenceConfidence: 0.25, minTrackingConfidence: 0.25 } },
      strict: { detector: { minDetectionConfidence: 0.35, minPresenceConfidence: 0.35, minTrackingConfidence: 0.35 } }
    };
    const detectorPresetIds = {
      loose: 'detectorPresetLoose',
      balanced: 'detectorPresetBalanced',
      strict: 'detectorPresetStrict'
    };

    function setText(id, value, className) {
      const node = $(id);
      if (!node) return;
      node.textContent = value == null || value === '' ? '-' : String(value);
      const preserved = node.classList.contains('metric-value') ? 'metric-value' : '';
      node.className = [preserved, className || ''].filter(Boolean).join(' ');
    }

    function fmtTime(value) {
      if (!value) return '-';
      const date = new Date(value);
      return Number.isFinite(date.getTime()) ? date.toLocaleTimeString() : '-';
    }

    function age(value) {
      if (!value) return '-';
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) return '-';
      const ms = Date.now() - date.getTime();
      if (ms < 1000) return ms + ' ms';
      return (ms / 1000).toFixed(1) + ' s';
    }

    function pct(value) {
      return Number.isFinite(value) ? (value * 100).toFixed(1) + '%' : '-';
    }

    function num(value, digits = 2) {
      return Number.isFinite(value) ? Number(value).toFixed(digits) : '-';
    }

    function firstDefined() {
      for (const value of arguments) {
        if (value !== undefined && value !== null) return value;
      }
      return null;
    }

    function formatBattery(sensor) {
      if (!sensor) return '-';
      return Math.round(sensor.level) + '%' + (sensor.charging ? ' charging' : '');
    }

    function formatWifi(sensor) {
      if (!sensor) return '-';
      const rssi = Number.isFinite(sensor.rssi) ? ' ' + sensor.rssi + ' dBm' : '';
      return sensor.status + rssi;
    }

    function formatImu(sensor) {
      if (!sensor) return '-';
      const gyro = gyroMagnitude(sensor);
      const gyroText = Number.isFinite(gyro) ? ' / ' + num(gyro, 1) + ' dps' : '';
      return sensor.motion + ' ' + num(accelMagnitude(sensor), 2) + gyroText;
    }

    function boolText(value) {
      return typeof value === 'boolean' ? (value ? 'yes' : 'no') : '-';
    }

    function unavailableLabel(item) {
      const reason = item && typeof item.reason === 'string' ? item.reason : '';
      if (reason.indexOf('not_detected_i2c') === 0) return 'Not detected';
      if (reason === 'driver_not_wired') return 'Driver not wired';
      if (reason === 'driver_unavailable') return 'Driver unavailable';
      if (reason === 'io_expander_unavailable') return 'IO expander unavailable';
      return 'Unavailable';
    }

    function availability(item, availableText) {
      if (!item) return '-';
      if (item.available === false) return unavailableLabel(item) + (item.reason ? ': ' + item.reason : '');
      if (item.available === true) return availableText || 'available';
      return '-';
    }

    function formatPowerValue(value, suffix) {
      return Number.isFinite(value) ? Math.round(value) + suffix : '-';
    }

    function formatPowerMonitor(item) {
      if (!item) return '-';
      if (item.available === false) return formatProbe(item);
      const parts = [];
      if (Number.isFinite(item.busVoltage)) parts.push(num(item.busVoltage, 3) + ' V');
      if (Number.isFinite(item.current)) parts.push(num(item.current * 1000, 1) + ' mA');
      if (Number.isFinite(item.power)) parts.push(num(item.power * 1000, 1) + ' mW');
      if (Number.isFinite(item.shuntVoltage)) parts.push('shunt ' + num(item.shuntVoltage * 1000, 3) + ' mV');
      return formatProbe(item, parts.length ? parts.join(' / ') : 'available');
    }

    function formatI2cAddressList(addresses) {
      if (!Array.isArray(addresses) || addresses.length === 0) return 'none';
      return addresses
        .filter((address) => Number.isFinite(address))
        .map((address) => '0x' + Number(address).toString(16).padStart(2, '0'))
        .join(' ');
    }

    function targetMark(value) {
      return value ? 'yes' : 'no';
    }

    function formatI2cScan(scans) {
      if (!Array.isArray(scans) || scans.length === 0) return '-';
      const latest = scans[scans.length - 1] || {};
      const targets = latest.targets || {};
      const targetText = 'targets LTR ' + targetMark(targets.ltr553) + ' / INA ' + targetMark(targets.ina226) + ' / NFC ' + targetMark(targets.nfc);
      const stageText = scans.map((scan) => {
        const reason = scan.reason ? ' / ' + scan.reason : '';
        return String(scan.stage || 'scan') + ': ' + formatI2cAddressList(scan.addresses) + reason;
      }).join(' | ');
      return targetText + ' / ' + stageText;
    }

    function formatBle(item) {
      if (!item) return '-';
      if (item.available === false) return availability(item);
      return 'available / ' + (item.connected ? 'connected' : 'not connected') + (item.provisioning ? ' / provisioning' : '');
    }

    function formatServoAxis(axis) {
      if (!axis) return '-';
      const parts = [];
      if (Number.isFinite(axis.angle)) parts.push(num(axis.angle, 1) + ' deg');
      if (typeof axis.moving === 'boolean') parts.push(axis.moving ? 'moving' : 'still');
      if (typeof axis.torque === 'boolean') parts.push(axis.torque ? 'torque on' : 'torque off');
      return parts.length ? parts.join(' / ') : '-';
    }

    function formatHeadTouch(item) {
      if (!item) return '-';
      if (item.available === false) return availability(item);
      const zones = Array.isArray(item.zones) && item.zones.length ? ' zones ' + item.zones.join(',') : '';
      return (item.pressed ? 'pressed' : 'released') + (item.gesture ? ' / ' + item.gesture : '') + zones;
    }

    function formatScreenTouch(item) {
      if (!item) return '-';
      if (item.available === false) return availability(item);
      const point = Number.isFinite(item.x) && Number.isFinite(item.y) ? Math.round(item.x) + ', ' + Math.round(item.y) : '-';
      const points = Number.isFinite(item.points) ? ' / ' + item.points + ' point(s)' : '';
      return (item.pressed ? 'pressed ' : 'released ') + point + points;
    }

    function formatCamera(item) {
      if (!item) return '-';
      if (item.available === false) return availability(item);
      const actualWidth = firstDefined(item.actualWidth, item.width);
      const actualHeight = firstDefined(item.actualHeight, item.height);
      const size = Number.isFinite(actualWidth) && Number.isFinite(actualHeight) ? actualWidth + ' x ' + actualHeight : '-';
      const fps = Number.isFinite(item.fps) ? ' / ' + num(item.fps, 1) + ' fps' : '';
      const quality = Number.isFinite(item.quality) ? ' / q' + item.quality : '';
      const transport = item.transport ? ' / ' + item.transport : '';
      return (item.streaming ? 'streaming ' : 'ready ') + size + fps + quality + transport;
    }

    function cameraRequested(item, settings) {
      const width = firstDefined(item && item.requestedWidth, settings && settings.width);
      const height = firstDefined(item && item.requestedHeight, settings && settings.height);
      const fps = firstDefined(item && item.fps, settings && settings.fps);
      const quality = firstDefined(item && item.quality, settings && settings.quality);
      const size = Number.isFinite(width) && Number.isFinite(height) ? width + ' x ' + height : '-';
      const fpsText = Number.isFinite(fps) ? ' / ' + num(fps, 1) + ' fps' : '';
      const qualityText = Number.isFinite(quality) ? ' / q' + quality : '';
      return size + fpsText + qualityText;
    }

    function cameraActual(item, frame) {
      const width = firstDefined(item && item.actualWidth, item && item.width, frame && frame.width);
      const height = firstDefined(item && item.actualHeight, item && item.height, frame && frame.height);
      return Number.isFinite(width) && Number.isFinite(height) ? width + ' x ' + height : '-';
    }

    function formatCameraQuality(item, settings) {
      const quality = firstDefined(item && item.quality, settings && settings.quality);
      return Number.isFinite(quality) ? String(quality) : '-';
    }

    function formatCameraFallback(item) {
      return item && item.fallbackReason ? item.fallbackReason : '-';
    }

    function formatAdaptiveStatus(adaptive, camera) {
      const level = firstDefined(camera && camera.adaptiveLevel, adaptive && adaptive.level);
      if (!Number.isFinite(level)) return '-';
      const parts = ['level ' + level];
      if (adaptive && adaptive.active) parts.push('active');
      if (adaptive && Number.isFinite(adaptive.fps)) parts.push(num(adaptive.fps, 1) + ' fps');
      if (adaptive && Number.isFinite(adaptive.quality)) parts.push('q' + adaptive.quality);
      if (adaptive && Number.isFinite(adaptive.dropRate)) parts.push('drops ' + pct(adaptive.dropRate));
      if (adaptive && adaptive.reason) parts.push(adaptive.reason);
      return parts.join(' / ');
    }

    function formatLatency(ms) {
      return Number.isFinite(ms) ? Math.round(ms) + ' ms' : '-';
    }

    function formatMediaCredit(mediaCredit) {
      if (!mediaCredit) return '-';
      const parts = [mediaCredit.enabled ? 'enabled' : 'fallback'];
      if (Number.isFinite(mediaCredit.grantedFrames)) parts.push(mediaCredit.grantedFrames + ' granted');
      if (mediaCredit.reason) parts.push(mediaCredit.reason);
      if (mediaCredit.lastGrantedAt) parts.push('last ' + age(mediaCredit.lastGrantedAt));
      return parts.join(' / ');
    }

    function updateCameraPresetButtons(preset) {
      for (const [name, id] of Object.entries(cameraPresetIds)) {
        const button = $(id);
        if (button) {
          const active = name === preset;
          button.classList.toggle('active', active);
          button.setAttribute('aria-pressed', String(active));
        }
      }
    }

    function updatePidPresetButtons(settings) {
      for (const [name, id] of Object.entries(pidPresetIds)) {
        const button = $(id);
        if (button) {
          const active = matchesPreset(settings, presets[name]);
          button.classList.toggle('active', active);
          button.setAttribute('aria-pressed', String(active));
        }
      }
    }

    function updateDetectorPresetButtons(settings) {
      for (const [name, id] of Object.entries(detectorPresetIds)) {
        const button = $(id);
        if (button) {
          const active = matchesDetectorPreset(settings, detectorPresets[name]);
          button.classList.toggle('active', active);
          button.setAttribute('aria-pressed', String(active));
        }
      }
    }

    function matchesPreset(settings, preset) {
      if (!settings || !preset) return false;
      return sameNumber(settings.speed, preset.speed)
        && matchesControl(settings.control, preset.control);
    }

    function matchesControl(current, expected) {
      if (!current || !expected) return false;
      return sameNumber(current.deadband, expected.deadband)
        && sameNumber(current.integralLimit, expected.integralLimit)
        && sameNumber(current.outputLimitDeg, expected.outputLimitDeg)
        && matchesAxis(current.yaw, expected.yaw)
        && matchesAxis(current.pitch, expected.pitch)
        && matchesServoRange(current.servoRange, expected.servoRange);
    }

    function matchesAxis(current, expected) {
      return current && expected
        && sameNumber(current.kp, expected.kp)
        && sameNumber(current.ki, expected.ki)
        && sameNumber(current.kd, expected.kd);
    }

    function matchesServoRange(current, expected) {
      return current && expected
        && sameNumber(current.yawMin, expected.yawMin)
        && sameNumber(current.yawMax, expected.yawMax)
        && sameNumber(current.pitchMin, expected.pitchMin)
        && sameNumber(current.pitchMax, expected.pitchMax);
    }

    function matchesDetectorPreset(settings, preset) {
      const current = settings && settings.detector;
      const expected = preset && preset.detector;
      return current && expected
        && sameNumber(current.minDetectionConfidence, expected.minDetectionConfidence)
        && sameNumber(current.minPresenceConfidence, expected.minPresenceConfidence)
        && sameNumber(current.minTrackingConfidence, expected.minTrackingConfidence);
    }

    function sameNumber(left, right) {
      return Number.isFinite(left) && Number.isFinite(right) && Math.abs(Number(left) - Number(right)) < 0.0001;
    }

    function formatRtc(item) {
      if (!item) return '-';
      if (item.available === false) return availability(item);
      const time = item.timestamp ? fmtTime(item.timestamp) : 'available';
      return time + (item.timezone ? ' / ' + item.timezone : '');
    }

    function formatMic(item) {
      if (!item) return '-';
      if (item.available === false) return availability(item);
      const channels = Number.isFinite(item.channels) ? item.channels + ' ch' : 'available';
      const level = Number.isFinite(item.level) ? ' / calibrated ' + Math.round(item.level * 100) + '%' : '';
      const dbfs = Number.isFinite(item.dbfs) ? ' / raw ' + num(item.dbfs, 1) + ' dBFS' : '';
      return channels + (item.mode ? ' / ' + item.mode : '') + level + dbfs + (item.localization ? ' / localization ' + item.localization : '');
    }

    function formatRgb(item) {
      if (!item) return '-';
      if (item.available === false) return availability(item);
      const parts = ['available'];
      if (Number.isFinite(item.count)) parts.push(item.count + ' LEDs');
      if (typeof item.enabled === 'boolean') parts.push(item.enabled ? 'on' : 'off');
      if (item.color) parts.push(item.color);
      if (Number.isFinite(item.brightness)) parts.push(Math.round(item.brightness * 100) + '%');
      if (item.driver) parts.push(item.driver);
      return parts.join(' / ');
    }

    function formatProbe(item, valueText) {
      if (!item) return '-';
      const parts = [];
      if (item.available === true) {
        parts.push(valueText || 'available');
      } else if (item.available === false) {
        parts.push(unavailableLabel(item));
      }
      if (item.driver) parts.push(item.driver);
      if (Number.isFinite(item.address)) parts.push('0x' + Number(item.address).toString(16).padStart(2, '0'));
      if (item.status) parts.push(item.status);
      if (Number.isFinite(item.txPin)) parts.push('TX GPIO' + item.txPin);
      if (Number.isFinite(item.rxPin)) parts.push('RX GPIO' + item.rxPin);
      if (item.reason) parts.push(item.reason);
      return parts.length ? parts.join(' / ') : availability(item);
    }

    function micLevelPercent(item) {
      return item && Number.isFinite(item.level) ? Math.max(0, Math.min(100, Math.round(item.level * 100))) : 0;
    }

    function updateMicLevel(item) {
      const fill = $('hardwareMicLevelFill');
      const text = $('hardwareMicLevelText');
      const percent = micLevelPercent(item);
      if (fill) fill.style.width = percent + '%';
      if (text) {
        const dbfs = item && Number.isFinite(item.dbfs) ? ' / raw ' + num(item.dbfs, 1) + ' dBFS' : '';
        text.textContent = item && item.available ? percent + '% calibrated' + dbfs : '-';
      }
    }

    function updateRgbControls(item) {
      const enabled = Boolean(item && item.enabled);
      const color = item && /^#[0-9a-fA-F]{6}$/.test(String(item.color || '')) ? String(item.color).toUpperCase() : '#43D5B0';
      if (rgbColorInput && document.activeElement !== rgbColorInput) {
        rgbColorInput.value = color;
      }
      if (rgbToggle) {
        rgbToggle.classList.toggle('active', enabled);
        rgbToggle.textContent = enabled ? 'RGB On' : 'RGB Off';
        rgbToggle.disabled = Boolean(item && item.available === false);
      }
    }

    function accelMagnitude(sensor) {
      if (!sensor || !Number.isFinite(sensor.x) || !Number.isFinite(sensor.y) || !Number.isFinite(sensor.z)) return NaN;
      return Math.sqrt(sensor.x * sensor.x + sensor.y * sensor.y + sensor.z * sensor.z);
    }

    function gyroMagnitude(sensor) {
      if (!hasGyro(sensor)) return NaN;
      return Math.sqrt(sensor.gyroX * sensor.gyroX + sensor.gyroY * sensor.gyroY + sensor.gyroZ * sensor.gyroZ);
    }

    function hasGyro(sensor) {
      return Boolean(sensor)
        && Number.isFinite(sensor.gyroX)
        && Number.isFinite(sensor.gyroY)
        && Number.isFinite(sensor.gyroZ);
    }

    function imuAngles(sensor) {
      const magnitude = accelMagnitude(sensor);
      if (!Number.isFinite(magnitude) || magnitude <= 0.0001) return null;
      const roll = Math.atan2(sensor.y, sensor.z) * 180 / Math.PI;
      const pitch = Math.atan2(-sensor.x, Math.sqrt(sensor.y * sensor.y + sensor.z * sensor.z)) * 180 / Math.PI;
      return { roll, pitch };
    }

    function imuEventTime(sensor) {
      if (!sensor) return Date.now();
      if (Number.isFinite(sensor.uptimeMs)) return sensor.uptimeMs;
      const received = sensor.receivedAt ? new Date(sensor.receivedAt).getTime() : NaN;
      if (Number.isFinite(received)) return received;
      const updated = sensor.updatedAt ? new Date(sensor.updatedAt).getTime() : NaN;
      return Number.isFinite(updated) ? updated : Date.now();
    }

    class AngleKalmanFilter {
      constructor({ qAngle = 0.001, qBias = 0.003, rMeasure = 0.03 } = {}) {
        this.qAngle = qAngle;
        this.qBias = qBias;
        this.rMeasure = rMeasure;
        this.angle = 0;
        this.bias = 0;
        this.rate = 0;
        this.p00 = 0;
        this.p01 = 0;
        this.p10 = 0;
        this.p11 = 0;
      }

      reset(angle) {
        this.angle = angle;
        this.bias = 0;
        this.rate = 0;
        this.p00 = 0;
        this.p01 = 0;
        this.p10 = 0;
        this.p11 = 0;
      }

      update(measuredAngle, measuredRate, dt) {
        this.rate = measuredRate - this.bias;
        this.angle = normalizeAngle(this.angle + dt * this.rate);

        this.p00 += dt * (dt * this.p11 - this.p01 - this.p10 + this.qAngle);
        this.p01 -= dt * this.p11;
        this.p10 -= dt * this.p11;
        this.p11 += this.qBias * dt;

        const innovation = normalizeAngle(measuredAngle - this.angle);
        const s = this.p00 + this.rMeasure;
        const k0 = this.p00 / s;
        const k1 = this.p10 / s;
        const p00 = this.p00;
        const p01 = this.p01;

        this.angle = normalizeAngle(this.angle + k0 * innovation);
        this.bias += k1 * innovation;
        this.p00 -= k0 * p00;
        this.p01 -= k0 * p01;
        this.p10 -= k1 * p00;
        this.p11 -= k1 * p01;

        return { angle: this.angle, rate: this.rate, bias: this.bias };
      }
    }

    function createImuFusion() {
      const rollFilter = new AngleKalmanFilter();
      const pitchFilter = new AngleKalmanFilter();
      const gyroDeadbandDps = 0.12;
      const maxDtSeconds = 0.35;
      let state = null;
      let lastEventId = null;

      return {
        update(sensor) {
          const accel = imuAngles(sensor);
          if (!accel) {
            state = null;
            lastEventId = null;
            return null;
          }

          const eventId = firstDefined(sensor && sensor.eventId, sensor && sensor.uptimeMs, sensor && sensor.receivedAt, sensor && sensor.updatedAt);
          const timestamp = imuEventTime(sensor);
          if (!state) {
            rollFilter.reset(accel.roll);
            pitchFilter.reset(accel.pitch);
            state = { roll: accel.roll, pitch: accel.pitch, yaw: 0, lastTime: timestamp, rollRate: 0, pitchRate: 0 };
            lastEventId = eventId;
          }

          if (eventId && eventId === lastEventId) {
            return {
              roll: state.roll,
              pitch: state.pitch,
              yaw: state.yaw,
              source: hasGyro(sensor) ? 'kalman hold' : 'accel hold',
              hasGyro: hasGyro(sensor),
              dt: 0,
              accelRoll: accel.roll,
              accelPitch: accel.pitch,
              rollRate: state.rollRate,
              pitchRate: state.pitchRate
            };
          }

          const dt = Number.isFinite(timestamp) && Number.isFinite(state.lastTime)
            ? (timestamp - state.lastTime) / 1000
            : 0;
          const boundedDt = dt > 0 && dt <= maxDtSeconds ? dt : 0;
          const gyroReady = hasGyro(sensor);

          if (gyroReady && boundedDt > 0) {
            const gx = applyDeadband(sensor.gyroX, gyroDeadbandDps);
            const gy = applyDeadband(sensor.gyroY, gyroDeadbandDps);
            const gz = applyDeadband(sensor.gyroZ, gyroDeadbandDps);
            const roll = rollFilter.update(accel.roll, gx, boundedDt);
            const pitch = pitchFilter.update(accel.pitch, gy, boundedDt);
            const gravityError = Math.abs(accelMagnitude(sensor) - 9.80665);

            if (gravityError > 3.2) {
              state.roll = normalizeAngle(state.roll + gx * boundedDt);
              state.pitch = normalizeAngle(state.pitch + gy * boundedDt);
            } else {
              state.roll = roll.angle;
              state.pitch = pitch.angle;
            }
            state.yaw = normalizeAngle(state.yaw + gz * boundedDt);
            state.rollRate = roll.rate;
            state.pitchRate = pitch.rate;
          } else {
            state.roll = blendAngle(state.roll, accel.roll, 0.18);
            state.pitch = blendAngle(state.pitch, accel.pitch, 0.18);
            state.rollRate = 0;
            state.pitchRate = 0;
          }

          state.lastTime = timestamp;
          lastEventId = eventId;
          return {
            roll: state.roll,
            pitch: state.pitch,
            yaw: state.yaw,
            source: gyroReady ? 'kalman' : 'accel',
            hasGyro: gyroReady,
            dt: boundedDt,
            accelRoll: accel.roll,
            accelPitch: accel.pitch,
            rollRate: state.rollRate,
            pitchRate: state.pitchRate
          };
        }
      };
    }

    function applyDeadband(value, deadband) {
      return Math.abs(value) < deadband ? 0 : value;
    }

    function normalizeAngle(value) {
      let next = value;
      while (next > 180) next -= 360;
      while (next < -180) next += 360;
      return next;
    }

    function blendAngle(from, to, toWeight) {
      return normalizeAngle(from + normalizeAngle(to - from) * toWeight);
    }

    function degToRad(value) {
      return value * Math.PI / 180;
    }

    function createImu3dScene(container) {
      if (!container) {
        setText('imu3dStatus', '3D unavailable', 'warn');
        return null;
      }

      try {
        container.innerHTML = '<div class="imu-gravity"></div><div class="imu-cube"><div class="imu-cube-face imu-cube-front"></div><div class="imu-cube-face imu-cube-back"></div><div class="imu-cube-face imu-cube-top"></div><div class="imu-cube-face imu-cube-bottom"></div><div class="imu-cube-face imu-cube-left"></div><div class="imu-cube-face imu-cube-right"></div></div>';
        const cube = container.querySelector('.imu-cube');
        const gravity = container.querySelector('.imu-gravity');

        return {
          update(sensor, orientation) {
            const magnitude = accelMagnitude(sensor);
            if (!Number.isFinite(magnitude) || magnitude <= 0.0001) {
              setText('imu3dStatus', 'Waiting', 'warn');
              return;
            }
            if (!orientation) {
              setText('imu3dStatus', 'Live', 'ok');
              return;
            }
            const roll = Number.isFinite(orientation.roll) ? orientation.roll : 0;
            const pitch = Number.isFinite(orientation.pitch) ? orientation.pitch : 0;
            const yaw = Number.isFinite(orientation.yaw) ? orientation.yaw : 0;
            cube.style.transform = 'rotateZ(' + yaw + 'deg) rotateX(' + (-pitch) + 'deg) rotateY(' + roll + 'deg)';
            gravity.style.height = Math.max(42, Math.min(112, magnitude * 8)) + 'px';
            gravity.style.transform = 'translate(-50%, -8px) rotateZ(' + (-roll) + 'deg) rotateX(' + pitch + 'deg)';
            setText('imu3dStatus', orientation && orientation.hasGyro ? 'Kalman' : 'Live', 'ok');
          }
        };
      } catch (error) {
        setText('imu3dStatus', '3D unavailable', 'warn');
        return null;
      }
    }

    imuFusion = createImuFusion();
    imu3d = createImu3dScene($('imu3dScene'));

    function readPath(value, path) {
      return path.split('.').reduce((current, key) => current && current[key], value);
    }

    function writePath(value, path, next) {
      const keys = path.split('.');
      let current = value;
      for (const key of keys.slice(0, -1)) {
        current[key] = current[key] || {};
        current = current[key];
      }
      current[keys[keys.length - 1]] = next;
    }

    function render(snapshot) {
      latest = snapshot;
      const status = snapshot.status || {};
      const device = (snapshot.devices || []).find((item) => item.status === 'online') || (snapshot.devices || [])[0];
      const sensors = device && device.sensors ? device.sensors : {};
      const hardware = sensors.sensorSnapshot || {};
      const power = hardware.power || {};
      const network = hardware.network || {};
      const motion = hardware.motion || {};
      const interaction = hardware.interaction || {};
      const peripherals = hardware.peripherals || {};
      const wifi = network.wifi || sensors.wifi;
      const imu = sensors.imu || (motion.imu && motion.imu.available ? motion.imu : null);
      const dropRate = status.framesReceived ? status.framesDropped / status.framesReceived : 0;
      const cameraSettings = status.control && status.control.camera || {};
      const batteryText = Number.isFinite(power.batteryLevel)
        ? Math.round(power.batteryLevel) + '%' + (power.charging ? ' charging' : '')
        : formatBattery(sensors.battery);

      setText('subtitle', device ? device.deviceId : 'No StackChan device connected');
      setText('statDevice', device ? device.status : 'offline', device && device.status === 'online' ? 'ok' : 'bad');
      setText('statFace', status.enabled ? 'on' : 'off', status.enabled ? 'ok' : 'warn');
      setText('statFaces', (snapshot.faces || []).length);
      setText('statFps', status.fps || '-');
      setText('statBattery', batteryText, (power.charging || (sensors.battery && sensors.battery.charging)) ? 'ok' : '');
      setText('statWifi', formatWifi(wifi), wifi && wifi.status === 'connected' ? 'ok' : 'warn');
      setText('statImu', formatImu(imu));
      setText('statDropped', status.framesDropped + ' / ' + pct(dropRate), dropRate > 0.08 ? 'warn' : '');
      setText('statDetector', status.detectorAvailable ? 'ready' : 'down', status.detectorAvailable ? 'ok' : 'bad');
      setText('statError', status.lastError || '-');

      $('toggleTracking').classList.toggle('active', Boolean(status.enabled));
      $('toggleTracking').textContent = status.enabled ? 'Face on' : 'Face off';

      setText('faceEnabled', status.enabled ? 'yes' : 'no', status.enabled ? 'ok' : 'warn');
      setText('lastFace', age(status.lastFaceAt));
      setText('lastFaceCommand', age(status.lastCommandAt));
      setText('targetBox', formatBox(snapshot.target));
      setText('expressionEmotion', formatExpressionEmotion(status, snapshot));
      setText('expressionSmile', formatExpressionSmile(status, snapshot));
      setText('expressionEyes', formatExpressionEyes(status, snapshot));
      setText('expressionMouth', formatExpressionMouth(status, snapshot));
      setText('expressionBlendshapes', formatExpressionBlendshapes(status, snapshot));
      setText('expressionSynced', age(status.lastExpressionCommandAt));
      setText('deviceStatus', device && device.status || '-');
      setText('deviceMode', device && device.mode || '-');
      setText('deviceSeen', age(device && device.lastSeenAt));
      setText('deviceCaps', (device && device.capabilities || []).join(', '));

      setText('sensorBatteryLevel', Number.isFinite(power.batteryLevel) ? Math.round(power.batteryLevel) + '%' : (sensors.battery ? Math.round(sensors.battery.level) + '%' : '-'));
      setText('sensorBatteryCharging', typeof power.charging === 'boolean' ? boolText(power.charging) : (sensors.battery ? (sensors.battery.charging ? 'yes' : 'no') : '-'));
      setText('hardwarePowerMonitor', formatPowerMonitor(peripherals.powerMonitor));
      setText('hardwareBacklight', formatPowerValue(power.backlight, '%'));
      setText('hardwareSpeaker', formatPowerValue(power.speakerVolume, '%'));
      setText('hardwareServoPower', boolText(power.servoPower));
      setText('hardwareIoExpander', availability(peripherals.ioExpander));
      setText('hardwareI2cScan', formatI2cScan(peripherals.i2cScan));
      setText('sensorBatteryAge', age(hardware.updatedAt || sensors.battery && sensors.battery.updatedAt));
      setText('sensorWifiStatus', wifi && wifi.status || '-');
      setText('sensorWifiSsid', wifi && wifi.ssid || '-');
      setText('sensorWifiRssi', Number.isFinite(wifi && wifi.rssi) ? wifi.rssi + ' dBm' : '-');
      setText('sensorWifiAge', age(hardware.updatedAt || sensors.wifi && sensors.wifi.updatedAt));
      setText('hardwareBle', formatBle(network.ble));
      setText('sensorImuMotion', imu && imu.motion || '-');
      setText('sensorImuX', num(imu && imu.x, 3));
      setText('sensorImuY', num(imu && imu.y, 3));
      setText('sensorImuZ', num(imu && imu.z, 3));
      setText('sensorImuGyroX', Number.isFinite(imu && imu.gyroX) ? num(imu.gyroX, 2) + ' dps' : '-');
      setText('sensorImuGyroY', Number.isFinite(imu && imu.gyroY) ? num(imu.gyroY, 2) + ' dps' : '-');
      setText('sensorImuGyroZ', Number.isFinite(imu && imu.gyroZ) ? num(imu.gyroZ, 2) + ' dps' : '-');
      setText('sensorImuMagnitude', num(accelMagnitude(imu), 3));
      setText('sensorImuGyroMagnitude', Number.isFinite(gyroMagnitude(imu)) ? num(gyroMagnitude(imu), 2) + ' dps' : '-');
      const accelAngles = imuAngles(imu);
      const fusedAngles = imuFusion.update(imu);
      const angles = fusedAngles || accelAngles;
      setText('sensorImuRoll', angles ? num(angles.roll, 1) + ' deg' : '-');
      setText('sensorImuPitch', angles ? num(angles.pitch, 1) + ' deg' : '-');
      setText('sensorImuYaw', fusedAngles ? num(fusedAngles.yaw, 1) + ' deg' : '-');
      setText('sensorImuAccelRoll', accelAngles ? num(accelAngles.roll, 1) + ' deg' : '-');
      setText('sensorImuAccelPitch', accelAngles ? num(accelAngles.pitch, 1) + ' deg' : '-');
      setText('sensorImuRollRate', Number.isFinite(fusedAngles && fusedAngles.rollRate) ? num(fusedAngles.rollRate, 2) + ' dps' : '-');
      setText('sensorImuPitchRate', Number.isFinite(fusedAngles && fusedAngles.pitchRate) ? num(fusedAngles.pitchRate, 2) + ' dps' : '-');
      setText('sensorImuDt', Number.isFinite(fusedAngles && fusedAngles.dt) ? num(fusedAngles.dt, 3) + ' s' : '-');
      setText('sensorImuFilter', fusedAngles && fusedAngles.source || (accelAngles ? 'accel' : '-'), fusedAngles && fusedAngles.hasGyro ? 'ok' : 'warn');
      setText('imuRoll', angles ? 'Roll ' + num(angles.roll, 1) + ' deg' : 'Roll -');
      setText('imuPitch', angles ? 'Pitch ' + num(angles.pitch, 1) + ' deg' : 'Pitch -');
      setText('imuYaw', fusedAngles ? 'Yaw ' + num(fusedAngles.yaw, 1) + ' deg' : 'Yaw -');
      if (imu3d) imu3d.update(imu, fusedAngles || angles);
      setText('hardwareYawServo', formatServoAxis(motion.servos && motion.servos.yaw));
      setText('hardwarePitchServo', formatServoAxis(motion.servos && motion.servos.pitch));
      setText('sensorImuAge', age((imu && imu.updatedAt) || hardware.updatedAt));
      setText('sensorTouchSurface', sensors.touch && sensors.touch.surface || '-');
      setText('sensorTouchGesture', sensors.touch && sensors.touch.gesture || '-');
      setText('sensorTouchPressed', sensors.touch && typeof sensors.touch.pressed === 'boolean' ? (sensors.touch.pressed ? 'yes' : 'no') : '-');
      setText('sensorTouchPoint', formatTouchPoint(sensors.touch) !== '-' ? formatTouchPoint(sensors.touch) : formatScreenTouch(interaction.screenTouch));
      setText('hardwareHeadTouch', formatHeadTouch(interaction.headTouch));
      setText('hardwareWakeWord', interaction.wakeWord ? (interaction.wakeWord.text || availability(interaction.wakeWord)) : (sensors.wakeWord && sensors.wakeWord.text || '-'));
      setText('sensorTouchAge', age(hardware.updatedAt || sensors.touch && sensors.touch.updatedAt));
      setText('hardwareCamera', formatCamera(peripherals.camera));
      setText('hardwareCameraRequested', cameraRequested(peripherals.camera, cameraSettings));
      setText('hardwareCameraActual', cameraActual(peripherals.camera, snapshot.frame));
      setText('hardwareCameraQuality', formatCameraQuality(peripherals.camera, cameraSettings));
      setText('hardwareCameraFallback', formatCameraFallback(peripherals.camera));
      setText('hardwareRgb', formatRgb(peripherals.rgb));
      updateRgbControls(peripherals.rgb);
      setText('hardwareRtc', formatRtc(peripherals.rtc));
      setText('hardwareNfc', formatProbe(peripherals.nfc));
      setText('hardwareIr', formatProbe(peripherals.ir));
      setText('hardwareProximity', formatProbe(peripherals.proximity, peripherals.proximity && peripherals.proximity.available ? num(peripherals.proximity.value, 2) + (Number.isFinite(peripherals.proximity.raw) ? ' raw ' + peripherals.proximity.raw : '') : undefined));
      setText('hardwareAmbientLight', formatProbe(peripherals.ambientLight, peripherals.ambientLight && peripherals.ambientLight.available ? num(peripherals.ambientLight.lux, 1) + ' lux' + (Number.isFinite(peripherals.ambientLight.raw) ? ' raw ' + peripherals.ambientLight.raw : '') : undefined));
      setText('hardwareMagnetometer', formatProbe(peripherals.magnetometer, peripherals.magnetometer && peripherals.magnetometer.available ? [peripherals.magnetometer.x, peripherals.magnetometer.y, peripherals.magnetometer.z].map((v) => num(v, 2)).join(', ') : undefined));
      setText('hardwareMic', formatMic(peripherals.mic));
      updateMicLevel(peripherals.mic);
      setText('hardwareSnapshotAge', age(hardware.updatedAt));
      setText('sensorFrameAge', age(snapshot.frame && snapshot.frame.timestamp || status.lastFrameAt));
      setText('sensorFaceCount', (snapshot.faces || []).length);
      setText('sensorTarget', formatCenter(snapshot.target));
      setText('sensorMode', device && device.mode || '-');

      setText('frameId', snapshot.frame && snapshot.frame.frameId || '-');
      setText('frameSize', snapshot.frame ? snapshot.frame.width + ' x ' + snapshot.frame.height : '-');
      setText('lastFrame', age(snapshot.frame && snapshot.frame.timestamp || status.lastFrameAt));
      setText('targetSummary', formatCenter(snapshot.target));
      setText('cameraPresetCurrent', cameraSettings.preset || '-');
      setText('cameraPresetRequested', cameraRequested(peripherals.camera, cameraSettings));
      setText('cameraPresetActual', cameraActual(peripherals.camera, snapshot.frame));
      setText('cameraDetectorLatency', formatLatency(status.detectorLatencyMs));
      setText('cameraDropRate', pct(dropRate));
      setText('cameraPresetFallback', formatCameraFallback(peripherals.camera));
      setText('detectorThresholdSummary', formatDetectorThresholds(status.control && status.control.detector));
      updateCameraPresetButtons(cameraSettings.preset);
      setText('tuneCommand', age(status.lastCommandAt));
      setText('tuneCenter', formatCenter(snapshot.target));
      setText('tuneExpressionEmotion', formatExpressionEmotion(status, snapshot));
      setText('tuneExpressionSmile', formatExpressionSmile(status, snapshot));
      setText('tuneExpressionEyes', formatExpressionEyes(status, snapshot));
      setText('tuneExpressionSynced', age(status.lastExpressionCommandAt));
      renderCompletionTts(snapshot.completionTts);
      setText('debugDeviceId', device && device.deviceId || '-');
      setText('debugSessionId', device && device.sessionId || '-');
      setText('debugFirmware', device && device.firmwareVersion || '-');
      setText('debugHeartbeatInterval', Number.isFinite(device && device.heartbeatIntervalMs) ? device.heartbeatIntervalMs + ' ms' : '-');
      setText('debugLastHeartbeat', age(device && device.lastHeartbeatAt));
      setText('debugOfflineDeadline', device && device.offlineDeadlineAt ? fmtTime(device.offlineDeadlineAt) : '-');
      setText('debugAudioFrames', firstDefined(device && device.audioFramesReceived, '-'));
      setText('debugLastEvent', device && device.lastEvent && device.lastEvent.kind || '-');
      setText('debugVisionFrames', firstDefined(status.framesReceived, '-'));
      setText('debugVisionDrops', firstDefined(status.framesDropped, '-'));
      setText('debugDetectorLatency', formatLatency(status.detectorLatencyMs));
      setText('debugFrameSeq', firstDefined(snapshot.frame && snapshot.frame.seq, device && device.lastSeq, '-'));
      setText('debugFrameLatency', formatLatency(status.latency && status.latency.frameAgeMs));
      setText('debugDeviceToDaemon', formatLatency(status.latency && firstDefined(status.latency.captureToDaemonMs, status.latency.deviceToDaemonMs)));
      setText('debugDetectorEndToEnd', formatLatency(status.latency && status.latency.detectorEndToEndMs));
      setText('debugCameraPreset', cameraSettings.preset || '-');
      setText('debugCameraTransport', peripherals.camera && peripherals.camera.transport || '-');
      setText('debugAdaptiveStream', formatAdaptiveStatus(status.adaptive, peripherals.camera));
      setText('debugMediaCredit', formatMediaCredit(status.mediaCredit));
      updateRawSnapshot(snapshot);

      renderControls(status.control);
      updateFrame(snapshot);
      drawOverlay(snapshot);
    }

	    function renderCompletionTts(settings) {
	      const enabled = Boolean(settings && settings.enabled);
	      const lightEnabled = Boolean(settings && settings.lightEnabled);
	      if (toggleCompletionTts) {
	        toggleCompletionTts.className = enabled ? 'active' : '';
	        toggleCompletionTts.textContent = enabled ? 'Codex 播报 On' : 'Codex 播报 Off';
	      }
	      if (toggleCompletionLight) {
	        toggleCompletionLight.className = lightEnabled ? 'active' : '';
	        toggleCompletionLight.textContent = lightEnabled ? '灯光提醒 On' : '灯光提醒 Off';
	      }
	      if (testCompletionTts) {
	        testCompletionTts.disabled = !enabled;
	      }
	      setText('ttsEnabledSummary', enabled ? 'on' : 'off', enabled ? 'ok' : 'warn');
	      setText('ttsLightSummary', lightEnabled ? 'on' : 'off', lightEnabled ? 'ok' : 'warn');

	      const volume = settings && Number.isFinite(settings.volume) ? settings.volume : null;
      if (volume === null) {
        setText('ttsVolumeValue', '-');
        setText('ttsVolumeSummary', '-');
        return;
      }
      if (ttsVolumeControl && document.activeElement !== ttsVolumeControl) {
        ttsVolumeControl.value = String(volume);
      }
      setText('ttsVolumeValue', Math.round(Number(ttsVolumeControl && ttsVolumeControl.value || volume)));
      setText('ttsVolumeSummary', Math.round(volume) + ' / 100');
    }

    function formatBox(box) {
      if (!box) return '-';
      return [box.x, box.y, box.width, box.height].map((v) => num(v, 2)).join(', ');
    }

    function formatCenter(box) {
      if (!box) return '-';
      const pose = box.pose
        ? ' / yaw ' + num(box.pose.yawDeg, 1) + ' pitch ' + num(box.pose.pitchDeg, 1) + ' roll ' + num(box.pose.rollDeg, 1)
        : '';
      return num(box.x + box.width / 2, 2) + ', ' + num(box.y + box.height / 2, 2) + pose;
    }

    function currentExpression(status, snapshot) {
      return status && status.lastExpression || snapshot && snapshot.target && snapshot.target.expression || null;
    }

    function formatExpressionEmotion(status, snapshot) {
      const expression = currentExpression(status, snapshot);
      return expression && expression.emotion ? expression.emotion : '-';
    }

    function formatExpressionSmile(status, snapshot) {
      const expression = currentExpression(status, snapshot);
      return expression && Number.isFinite(expression.smile) ? pct(expression.smile) : '-';
    }

    function formatExpressionEyes(status, snapshot) {
      const expression = currentExpression(status, snapshot);
      if (!expression) return '-';
      const left = Number.isFinite(expression.leftEyeOpen) ? pct(expression.leftEyeOpen) : '-';
      const right = Number.isFinite(expression.rightEyeOpen) ? pct(expression.rightEyeOpen) : '-';
      return 'L ' + left + ' / R ' + right;
    }

    function formatExpressionMouth(status, snapshot) {
      const expression = currentExpression(status, snapshot);
      if (!expression) return '-';
      const jaw = Number.isFinite(expression.jawOpen) ? pct(expression.jawOpen) : '-';
      const funnel = Number.isFinite(expression.mouthFunnel) ? pct(expression.mouthFunnel) : '-';
      return 'jaw ' + jaw + ' / funnel ' + funnel;
    }

    function formatExpressionBlendshapes(status, snapshot) {
      const expression = currentExpression(status, snapshot);
      const top = expression && Array.isArray(expression.topBlendshapes)
        ? expression.topBlendshapes
        : topBlendshapes(expression && expression.blendshapes);
      return top.length
        ? top.map((item) => item.name + ' ' + Math.round(item.score * 100) + '%').join(', ')
        : '-';
    }

    function topBlendshapes(blendshapes) {
      if (!blendshapes) return [];
      return Object.entries(blendshapes)
        .filter((entry) => Number.isFinite(entry[1]))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map((entry) => ({ name: entry[0], score: entry[1] }));
    }

    function formatDetectorThresholds(detector) {
      if (!detector) return '-';
      return [
        'D ' + pct(detector.minDetectionConfidence),
        'P ' + pct(detector.minPresenceConfidence),
        'T ' + pct(detector.minTrackingConfidence)
      ].join(' / ');
    }

    function formatTouchPoint(touch) {
      if (!touch) return '-';
      if (!Number.isFinite(touch.x) || !Number.isFinite(touch.y)) {
        return Number.isFinite(touch.points) ? touch.points + ' point(s)' : '-';
      }
      const points = Number.isFinite(touch.points) ? ' / ' + touch.points + ' point(s)' : '';
      return Math.round(touch.x) + ', ' + Math.round(touch.y) + points;
    }

    function renderControls(settings) {
      if (!settings) return;
      for (const input of controls) {
        const value = readPath(settings, input.dataset.path);
        if (Number.isFinite(value) && document.activeElement !== input) {
          input.value = String(value);
        }
        const output = input.parentElement.querySelector('output');
        output.textContent = formatControl(input, Number(input.value || value));
      }
      updatePidPresetButtons(settings);
      updateDetectorPresetButtons(settings);
    }

    function formatControl(input, value) {
      if (!Number.isFinite(value)) return '-';
      return Number(input.step) >= 1 ? String(Math.round(value)) : String(Math.round(value * 1000) / 1000);
    }

    function updateFrame(snapshot) {
      if (!snapshot.frame) {
        empty.style.display = 'grid';
        return;
      }
      empty.style.display = 'none';
      startFrameStream();
      const nextFrameId = String(snapshot.frame.frameId);
      frame.dataset.frameId = nextFrameId;
      lastFrameId = nextFrameId;
    }

    function drawOverlay(snapshot) {
      const width = snapshot.frame && snapshot.frame.width || frame.naturalWidth || 640;
      const height = snapshot.frame && snapshot.frame.height || frame.naturalHeight || 480;
      overlay.width = width;
      overlay.height = height;
      ctx.clearRect(0, 0, width, height);
      for (const face of snapshot.faces || []) {
        const selected = face === snapshot.target || sameBox(face, snapshot.target);
        ctx.strokeStyle = selected ? '#43d5b0' : '#6cb6ff';
        ctx.lineWidth = selected ? 4 : 2;
        ctx.strokeRect(face.x * width, face.y * height, face.width * width, face.height * height);
        if (Number.isFinite(face.confidence)) {
          ctx.fillStyle = ctx.strokeStyle;
          ctx.font = '18px system-ui';
          ctx.fillText(String(Math.round(face.confidence * 100)) + '%', face.x * width + 8, face.y * height + 24);
        }
        drawLandmarks(face, width, height, selected);
      }
      if (snapshot.target) {
        const x = (snapshot.target.x + snapshot.target.width / 2) * width;
        const y = (snapshot.target.y + snapshot.target.height / 2) * height;
        ctx.strokeStyle = '#e3b341';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - 18, y);
        ctx.lineTo(x + 18, y);
        ctx.moveTo(x, y - 18);
        ctx.lineTo(x, y + 18);
        ctx.stroke();
      }
    }

    function sameBox(a, b) {
      return a && b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
    }

    function drawLandmarks(face, width, height, selected) {
      if (!face.landmarks) return;
      ctx.fillStyle = selected ? '#f4d06f' : '#9fd4ff';
      const points = Array.isArray(face.landmarks.all) ? face.landmarks.all : Object.values(face.landmarks);
      for (const point of points) {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
        ctx.beginPath();
        ctx.arc(point.x * width, point.y * height, selected ? 2.4 : 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function collectControlPatch() {
      const patch = { control: { mode: 'pid' } };
      for (const input of controls) {
        writePath(patch, input.dataset.path, Number(input.value));
      }
      return patch;
    }

    function scheduleControlPost() {
      clearTimeout(controlTimer);
      setTuningSaveState('pending', 'warn');
      controlTimer = setTimeout(() => {
        postControlPatch({ control: collectControlPatch() });
      }, 120);
    }

    function scheduleTtsVolumePost() {
      clearTimeout(ttsVolumeTimer);
      ttsVolumeTimer = setTimeout(() => {
        const volume = Number(ttsVolumeControl.value);
        fetch('/api/completion-tts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ volume })
        })
          .then((response) => response.json())
          .then((settings) => renderCompletionTts(settings))
          .catch(console.error);
      }, 120);
    }

	    function toggleCompletionTtsEnabled() {
	      const enabled = !(latest && latest.completionTts && latest.completionTts.enabled);
	      fetch('/api/completion-tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled })
      })
        .then((response) => response.json())
        .then((settings) => {
          if (latest) latest.completionTts = settings;
          renderCompletionTts(settings);
	        })
	        .catch(console.error);
	    }

	    function toggleCompletionLightEnabled() {
	      const lightEnabled = !(latest && latest.completionTts && latest.completionTts.lightEnabled);
	      fetch('/api/completion-tts', {
	        method: 'POST',
	        headers: { 'content-type': 'application/json' },
	        body: JSON.stringify({ lightEnabled })
	      })
	        .then((response) => response.json())
	        .then((settings) => {
	          if (latest) latest.completionTts = settings;
	          renderCompletionTts(settings);
	        })
	        .catch(console.error);
	    }

    async function postTracking(payload) {
      const response = await fetch('/api/tracking', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      render(await response.json());
    }

    function setButtonBusy(id, busy) {
      if (!id) return;
      const button = $(id);
      if (!button) return;
      button.classList.toggle('pending', busy);
      button.disabled = busy;
    }

    function setTuningSaveState(text, className) {
      clearTimeout(controlSavedTimer);
      setText('tuningSaveState', text, className);
      if (text === 'saved') {
        controlSavedTimer = setTimeout(() => setText('tuningSaveState', 'ready'), 1600);
      }
    }

    async function postControlPatch(payload, buttonId) {
      setButtonBusy(buttonId, true);
      setTuningSaveState('saving', 'warn');
      try {
        await postTracking(payload);
        setTuningSaveState('saved', 'ok');
      } catch (error) {
        setTuningSaveState('failed', 'bad');
        console.error(error);
      } finally {
        setButtonBusy(buttonId, false);
      }
    }

    function postPreset(preset, buttonId) {
      postControlPatch({ control: preset }, buttonId);
    }

    function postCameraPreset(cameraPreset, buttonId) {
      postControlPatch({ control: { cameraPreset } }, buttonId);
    }

    async function postRgb(enabled, color, buttonId) {
      setButtonBusy(buttonId, true);
      try {
        const response = await fetch('/api/rgb', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabled, color })
        });
        const result = await response.json();
        if (!result.ok) {
          console.warn('RGB command failed', result);
        }
        if (latest) {
          const device = (latest.devices || []).find((item) => item.status === 'online') || (latest.devices || [])[0];
          const peripherals = device && device.sensors && device.sensors.sensorSnapshot && device.sensors.sensorSnapshot.peripherals;
          if (peripherals && peripherals.rgb) {
            peripherals.rgb.enabled = result.enabled;
            peripherals.rgb.color = result.color;
          }
        }
        updateRgbControls({ available: true, enabled: result.enabled, color: result.color });
      } catch (error) {
        console.error(error);
      } finally {
        setButtonBusy(buttonId, false);
      }
    }

    function startFrameStream() {
      if (frameStreamActive || document.hidden) {
        return;
      }
      frameStreamActive = true;
      frame.src = '/stream.mjpg?stream=' + Date.now();
    }

    function selectedPanelId() {
      const panel = document.querySelector('.panel.selected');
      return panel ? panel.id : '';
    }

    function updateRawSnapshot(snapshot) {
      if (selectedPanelId() !== 'debug') return;
      const now = Date.now();
      if (now - lastRawSnapshotAt < 500) return;
      lastRawSnapshotAt = now;
      $('rawSnapshot').textContent = JSON.stringify(snapshot, null, 2);
    }

    function scheduleLogRender() {
      if (logsPaused || selectedPanelId() !== 'logs' || logRenderTimer) return;
      logRenderTimer = setTimeout(() => {
        logRenderTimer = null;
        renderLogs();
      }, 350);
    }

    function renderLogs() {
      const type = $('logType').value;
      const level = $('logLevel').value;
      const search = $('logSearch').value.trim().toLowerCase();
      const items = logEntries.filter((entry) => {
        if (type && entry.type !== type) return false;
        if (level && levelOrder(entry.level) < levelOrder(level)) return false;
        if (search) {
          const text = (entry.message + ' ' + JSON.stringify(entry.context || {})).toLowerCase();
          if (!text.includes(search)) return false;
        }
        return true;
      }).slice(-200);
      $('logList').innerHTML = items.map((entry) => {
        const context = entry.context ? JSON.stringify(entry.context, null, 2) : '';
        return '<div class="log"><div class="log-head"><span>' + escapeHtml(fmtTime(entry.time)) + ' ' + escapeHtml(entry.level) + ' / ' + escapeHtml(entry.type) + '</span><span>#' + entry.id + '</span></div><div class="log-msg">' + escapeHtml(entry.message) + '</div><div class="log-context">' + escapeHtml(context) + '</div></div>';
      }).join('');
      const list = $('logList');
      list.scrollTop = list.scrollHeight;
    }

    function levelOrder(level) {
      return { debug: 10, info: 20, warn: 30, error: 40 }[level] || 0;
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[ch]));
    }

    for (const tab of document.querySelectorAll('.tab')) {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((node) => node.classList.toggle('selected', node === tab));
        document.querySelectorAll('.panel').forEach((node) => node.classList.toggle('selected', node.id === tab.dataset.tab));
        if (tab.dataset.tab === 'logs') renderLogs();
        if (tab.dataset.tab === 'debug' && latest) updateRawSnapshot(latest);
      });
    }
    for (const input of controls) {
      input.addEventListener('input', () => {
        input.parentElement.querySelector('output').textContent = formatControl(input, Number(input.value));
        scheduleControlPost();
      });
    }
    if (ttsVolumeControl) {
      ttsVolumeControl.addEventListener('input', () => {
        setText('ttsVolumeValue', Math.round(Number(ttsVolumeControl.value)));
        setText('ttsVolumeSummary', Math.round(Number(ttsVolumeControl.value)) + ' / 100');
        scheduleTtsVolumePost();
      });
    }
    $('toggleTracking').addEventListener('click', () => {
      postTracking({ enabled: !(latest && latest.status && latest.status.enabled) }).catch(console.error);
    });
	    if (toggleCompletionTts) {
	      toggleCompletionTts.addEventListener('click', toggleCompletionTtsEnabled);
	    }
	    if (toggleCompletionLight) {
	      toggleCompletionLight.addEventListener('click', toggleCompletionLightEnabled);
	    }
	    if (testCompletionTts) {
	      testCompletionTts.addEventListener('click', () => {
        fetch('/api/completion-tts-test', { method: 'POST' }).catch(console.error);
      });
	    }
    if (rgbToggle) {
      rgbToggle.addEventListener('click', () => {
        const device = latest && ((latest.devices || []).find((item) => item.status === 'online') || (latest.devices || [])[0]);
        const rgb = device && device.sensors && device.sensors.sensorSnapshot && device.sensors.sensorSnapshot.peripherals && device.sensors.sensorSnapshot.peripherals.rgb;
        const enabled = !(rgb && rgb.enabled);
        postRgb(enabled, rgbColorInput ? rgbColorInput.value : '#43D5B0', 'rgbToggle');
      });
    }
    if (rgbColorInput) {
      rgbColorInput.addEventListener('input', () => {
        const device = latest && ((latest.devices || []).find((item) => item.status === 'online') || (latest.devices || [])[0]);
        const rgb = device && device.sensors && device.sensors.sensorSnapshot && device.sensors.sensorSnapshot.peripherals && device.sensors.sensorSnapshot.peripherals.rgb;
        if (!rgb || rgb.enabled !== false) {
          postRgb(true, rgbColorInput.value);
        }
      });
    }
    for (const swatch of Array.from(document.querySelectorAll('[data-rgb]'))) {
      swatch.addEventListener('click', () => {
        const color = swatch.getAttribute('data-rgb') || '#43D5B0';
        if (rgbColorInput) rgbColorInput.value = color;
        postRgb(true, color);
      });
    }
    $('presetOfficial').addEventListener('click', () => postPreset(presets.official, 'presetOfficial'));
    $('presetFast').addEventListener('click', () => postPreset(presets.fast, 'presetFast'));
    $('presetStable').addEventListener('click', () => postPreset(presets.stable, 'presetStable'));
    $('presetDefaults').addEventListener('click', () => postPreset(presets.defaults, 'presetDefaults'));
    $('detectorPresetLoose').addEventListener('click', () => postPreset(detectorPresets.loose, 'detectorPresetLoose'));
    $('detectorPresetBalanced').addEventListener('click', () => postPreset(detectorPresets.balanced, 'detectorPresetBalanced'));
    $('detectorPresetStrict').addEventListener('click', () => postPreset(detectorPresets.strict, 'detectorPresetStrict'));
    $('cameraPresetFast').addEventListener('click', () => postCameraPreset('fast', 'cameraPresetFast'));
    $('cameraPresetAccurate').addEventListener('click', () => postCameraPreset('accurate', 'cameraPresetAccurate'));
    $('cameraPresetDebug').addEventListener('click', () => postCameraPreset('debug', 'cameraPresetDebug'));
    $('pauseLogs').addEventListener('click', () => {
      logsPaused = !logsPaused;
      $('pauseLogs').classList.toggle('active', logsPaused);
      $('pauseLogs').textContent = logsPaused ? 'Resume' : 'Pause';
    });
    $('clearLogs').addEventListener('click', () => {
      logEntries = [];
      renderLogs();
    });
    $('logSearch').addEventListener('input', renderLogs);
    $('logType').addEventListener('change', renderLogs);
    $('logLevel').addEventListener('change', renderLogs);

    fetch('/debug/logs?limit=200')
      .then((response) => response.json())
      .then((data) => { logEntries = data.logs || []; renderLogs(); })
      .catch(console.error);
    fetch('/debug/snapshot')
      .then((response) => response.json())
      .then((data) => render(data.vision || data))
      .catch(console.error);
    fetch('/api/completion-tts')
      .then((response) => response.json())
      .then((settings) => renderCompletionTts(settings))
      .catch(console.error);

    const snapshots = new EventSource('/events');
    snapshots.onmessage = (event) => render(JSON.parse(event.data));
    snapshots.onerror = () => setText('statDevice', 'SSE lost', 'bad');

    const logEvents = new EventSource('/debug/log-events');
    logEvents.onmessage = (event) => {
      logEntries.push(JSON.parse(event.data));
      if (logEntries.length > 500) logEntries = logEntries.slice(-500);
      scheduleLogRender();
    };
    frame.addEventListener('error', () => {
      frameStreamActive = false;
      clearTimeout(frameStreamRestartTimer);
      frameStreamRestartTimer = setTimeout(startFrameStream, 1000);
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        frameStreamActive = false;
        startFrameStream();
      }
    });
    startFrameStream();
  </script>
</body>
</html>`;
}

function buildInitialView(snapshot: PreviewInitialSnapshot) {
  const status = snapshot.status ?? {};
  const devices = snapshot.devices ?? [];
  const device = devices.find((item) => item.status === "online") ?? devices[0];
  const sensors = device?.sensors ?? {};
  const hardware = sensors.sensorSnapshot ?? {};
  const power = hardware.power ?? {};
  const network = hardware.network ?? {};
  const motion = hardware.motion ?? {};
  const interaction = hardware.interaction ?? {};
  const peripherals = hardware.peripherals ?? {};
  const wifi = network.wifi ?? sensors.wifi;
  const imu = sensors.imu ?? (motion.imu?.available ? motion.imu : undefined);
  const frame = snapshot.frame;
  const faces = snapshot.faces ?? [];
  const target = snapshot.target;
  const dropRate = Number.isFinite(status.framesReceived) && status.framesReceived > 0
    ? status.framesDropped / status.framesReceived
    : 0;
  const cameraSettings = status.control?.camera ?? {};

  return {
    subtitle: device ? String(device.deviceId ?? "StackChan device") : "No StackChan device connected",
    statDevice: device ? String(device.status ?? "offline") : "offline",
    statDeviceClass: device?.status === "online" ? "ok" : "bad",
    statFace: status.enabled ? "on" : "off",
    statFaceClass: status.enabled ? "ok" : "warn",
    statFaces: String(faces.length),
    statFps: valueOrDash(status.fps),
    statBattery: Number.isFinite(power.batteryLevel)
      ? `${Math.round(power.batteryLevel)}%${power.charging ? " charging" : ""}`
      : formatInitialBattery(sensors.battery),
    statBatteryClass: power.charging || sensors.battery?.charging ? "ok" : "",
    statWifi: formatInitialWifi(wifi),
    statWifiClass: wifi?.status === "connected" ? "ok" : "warn",
    statImu: formatInitialImu(imu),
    statDropped: `${valueOrDash(status.framesDropped)} / ${percent(dropRate)}`,
    statDroppedClass: dropRate > 0.08 ? "warn" : "",
    statDetector: status.detectorAvailable ? "ready" : "down",
    statDetectorClass: status.detectorAvailable ? "ok" : "bad",
    statError: valueOrDash(status.lastError),
    toggleTrackingText: status.enabled ? "Face on" : "Face off",
    toggleTrackingClass: status.enabled ? "active" : "",
    emptyStyle: frame ? "display:none" : "",
    frameSrc: `/stream.mjpg?stream=${Date.now()}`,
    frameId: valueOrDash(frame?.frameId),
    frameSize: frame ? `${frame.width} x ${frame.height}` : "-",
    frameAge: age(frame?.timestamp ?? status.lastFrameAt),
    targetSummary: formatCenter(target),
    faceEnabled: status.enabled ? "yes" : "no",
    faceEnabledClass: status.enabled ? "ok" : "warn",
    lastFace: age(status.lastFaceAt),
    lastCommand: age(status.lastCommandAt),
    targetBox: formatBox(target),
    expressionEmotion: formatInitialExpressionEmotion(status, target),
    expressionSmile: formatInitialExpressionSmile(status, target),
    expressionEyes: formatInitialExpressionEyes(status, target),
    expressionMouth: formatInitialExpressionMouth(status, target),
    expressionBlendshapes: formatInitialExpressionBlendshapes(status, target),
    expressionSynced: age(status.lastExpressionCommandAt),
    deviceStatus: valueOrDash(device?.status),
    deviceMode: valueOrDash(device?.mode),
    deviceSeen: age(device?.lastSeenAt),
    deviceCaps: (device?.capabilities ?? []).join(", "),
    batteryLevel: Number.isFinite(power.batteryLevel)
      ? `${Math.round(power.batteryLevel)}%`
      : sensors.battery ? `${Math.round(sensors.battery.level)}%` : "-",
    batteryCharging: typeof power.charging === "boolean"
      ? (power.charging ? "yes" : "no")
      : sensors.battery ? (sensors.battery.charging ? "yes" : "no") : "-",
    batteryAge: age(hardware.updatedAt ?? sensors.battery?.updatedAt),
    hardwarePowerMonitor: formatInitialPowerMonitor(peripherals.powerMonitor),
    hardwareBacklight: formatInitialPercent(power.backlight),
    hardwareSpeaker: formatInitialPercent(power.speakerVolume),
    hardwareServoPower: boolInitial(power.servoPower),
    hardwareIoExpander: formatInitialAvailability(peripherals.ioExpander),
    hardwareI2cScan: formatInitialI2cScan(peripherals.i2cScan),
    wifiStatus: valueOrDash(wifi?.status),
    wifiSsid: valueOrDash(wifi?.ssid),
    wifiRssi: Number.isFinite(wifi?.rssi) ? `${wifi.rssi} dBm` : "-",
    wifiAge: age(hardware.updatedAt ?? sensors.wifi?.updatedAt),
    hardwareBle: formatInitialBle(network.ble),
    imuMotion: valueOrDash(imu?.motion),
    imuX: numberText(imu?.x, 3),
    imuY: numberText(imu?.y, 3),
    imuZ: numberText(imu?.z, 3),
    imuGyroX: Number.isFinite(imu?.gyroX) ? `${numberText(imu.gyroX, 2)} dps` : "-",
    imuGyroY: Number.isFinite(imu?.gyroY) ? `${numberText(imu.gyroY, 2)} dps` : "-",
    imuGyroZ: Number.isFinite(imu?.gyroZ) ? `${numberText(imu.gyroZ, 2)} dps` : "-",
    imuMagnitude: numberText(accelMagnitude(imu), 3),
    imuGyroMagnitude: Number.isFinite(gyroMagnitude(imu)) ? `${numberText(gyroMagnitude(imu), 2)} dps` : "-",
    hardwareYawServo: formatInitialServo(motion.servos?.yaw),
    hardwarePitchServo: formatInitialServo(motion.servos?.pitch),
    imuAge: age(imu?.updatedAt ?? hardware.updatedAt),
    touchSurface: valueOrDash(sensors.touch?.surface),
    touchGesture: valueOrDash(sensors.touch?.gesture),
    touchPressed: typeof sensors.touch?.pressed === "boolean" ? (sensors.touch.pressed ? "yes" : "no") : "-",
    touchPoint: formatTouchPoint(sensors.touch) !== "-" ? formatTouchPoint(sensors.touch) : formatInitialScreenTouch(interaction.screenTouch),
    hardwareHeadTouch: formatInitialHeadTouch(interaction.headTouch),
    hardwareWakeWord: interaction.wakeWord
      ? (interaction.wakeWord.text ?? formatInitialAvailability(interaction.wakeWord))
      : valueOrDash(sensors.wakeWord?.text),
    touchAge: age(hardware.updatedAt ?? sensors.touch?.updatedAt),
    hardwareCamera: formatInitialCamera(peripherals.camera),
    hardwareCameraRequested: formatInitialCameraRequested(peripherals.camera, cameraSettings),
    hardwareCameraActual: formatInitialCameraActual(peripherals.camera, frame),
    hardwareCameraQuality: formatInitialCameraQuality(peripherals.camera, cameraSettings),
    hardwareCameraFallback: formatInitialCameraFallback(peripherals.camera),
    hardwareRgb: formatInitialRgb(peripherals.rgb),
    rgbColor: initialRgbColor(peripherals.rgb),
    rgbToggleClass: peripherals.rgb?.enabled ? "active" : "",
    rgbToggleText: peripherals.rgb?.enabled ? "RGB On" : "RGB Off",
    hardwareRtc: formatInitialRtc(peripherals.rtc),
    hardwareNfc: formatInitialProbe(peripherals.nfc),
    hardwareIr: formatInitialProbe(peripherals.ir),
    hardwareProximity: formatInitialProbe(
      peripherals.proximity,
      peripherals.proximity?.available ? `${numberText(peripherals.proximity.value, 2)}${Number.isFinite(peripherals.proximity.raw) ? ` raw ${peripherals.proximity.raw}` : ""}` : undefined
    ),
    hardwareAmbientLight: formatInitialProbe(
      peripherals.ambientLight,
      peripherals.ambientLight?.available ? `${numberText(peripherals.ambientLight.lux, 1)} lux${Number.isFinite(peripherals.ambientLight.raw) ? ` raw ${peripherals.ambientLight.raw}` : ""}` : undefined
    ),
    hardwareMagnetometer: formatInitialProbe(
      peripherals.magnetometer,
      peripherals.magnetometer?.available
        ? [peripherals.magnetometer.x, peripherals.magnetometer.y, peripherals.magnetometer.z].map((value: unknown) => numberText(value, 2)).join(", ")
        : undefined
    ),
    hardwareMic: formatInitialMic(peripherals.mic),
    hardwareMicLevelWidth: `${initialMicLevelPercent(peripherals.mic)}%`,
    hardwareMicLevelText: peripherals.mic?.available
      ? `${initialMicLevelPercent(peripherals.mic)}% calibrated${Number.isFinite(peripherals.mic.dbfs) ? ` / raw ${numberText(peripherals.mic.dbfs, 1)} dBFS` : ""}`
      : "-",
    hardwareSnapshotAge: age(hardware.updatedAt),
    debugDeviceId: valueOrDash(device?.deviceId),
    debugSessionId: valueOrDash(device?.sessionId),
    debugFirmware: valueOrDash(device?.firmwareVersion),
    debugHeartbeatInterval: Number.isFinite(device?.heartbeatIntervalMs) ? `${device.heartbeatIntervalMs} ms` : "-",
    debugLastHeartbeat: age(device?.lastHeartbeatAt),
    debugOfflineDeadline: timeText(device?.offlineDeadlineAt),
    debugAudioFrames: valueOrDash(device?.audioFramesReceived),
    debugLastEvent: valueOrDash(device?.lastEvent?.kind),
    debugVisionFrames: valueOrDash(status.framesReceived),
    debugVisionDrops: valueOrDash(status.framesDropped),
    debugFrameSeq: valueOrDash(frame?.seq ?? device?.lastSeq),
    debugFrameLatency: formatInitialLatency(status.latency?.frameAgeMs),
    debugDeviceToDaemon: formatInitialLatency(status.latency?.captureToDaemonMs ?? status.latency?.deviceToDaemonMs),
    debugDetectorEndToEnd: formatInitialLatency(status.latency?.detectorEndToEndMs),
    debugCameraTransport: valueOrDash(peripherals.camera?.transport),
    debugAdaptiveStream: formatInitialAdaptiveStatus(status.adaptive, peripherals.camera),
    debugMediaCredit: formatInitialMediaCredit(status.mediaCredit),
    cameraPresetCurrent: valueOrDash(cameraSettings.preset),
    cameraPresetRequested: formatInitialCameraRequested(peripherals.camera, cameraSettings),
    cameraPresetActual: formatInitialCameraActual(peripherals.camera, frame),
    cameraDetectorLatency: formatInitialLatency(status.detectorLatencyMs),
    cameraDropRate: percent(dropRate),
    cameraPresetFallback: formatInitialCameraFallback(peripherals.camera),
    detectorThresholdSummary: formatInitialDetectorThresholds(status.control?.detector),
    rawSnapshot: JSON.stringify(snapshot, null, 2),
	    ttsEnabledClass: snapshot.completionTts?.enabled ? "ok" : "warn",
	    ttsEnabledSummary: snapshot.completionTts?.enabled ? "on" : "off",
	    ttsToggleClass: snapshot.completionTts?.enabled ? "active" : "",
	    ttsToggleText: snapshot.completionTts?.enabled ? "Codex 播报 On" : "Codex 播报 Off",
	    ttsLightEnabledClass: snapshot.completionTts?.lightEnabled ? "ok" : "warn",
	    ttsLightSummary: snapshot.completionTts?.lightEnabled ? "on" : "off",
	    ttsLightToggleClass: snapshot.completionTts?.lightEnabled ? "active" : "",
	    ttsLightToggleText: snapshot.completionTts?.lightEnabled ? "灯光提醒 On" : "灯光提醒 Off",
	    ttsVolume: numberText(snapshot.completionTts?.volume ?? 0, 0),
    ttsVolumeSummary: `${numberText(snapshot.completionTts?.volume ?? 0, 0)} / 100`
  };
}

function html(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[ch] ?? ch));
}

function attr(value: unknown): string {
  return html(value).replace(/`/g, "&#096;");
}

function valueOrDash(value: unknown): string {
  return value === undefined || value === null || value === "" ? "-" : String(value);
}

function numberText(value: unknown, digits: number): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "-";
}

function percent(value: number): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "-";
}

function age(value: unknown): string {
  if (!value) return "-";
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return "-";
  const ms = Date.now() - date.getTime();
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function timeText(value: unknown): string {
  if (!value) return "-";
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString() : "-";
}

function accelMagnitude(sensor: Record<string, any> | undefined): number {
  if (!sensor || !Number.isFinite(sensor.x) || !Number.isFinite(sensor.y) || !Number.isFinite(sensor.z)) return Number.NaN;
  return Math.sqrt(sensor.x * sensor.x + sensor.y * sensor.y + sensor.z * sensor.z);
}

function gyroMagnitude(sensor: Record<string, any> | undefined): number {
  if (!sensor || !Number.isFinite(sensor.gyroX) || !Number.isFinite(sensor.gyroY) || !Number.isFinite(sensor.gyroZ)) return Number.NaN;
  return Math.sqrt(sensor.gyroX * sensor.gyroX + sensor.gyroY * sensor.gyroY + sensor.gyroZ * sensor.gyroZ);
}

function boolInitial(value: unknown): string {
  return typeof value === "boolean" ? (value ? "yes" : "no") : "-";
}

function formatInitialPercent(value: unknown): string {
  return Number.isFinite(value) ? `${Math.round(Number(value))}%` : "-";
}

function formatInitialPowerMonitor(sensor: Record<string, any> | undefined): string {
  if (!sensor) return "-";
  if (sensor.available === false) return formatInitialProbe(sensor);
  const parts: string[] = [];
  if (Number.isFinite(sensor.busVoltage)) parts.push(`${numberText(sensor.busVoltage, 3)} V`);
  if (Number.isFinite(sensor.current)) parts.push(`${numberText(sensor.current * 1000, 1)} mA`);
  if (Number.isFinite(sensor.power)) parts.push(`${numberText(sensor.power * 1000, 1)} mW`);
  if (Number.isFinite(sensor.shuntVoltage)) parts.push(`shunt ${numberText(sensor.shuntVoltage * 1000, 3)} mV`);
  return formatInitialProbe(sensor, parts.length ? parts.join(" / ") : "available");
}

function formatInitialI2cAddressList(addresses: unknown): string {
  if (!Array.isArray(addresses) || addresses.length === 0) return "none";
  return addresses
    .filter((address) => Number.isFinite(address))
    .map((address) => `0x${Number(address).toString(16).padStart(2, "0")}`)
    .join(" ");
}

function initialTargetMark(value: unknown): string {
  return value ? "yes" : "no";
}

function formatInitialI2cScan(scans: unknown): string {
  if (!Array.isArray(scans) || scans.length === 0) return "-";
  const latest = scans[scans.length - 1] as Record<string, any>;
  const targets = latest?.targets ?? {};
  const targetText = `targets LTR ${initialTargetMark(targets.ltr553)} / INA ${initialTargetMark(targets.ina226)} / NFC ${initialTargetMark(targets.nfc)}`;
  const stageText = scans.map((scan) => {
    const item = scan as Record<string, any>;
    const reason = item.reason ? ` / ${item.reason}` : "";
    return `${String(item.stage ?? "scan")}: ${formatInitialI2cAddressList(item.addresses)}${reason}`;
  }).join(" | ");
  return `${targetText} / ${stageText}`;
}

function formatInitialAvailability(sensor: Record<string, any> | undefined, availableText = "available"): string {
  if (!sensor) return "-";
  if (sensor.available === false) {
    return `${initialUnavailableLabel(sensor)}${sensor.reason ? `: ${sensor.reason}` : ""}`;
  }
  if (sensor.available === true) {
    return availableText;
  }
  return "-";
}

function initialUnavailableLabel(sensor: Record<string, any>): string {
  const reason = typeof sensor.reason === "string" ? sensor.reason : "";
  if (reason.startsWith("not_detected_i2c")) return "Not detected";
  if (reason === "driver_not_wired") return "Driver not wired";
  if (reason === "driver_unavailable") return "Driver unavailable";
  if (reason === "io_expander_unavailable") return "IO expander unavailable";
  return "Unavailable";
}

function formatInitialBle(sensor: Record<string, any> | undefined): string {
  if (!sensor) return "-";
  if (sensor.available === false) return formatInitialAvailability(sensor);
  return `available / ${sensor.connected ? "connected" : "not connected"}${sensor.provisioning ? " / provisioning" : ""}`;
}

function formatInitialServo(axis: Record<string, any> | undefined): string {
  if (!axis) return "-";
  const parts = [];
  if (Number.isFinite(axis.angle)) parts.push(`${numberText(axis.angle, 1)} deg`);
  if (typeof axis.moving === "boolean") parts.push(axis.moving ? "moving" : "still");
  if (typeof axis.torque === "boolean") parts.push(axis.torque ? "torque on" : "torque off");
  return parts.length ? parts.join(" / ") : "-";
}

function formatInitialScreenTouch(sensor: Record<string, any> | undefined): string {
  if (!sensor) return "-";
  if (sensor.available === false) return formatInitialAvailability(sensor);
  const point = Number.isFinite(sensor.x) && Number.isFinite(sensor.y) ? `${Math.round(sensor.x)}, ${Math.round(sensor.y)}` : "-";
  const points = Number.isFinite(sensor.points) ? ` / ${sensor.points} point(s)` : "";
  return `${sensor.pressed ? "pressed" : "released"} ${point}${points}`;
}

function formatInitialHeadTouch(sensor: Record<string, any> | undefined): string {
  if (!sensor) return "-";
  if (sensor.available === false) return formatInitialAvailability(sensor);
  const zones = Array.isArray(sensor.zones) && sensor.zones.length ? ` zones ${sensor.zones.join(",")}` : "";
  return `${sensor.pressed ? "pressed" : "released"}${sensor.gesture ? ` / ${sensor.gesture}` : ""}${zones}`;
}

function formatInitialCamera(sensor: Record<string, any> | undefined): string {
  if (!sensor) return "-";
  if (sensor.available === false) return formatInitialAvailability(sensor);
  const width = firstInitialDefined(sensor.actualWidth, sensor.width);
  const height = firstInitialDefined(sensor.actualHeight, sensor.height);
  const size = Number.isFinite(width) && Number.isFinite(height) ? `${width} x ${height}` : "-";
  const fps = Number.isFinite(sensor.fps) ? ` / ${numberText(sensor.fps, 1)} fps` : "";
  const quality = Number.isFinite(sensor.quality) ? ` / q${sensor.quality}` : "";
  const transport = sensor.transport ? ` / ${sensor.transport}` : "";
  return `${sensor.streaming ? "streaming" : "ready"} ${size}${fps}${quality}${transport}`;
}

function formatInitialCameraRequested(
  sensor: Record<string, any> | undefined,
  settings: Record<string, any> | undefined
): string {
  const width = firstInitialDefined(sensor?.requestedWidth, settings?.width);
  const height = firstInitialDefined(sensor?.requestedHeight, settings?.height);
  const fps = firstInitialDefined(sensor?.fps, settings?.fps);
  const quality = firstInitialDefined(sensor?.quality, settings?.quality);
  const size = Number.isFinite(width) && Number.isFinite(height) ? `${width} x ${height}` : "-";
  const fpsText = Number.isFinite(fps) ? ` / ${numberText(fps, 1)} fps` : "";
  const qualityText = Number.isFinite(quality) ? ` / q${quality}` : "";
  return `${size}${fpsText}${qualityText}`;
}

function formatInitialCameraActual(
  sensor: Record<string, any> | undefined,
  frame: Record<string, any> | undefined
): string {
  const width = firstInitialDefined(sensor?.actualWidth, sensor?.width, frame?.width);
  const height = firstInitialDefined(sensor?.actualHeight, sensor?.height, frame?.height);
  return Number.isFinite(width) && Number.isFinite(height) ? `${width} x ${height}` : "-";
}

function formatInitialCameraQuality(
  sensor: Record<string, any> | undefined,
  settings: Record<string, any> | undefined
): string {
  const quality = firstInitialDefined(sensor?.quality, settings?.quality);
  return Number.isFinite(quality) ? String(quality) : "-";
}

function formatInitialCameraFallback(sensor: Record<string, any> | undefined): string {
  return sensor?.fallbackReason ? String(sensor.fallbackReason) : "-";
}

function formatInitialAdaptiveStatus(
  adaptive: Record<string, any> | undefined,
  camera: Record<string, any> | undefined
): string {
  const level = firstInitialDefined(camera?.adaptiveLevel, adaptive?.level);
  if (!Number.isFinite(level)) return "-";
  const parts = [`level ${level}`];
  if (adaptive?.active) parts.push("active");
  const fps = adaptive?.fps;
  const quality = adaptive?.quality;
  const dropRate = adaptive?.dropRate;
  if (Number.isFinite(fps)) parts.push(`${numberText(fps, 1)} fps`);
  if (Number.isFinite(quality)) parts.push(`q${quality}`);
  if (Number.isFinite(dropRate)) parts.push(`drops ${percent(dropRate)}`);
  if (adaptive?.reason) parts.push(String(adaptive.reason));
  return parts.join(" / ");
}

function formatInitialLatency(value: unknown): string {
  return Number.isFinite(value) ? `${Math.round(Number(value))} ms` : "-";
}

function formatInitialMediaCredit(mediaCredit: Record<string, any> | undefined): string {
  if (!mediaCredit) return "-";
  const parts = [mediaCredit.enabled ? "enabled" : "fallback"];
  if (Number.isFinite(mediaCredit.grantedFrames)) parts.push(`${mediaCredit.grantedFrames} granted`);
  if (mediaCredit.reason) parts.push(String(mediaCredit.reason));
  if (mediaCredit.lastGrantedAt) parts.push(`last ${age(mediaCredit.lastGrantedAt)}`);
  return parts.join(" / ");
}

function firstInitialDefined(...values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

function formatInitialRtc(sensor: Record<string, any> | undefined): string {
  if (!sensor) return "-";
  if (sensor.available === false) return formatInitialAvailability(sensor);
  const timestamp = sensor.timestamp ? new Date(String(sensor.timestamp)) : null;
  const time = timestamp && Number.isFinite(timestamp.getTime()) ? timestamp.toLocaleTimeString() : "available";
  return `${time}${sensor.timezone ? ` / ${sensor.timezone}` : ""}`;
}

function formatInitialMic(sensor: Record<string, any> | undefined): string {
  if (!sensor) return "-";
  if (sensor.available === false) return formatInitialAvailability(sensor);
  const channels = Number.isFinite(sensor.channels) ? `${sensor.channels} ch` : "available";
  const level = Number.isFinite(sensor.level) ? ` / calibrated ${Math.round(sensor.level * 100)}%` : "";
  const dbfs = Number.isFinite(sensor.dbfs) ? ` / raw ${numberText(sensor.dbfs, 1)} dBFS` : "";
  return `${channels}${sensor.mode ? ` / ${sensor.mode}` : ""}${level}${dbfs}${sensor.localization ? ` / localization ${sensor.localization}` : ""}`;
}

function formatInitialRgb(sensor: Record<string, any> | undefined): string {
  if (!sensor) return "-";
  if (sensor.available === false) return formatInitialAvailability(sensor);
  const parts = ["available"];
  if (Number.isFinite(sensor.count)) parts.push(`${sensor.count} LEDs`);
  if (typeof sensor.enabled === "boolean") parts.push(sensor.enabled ? "on" : "off");
  if (sensor.color) parts.push(String(sensor.color));
  if (Number.isFinite(sensor.brightness)) parts.push(`${Math.round(sensor.brightness * 100)}%`);
  if (sensor.driver) parts.push(String(sensor.driver));
  return parts.join(" / ");
}

function formatInitialProbe(sensor: Record<string, any> | undefined, valueText?: string): string {
  if (!sensor) return "-";
  const parts: string[] = [];
  if (sensor.available === true) {
    parts.push(valueText ?? "available");
  } else if (sensor.available === false) {
    parts.push(initialUnavailableLabel(sensor));
  }
  if (sensor.driver) parts.push(String(sensor.driver));
  if (Number.isFinite(sensor.address)) parts.push(`0x${Number(sensor.address).toString(16).padStart(2, "0")}`);
  if (sensor.status) parts.push(String(sensor.status));
  if (Number.isFinite(sensor.txPin)) parts.push(`TX GPIO${sensor.txPin}`);
  if (Number.isFinite(sensor.rxPin)) parts.push(`RX GPIO${sensor.rxPin}`);
  if (sensor.reason) parts.push(String(sensor.reason));
  return parts.length ? parts.join(" / ") : formatInitialAvailability(sensor);
}

function initialMicLevelPercent(sensor: Record<string, any> | undefined): number {
  return sensor && Number.isFinite(sensor.level) ? Math.max(0, Math.min(100, Math.round(sensor.level * 100))) : 0;
}

function initialRgbColor(sensor: Record<string, any> | undefined): string {
  const color = String(sensor?.color ?? "");
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toUpperCase() : "#43D5B0";
}

function formatInitialBattery(sensor: Record<string, any> | undefined): string {
  if (!sensor) return "-";
  return `${Math.round(sensor.level)}%${sensor.charging ? " charging" : ""}`;
}

function formatInitialWifi(sensor: Record<string, any> | undefined): string {
  if (!sensor) return "-";
  const rssi = Number.isFinite(sensor.rssi) ? ` ${sensor.rssi} dBm` : "";
  return `${sensor.status}${rssi}`;
}

function formatInitialImu(sensor: Record<string, any> | undefined): string {
  if (!sensor) return "-";
  const gyro = gyroMagnitude(sensor);
  return `${sensor.motion ?? "none"} ${numberText(accelMagnitude(sensor), 2)}${Number.isFinite(gyro) ? ` / ${numberText(gyro, 1)} dps` : ""}`;
}

function formatBox(box: Record<string, any> | undefined): string {
  if (!box) return "-";
  return [box.x, box.y, box.width, box.height].map((value) => numberText(value, 2)).join(", ");
}

function formatCenter(box: Record<string, any> | undefined): string {
  if (!box) return "-";
  return `${numberText(box.x + box.width / 2, 2)}, ${numberText(box.y + box.height / 2, 2)}`;
}

function initialExpression(status: Record<string, any>, target: Record<string, any> | undefined): Record<string, any> | undefined {
  return status.lastExpression ?? target?.expression;
}

function formatInitialExpressionEmotion(status: Record<string, any>, target: Record<string, any> | undefined): string {
  const expression = initialExpression(status, target);
  return valueOrDash(expression?.emotion);
}

function formatInitialExpressionSmile(status: Record<string, any>, target: Record<string, any> | undefined): string {
  const expression = initialExpression(status, target);
  return typeof expression?.smile === "number" ? percent(expression.smile) : "-";
}

function formatInitialExpressionEyes(status: Record<string, any>, target: Record<string, any> | undefined): string {
  const expression = initialExpression(status, target);
  if (!expression) return "-";
  const left = typeof expression.leftEyeOpen === "number" ? percent(expression.leftEyeOpen) : "-";
  const right = typeof expression.rightEyeOpen === "number" ? percent(expression.rightEyeOpen) : "-";
  return `L ${left} / R ${right}`;
}

function formatInitialExpressionMouth(status: Record<string, any>, target: Record<string, any> | undefined): string {
  const expression = initialExpression(status, target);
  if (!expression) return "-";
  const jaw = typeof expression.jawOpen === "number" ? percent(expression.jawOpen) : "-";
  const funnel = typeof expression.mouthFunnel === "number" ? percent(expression.mouthFunnel) : "-";
  return `jaw ${jaw} / funnel ${funnel}`;
}

function formatInitialExpressionBlendshapes(status: Record<string, any>, target: Record<string, any> | undefined): string {
  const expression = initialExpression(status, target);
  if (!expression) return "-";
  const top = Array.isArray(expression.topBlendshapes)
    ? expression.topBlendshapes
    : Object.entries(expression.blendshapes ?? {})
        .filter(([, score]) => typeof score === "number" && Number.isFinite(score))
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .slice(0, 6)
        .map(([name, score]) => ({ name, score: Number(score) }));
  return top.length ? top.map((item) => `${item.name} ${Math.round(item.score * 100)}%`).join(", ") : "-";
}

function formatInitialDetectorThresholds(detector: Record<string, any> | undefined): string {
  if (!detector) return "-";
  return [
    `D ${percent(detector.minDetectionConfidence)}`,
    `P ${percent(detector.minPresenceConfidence)}`,
    `T ${percent(detector.minTrackingConfidence)}`
  ].join(" / ");
}

function formatTouchPoint(touch: Record<string, any> | undefined): string {
  if (!touch) return "-";
  if (!Number.isFinite(touch.x) || !Number.isFinite(touch.y)) {
    return Number.isFinite(touch.points) ? `${touch.points} point(s)` : "-";
  }
  const points = Number.isFinite(touch.points) ? ` / ${touch.points} point(s)` : "";
  return `${Math.round(touch.x)}, ${Math.round(touch.y)}${points}`;
}
