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
    }
    .shell { min-height: 100vh; display: grid; grid-template-rows: auto 1fr; }
    header {
      display: grid;
      grid-template-columns: minmax(180px, 260px) 1fr auto;
      gap: 14px;
      align-items: center;
      min-height: 64px;
      padding: 10px 16px;
      background: #101214;
      border-bottom: 1px solid var(--line);
    }
    h1 { margin: 0; font-size: 16px; font-weight: 700; }
    .subtitle { margin-top: 3px; color: var(--muted); font-size: 12px; }
    .status-strip {
      display: grid;
      grid-template-columns: repeat(10, minmax(74px, 1fr));
      gap: 8px;
      min-width: 0;
    }
    .pill {
      min-width: 0;
      padding: 7px 9px;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: var(--panel-2);
      font-size: 12px;
      line-height: 1.2;
    }
    .pill .k { display: block; color: var(--muted); margin-bottom: 3px; white-space: nowrap; }
    .pill .v { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .ok { color: var(--ok); }
    .warn { color: var(--warn); }
    .bad { color: var(--bad); }
    .actions { display: flex; align-items: center; gap: 8px; }
    button {
      height: 34px;
      padding: 0 11px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--panel-2);
      color: var(--text);
      font: inherit;
      font-size: 13px;
      cursor: pointer;
    }
	    button.active { border-color: rgba(67, 213, 176, .7); background: #12312b; color: #d8fff5; }
	    button:disabled { cursor: default; opacity: .45; }
    main {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(360px, 430px);
      min-height: 0;
    }
    .stage {
      min-height: calc(100vh - 64px);
      display: grid;
      grid-template-rows: 1fr auto;
      background: #050607;
      overflow: hidden;
    }
    .video-area {
      display: grid;
      place-items: center;
      min-height: 0;
      padding: 14px;
    }
    .video-wrap {
      position: relative;
      width: min(100%, calc((100vh - 150px) * 1.333));
      max-height: calc(100vh - 150px);
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
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      padding: 0 14px 14px;
    }
    .side {
      min-height: 0;
      overflow: auto;
      background: var(--panel);
      border-left: 1px solid var(--line);
    }
    .tabs {
      position: sticky;
      top: 0;
      z-index: 2;
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 1px;
      background: var(--line);
      border-bottom: 1px solid var(--line);
    }
    .tab {
      border: 0;
      border-radius: 0;
      background: #15181a;
      color: var(--muted);
    }
    .tab.selected { background: var(--panel); color: var(--text); }
    .panel { display: none; padding: 14px; }
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
    .metric {
      display: grid;
      grid-template-columns: minmax(110px, 1fr) minmax(0, 1.2fr);
      gap: 12px;
      padding: 7px 0;
      border-top: 1px solid rgba(255,255,255,.04);
      font-size: 13px;
    }
    .metric:first-of-type { border-top: 0; }
    .metric span:first-child { color: var(--muted); }
    .metric span:last-child { text-align: right; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
    .control-row {
      display: grid;
      grid-template-columns: 76px minmax(0, 1fr) 52px;
      gap: 9px;
      align-items: center;
      padding: 7px 0;
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
    @media (max-width: 1180px) {
      header { grid-template-columns: 1fr; align-items: stretch; }
      .status-strip { grid-template-columns: repeat(5, minmax(86px, 1fr)); }
      .actions { justify-content: flex-start; }
    }
    @media (max-width: 900px) {
      main { grid-template-columns: 1fr; }
      .side { border-left: 0; border-top: 1px solid var(--line); }
      .stage { min-height: auto; }
      .frame-footer { grid-template-columns: repeat(2, 1fr); }
      .video-wrap { width: 100%; max-height: none; }
    }
    @media (max-width: 560px) {
      .status-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .frame-footer { grid-template-columns: 1fr; }
      .log-controls { grid-template-columns: 1fr; }
    }
    header {
      position: sticky;
      top: 0;
      z-index: 10;
      grid-template-columns: 1fr;
      align-items: stretch;
      min-height: auto;
      padding: 10px 12px;
    }
    .status-strip {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding-bottom: 2px;
      scrollbar-width: thin;
    }
    .status-strip .pill { min-width: 88px; }
    .actions { justify-content: flex-start; overflow-x: auto; }
    main {
      display: block;
      min-height: auto;
    }
    .stage {
      min-height: auto;
      display: block;
      overflow: visible;
    }
    .video-area {
      display: block;
      padding: 10px;
    }
    .video-wrap {
      width: 100%;
      max-height: none;
    }
    .frame-footer {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      padding: 0 10px 10px;
    }
    .side {
      overflow: visible;
      border-left: 0;
      border-top: 1px solid var(--line);
    }
    .tabs {
      display: flex;
      overflow-x: auto;
      scrollbar-width: thin;
    }
    .tab {
      flex: 0 0 auto;
      min-width: 96px;
    }
    .panel { padding: 12px; }
    .metric {
      grid-template-columns: minmax(92px, .9fr) minmax(0, 1.3fr);
      gap: 10px;
    }
    .metric span:last-child { white-space: normal; }
    .logs { max-height: 460px; }
    @media (min-width: 1120px) {
      header {
        grid-template-columns: minmax(180px, 260px) 1fr auto;
        align-items: center;
        min-height: 64px;
        padding: 10px 16px;
      }
      .status-strip {
        display: grid;
        grid-template-columns: repeat(10, minmax(74px, 1fr));
        overflow: visible;
        padding-bottom: 0;
      }
      .status-strip .pill { min-width: 0; }
      .actions { justify-content: flex-end; overflow: visible; }
      main {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(360px, 430px);
        min-height: 0;
      }
      .stage {
        min-height: calc(100vh - 64px);
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
        width: min(100%, calc((100vh - 150px) * 1.333));
        max-height: calc(100vh - 150px);
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
            <div class="metric"><span>Backlight</span><span id="hardwareBacklight">${html(initial.hardwareBacklight)}</span></div>
            <div class="metric"><span>Speaker</span><span id="hardwareSpeaker">${html(initial.hardwareSpeaker)}</span></div>
            <div class="metric"><span>Servo power</span><span id="hardwareServoPower">${html(initial.hardwareServoPower)}</span></div>
            <div class="metric"><span>IO expander</span><span id="hardwareIoExpander">${html(initial.hardwareIoExpander)}</span></div>
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
            <div class="metric"><span>RGB</span><span id="hardwareRgb">${html(initial.hardwareRgb)}</span></div>
            <div class="metric"><span>RTC</span><span id="hardwareRtc">${html(initial.hardwareRtc)}</span></div>
            <div class="metric"><span>NFC</span><span id="hardwareNfc">${html(initial.hardwareNfc)}</span></div>
            <div class="metric"><span>IR</span><span id="hardwareIr">${html(initial.hardwareIr)}</span></div>
            <div class="metric"><span>Proximity</span><span id="hardwareProximity">${html(initial.hardwareProximity)}</span></div>
            <div class="metric"><span>Ambient light</span><span id="hardwareAmbientLight">${html(initial.hardwareAmbientLight)}</span></div>
            <div class="metric"><span>Magnetometer</span><span id="hardwareMagnetometer">${html(initial.hardwareMagnetometer)}</span></div>
            <div class="metric"><span>Mic</span><span id="hardwareMic">${html(initial.hardwareMic)}</span></div>
            <div class="metric"><span>Frame age</span><span id="sensorFrameAge">${html(initial.frameAge)}</span></div>
            <div class="metric"><span>Face count</span><span id="sensorFaceCount">${html(initial.statFaces)}</span></div>
            <div class="metric"><span>Target</span><span id="sensorTarget">${html(initial.targetSummary)}</span></div>
            <div class="metric"><span>Mode</span><span id="sensorMode">${html(initial.deviceMode)}</span></div>
            <div class="metric"><span>Snapshot age</span><span id="hardwareSnapshotAge">${html(initial.hardwareSnapshotAge)}</span></div>
          </div>
        </section>

        <section id="tuning" class="panel">
          <div class="toolbar">
            <button id="presetFast" type="button">Fast preset</button>
            <button id="presetStable" type="button">Stable preset</button>
            <button id="presetDefault" type="button">Reset defaults</button>
          </div>
          <div class="group">
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
		          <div class="group">
		            <div class="group-title">Audio</div>
		            <div class="metric"><span>Codex 播报</span><span class="${attr(initial.ttsEnabledClass)}" id="ttsEnabledSummary">${html(initial.ttsEnabledSummary)}</span></div>
		            <div class="metric"><span>灯光闪烁</span><span class="${attr(initial.ttsLightEnabledClass)}" id="ttsLightSummary">${html(initial.ttsLightSummary)}</span></div>
		            <div class="control-row"><label for="ttsVolumeControl">TTS Vol</label><input id="ttsVolumeControl" type="range" min="0" max="100" step="1" value="${attr(initial.ttsVolume)}" /><output id="ttsVolumeValue">${html(initial.ttsVolume)}</output></div>
		            <div class="metric"><span>Completion</span><span id="ttsVolumeSummary">${html(initial.ttsVolumeSummary)}</span></div>
		          </div>
          <div class="group">
            <div class="group-title">Command</div>
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
            <div class="metric"><span>Audio frames</span><span id="debugAudioFrames">${html(initial.debugAudioFrames)}</span></div>
            <div class="metric"><span>Last event</span><span id="debugLastEvent">${html(initial.debugLastEvent)}</span></div>
          </div>
          <div class="group">
            <div class="group-title">Counters</div>
            <div class="metric"><span>Vision frames</span><span id="debugVisionFrames">${html(initial.debugVisionFrames)}</span></div>
            <div class="metric"><span>Vision drops</span><span id="debugVisionDrops">${html(initial.debugVisionDrops)}</span></div>
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
    let imuFusion = null;
    let imu3d = null;
    let latest = null;
    let lastFrameId = frame.dataset.frameId || null;
    let pendingFrameId = null;
    let frameLoadSeq = 0;
    let controlTimer = null;
    let ttsVolumeTimer = null;
    let logsPaused = false;
    let logEntries = [];

    const presets = {
      fast: { speed: 720, control: { deadband: 0.035, integralLimit: 0.25, outputLimitDeg: 28, yaw: { kp: 62, ki: 0, kd: 10 }, pitch: { kp: 44, ki: 0, kd: 8 } } },
      stable: { speed: 480, control: { deadband: 0.06, integralLimit: 0.2, outputLimitDeg: 16, yaw: { kp: 36, ki: 0, kd: 12 }, pitch: { kp: 26, ki: 0, kd: 8 } } },
      defaults: { speed: 420, control: { deadband: 0.045, integralLimit: 0.35, outputLimitDeg: 20, yaw: { kp: 42, ki: 0, kd: 8 }, pitch: { kp: 30, ki: 0, kd: 6 } } }
    };

    function setText(id, value, className) {
      const node = $(id);
      if (!node) return;
      node.textContent = value == null || value === '' ? '-' : String(value);
      node.className = className || '';
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

    function availability(item, availableText) {
      if (!item) return '-';
      if (item.available === false) return 'Unavailable' + (item.reason ? ': ' + item.reason : '');
      if (item.available === true) return availableText || 'available';
      return '-';
    }

    function formatPowerValue(value, suffix) {
      return Number.isFinite(value) ? Math.round(value) + suffix : '-';
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
      const size = Number.isFinite(item.width) && Number.isFinite(item.height) ? item.width + ' x ' + item.height : '-';
      const fps = Number.isFinite(item.fps) ? ' / ' + num(item.fps, 1) + ' fps' : '';
      return (item.streaming ? 'streaming ' : 'ready ') + size + fps;
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
      return channels + (item.mode ? ' / ' + item.mode : '') + (item.localization ? ' / localization ' + item.localization : '');
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
      setText('deviceStatus', device && device.status || '-');
      setText('deviceMode', device && device.mode || '-');
      setText('deviceSeen', age(device && device.lastSeenAt));
      setText('deviceCaps', (device && device.capabilities || []).join(', '));

      setText('sensorBatteryLevel', Number.isFinite(power.batteryLevel) ? Math.round(power.batteryLevel) + '%' : (sensors.battery ? Math.round(sensors.battery.level) + '%' : '-'));
      setText('sensorBatteryCharging', typeof power.charging === 'boolean' ? boolText(power.charging) : (sensors.battery ? (sensors.battery.charging ? 'yes' : 'no') : '-'));
      setText('hardwareBacklight', formatPowerValue(power.backlight, '%'));
      setText('hardwareSpeaker', formatPowerValue(power.speakerVolume, '%'));
      setText('hardwareServoPower', boolText(power.servoPower));
      setText('hardwareIoExpander', availability(peripherals.ioExpander));
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
      setText('hardwareRgb', peripherals.rgb ? availability(peripherals.rgb, 'available' + (Number.isFinite(peripherals.rgb.count) ? ' / ' + peripherals.rgb.count + ' LEDs' : '')) : '-');
      setText('hardwareRtc', formatRtc(peripherals.rtc));
      setText('hardwareNfc', availability(peripherals.nfc));
      setText('hardwareIr', availability(peripherals.ir));
      setText('hardwareProximity', peripherals.proximity && peripherals.proximity.available ? num(peripherals.proximity.value, 2) : availability(peripherals.proximity));
      setText('hardwareAmbientLight', peripherals.ambientLight && peripherals.ambientLight.available ? num(peripherals.ambientLight.lux, 1) + ' lux' : availability(peripherals.ambientLight));
      setText('hardwareMagnetometer', peripherals.magnetometer && peripherals.magnetometer.available ? [peripherals.magnetometer.x, peripherals.magnetometer.y, peripherals.magnetometer.z].map((v) => num(v, 2)).join(', ') : availability(peripherals.magnetometer));
      setText('hardwareMic', formatMic(peripherals.mic));
      setText('hardwareSnapshotAge', age(hardware.updatedAt));
      setText('sensorFrameAge', age(snapshot.frame && snapshot.frame.timestamp || status.lastFrameAt));
      setText('sensorFaceCount', (snapshot.faces || []).length);
      setText('sensorTarget', formatCenter(snapshot.target));
      setText('sensorMode', device && device.mode || '-');

      setText('frameId', snapshot.frame && snapshot.frame.frameId || '-');
      setText('frameSize', snapshot.frame ? snapshot.frame.width + ' x ' + snapshot.frame.height : '-');
      setText('lastFrame', age(snapshot.frame && snapshot.frame.timestamp || status.lastFrameAt));
      setText('targetSummary', formatCenter(snapshot.target));
      setText('tuneCommand', age(status.lastCommandAt));
      setText('tuneCenter', formatCenter(snapshot.target));
      renderCompletionTts(snapshot.completionTts);
      setText('debugDeviceId', device && device.deviceId || '-');
      setText('debugSessionId', device && device.sessionId || '-');
      setText('debugFirmware', device && device.firmwareVersion || '-');
      setText('debugAudioFrames', firstDefined(device && device.audioFramesReceived, '-'));
      setText('debugLastEvent', device && device.lastEvent && device.lastEvent.kind || '-');
      setText('debugVisionFrames', firstDefined(status.framesReceived, '-'));
      setText('debugVisionDrops', firstDefined(status.framesDropped, '-'));
      $('rawSnapshot').textContent = JSON.stringify(snapshot, null, 2);

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
      return num(box.x + box.width / 2, 2) + ', ' + num(box.y + box.height / 2, 2);
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
      const nextFrameId = String(snapshot.frame.frameId);
      if (nextFrameId === lastFrameId || nextFrameId === pendingFrameId) return;

      pendingFrameId = nextFrameId;
      const loadSeq = ++frameLoadSeq;
      const nextSrc = '/frame.jpg?frameId=' + encodeURIComponent(nextFrameId) + '&t=' + Date.now();
      const preloader = new Image();
      preloader.decoding = 'async';
      preloader.onload = () => {
        if (loadSeq !== frameLoadSeq || pendingFrameId !== nextFrameId) return;
        frame.src = nextSrc;
        frame.dataset.frameId = nextFrameId;
        lastFrameId = nextFrameId;
        pendingFrameId = null;
      };
      preloader.onerror = () => {
        if (loadSeq === frameLoadSeq && pendingFrameId === nextFrameId) pendingFrameId = null;
      };
      preloader.src = nextSrc;
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

    function collectControlPatch() {
      const patch = { control: { mode: 'pid' } };
      for (const input of controls) {
        writePath(patch, input.dataset.path, Number(input.value));
      }
      return patch;
    }

    function scheduleControlPost() {
      clearTimeout(controlTimer);
      controlTimer = setTimeout(() => {
        fetch('/api/tracking', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ control: collectControlPatch() })
        }).catch(console.error);
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

    async function postPreset(preset) {
      await fetch('/api/tracking', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ control: preset })
      });
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
      fetch('/api/tracking', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: !(latest && latest.status && latest.status.enabled) })
      }).catch(console.error);
    });
	    if (toggleCompletionTts) {
	      toggleCompletionTts.addEventListener('click', toggleCompletionTtsEnabled);
	    }
	    if (toggleCompletionLight) {
	      toggleCompletionLight.addEventListener('click', toggleCompletionLightEnabled);
	    }
	    testCompletionTts.addEventListener('click', () => {
      fetch('/api/completion-tts-test', { method: 'POST' }).catch(console.error);
    });
    $('presetFast').addEventListener('click', () => postPreset(presets.fast));
    $('presetStable').addEventListener('click', () => postPreset(presets.stable));
    $('presetDefault').addEventListener('click', () => postPreset(presets.defaults));
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
      if (logsPaused) return;
      logEntries.push(JSON.parse(event.data));
      if (logEntries.length > 500) logEntries = logEntries.slice(-500);
      renderLogs();
    };
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
    frameSrc: frame ? `/frame.jpg?frameId=${encodeURIComponent(String(frame.frameId ?? ""))}` : "",
    frameId: valueOrDash(frame?.frameId),
    frameSize: frame ? `${frame.width} x ${frame.height}` : "-",
    frameAge: age(frame?.timestamp ?? status.lastFrameAt),
    targetSummary: formatCenter(target),
    faceEnabled: status.enabled ? "yes" : "no",
    faceEnabledClass: status.enabled ? "ok" : "warn",
    lastFace: age(status.lastFaceAt),
    lastCommand: age(status.lastCommandAt),
    targetBox: formatBox(target),
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
    hardwareBacklight: formatInitialPercent(power.backlight),
    hardwareSpeaker: formatInitialPercent(power.speakerVolume),
    hardwareServoPower: boolInitial(power.servoPower),
    hardwareIoExpander: formatInitialAvailability(peripherals.ioExpander),
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
    hardwareRgb: peripherals.rgb
      ? formatInitialAvailability(peripherals.rgb, `available${Number.isFinite(peripherals.rgb.count) ? ` / ${peripherals.rgb.count} LEDs` : ""}`)
      : "-",
    hardwareRtc: formatInitialRtc(peripherals.rtc),
    hardwareNfc: formatInitialAvailability(peripherals.nfc),
    hardwareIr: formatInitialAvailability(peripherals.ir),
    hardwareProximity: peripherals.proximity?.available ? numberText(peripherals.proximity.value, 2) : formatInitialAvailability(peripherals.proximity),
    hardwareAmbientLight: peripherals.ambientLight?.available ? `${numberText(peripherals.ambientLight.lux, 1)} lux` : formatInitialAvailability(peripherals.ambientLight),
    hardwareMagnetometer: peripherals.magnetometer?.available
      ? [peripherals.magnetometer.x, peripherals.magnetometer.y, peripherals.magnetometer.z].map((value: unknown) => numberText(value, 2)).join(", ")
      : formatInitialAvailability(peripherals.magnetometer),
    hardwareMic: formatInitialMic(peripherals.mic),
    hardwareSnapshotAge: age(hardware.updatedAt),
    debugDeviceId: valueOrDash(device?.deviceId),
    debugSessionId: valueOrDash(device?.sessionId),
    debugFirmware: valueOrDash(device?.firmwareVersion),
    debugAudioFrames: valueOrDash(device?.audioFramesReceived),
    debugLastEvent: valueOrDash(device?.lastEvent?.kind),
    debugVisionFrames: valueOrDash(status.framesReceived),
    debugVisionDrops: valueOrDash(status.framesDropped),
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

function formatInitialAvailability(sensor: Record<string, any> | undefined, availableText = "available"): string {
  if (!sensor) return "-";
  if (sensor.available === false) {
    return `Unavailable${sensor.reason ? `: ${sensor.reason}` : ""}`;
  }
  if (sensor.available === true) {
    return availableText;
  }
  return "-";
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
  const size = Number.isFinite(sensor.width) && Number.isFinite(sensor.height) ? `${sensor.width} x ${sensor.height}` : "-";
  const fps = Number.isFinite(sensor.fps) ? ` / ${numberText(sensor.fps, 1)} fps` : "";
  return `${sensor.streaming ? "streaming" : "ready"} ${size}${fps}`;
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
  return `${channels}${sensor.mode ? ` / ${sensor.mode}` : ""}${sensor.localization ? ` / localization ${sensor.localization}` : ""}`;
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

function formatTouchPoint(touch: Record<string, any> | undefined): string {
  if (!touch) return "-";
  if (!Number.isFinite(touch.x) || !Number.isFinite(touch.y)) {
    return Number.isFinite(touch.points) ? `${touch.points} point(s)` : "-";
  }
  const points = Number.isFinite(touch.points) ? ` / ${touch.points} point(s)` : "";
  return `${Math.round(touch.x)}, ${Math.round(touch.y)}${points}`;
}
