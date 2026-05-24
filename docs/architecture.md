# Architecture

StackChan Local has one runtime path:

```text
Codex MCP client <-> desktop daemon <-> LAN WebSocket <-> StackChan firmware
```

The original cloud server, account binding, app center, EzData, cloud avatar WebSocket, cloud OTA entry, and mobile social features are not part of the local runtime.

## Desktop Daemon

The desktop daemon is a TypeScript Node process under `desktop/`.

Responsibilities:

- WebSocket server on `8787` for StackChan firmware.
- mDNS advertisement for `_stackchan-local._tcp`.
- Pairing token verification and JSON Schema validation.
- Device registry, heartbeat, ACK tracking, and online/offline state.
- Motion arbitration so animation, manual move, face tracking, and idle motion do not fight.
- MCP stdio server for Codex tools.
- Codex session watcher for `idle`, `thinking`, and completion events.
- Optional completion TTS and RGB completion flash.
- Optional face tracking through a local Python MediaPipe Tasks Face Landmarker sidecar.
- WebUI/debug dashboard on `8788`.

## Firmware

Firmware lives under `firmware/` as an ESP-IDF project with a local-only hardware, service, and system layering.

Responsibilities:

- Local Companion screen and StackChan avatar.
- WebSocket client to the desktop daemon.
- Servo, RGB, camera, audio playback, wake word, touch, IMU, Wi-Fi, and power events.
- Low-rate `sensorSnapshot` reports for the WebUI.
- Idle motion and blinking when no higher-priority controller is active.
- Offline behavior: reconnect while active, then power off after the configured disconnected idle timeout.

Project-owned firmware code is split into:

- `firmware/main/system/`: boot, SystemContext, settings, runtime state, power lifecycle, diagnostics, assets, and temporary compatibility primitives.
- `firmware/main/hardware/`: board profile, bus, PMIC/backlight, camera, audio codec, touch, IO expander, BLE/Wi-Fi adapters, and sensor-facing drivers.
- `firmware/main/services/`: hardware application behavior for display, audio, motion, sensors, power, network, expression motion, and Local Companion.
- `firmware/main/services/local_companion/`: local WebSocket service, command dispatch, telemetry, camera stream, audio playback, and protocol helpers.
- `firmware/main/services/local_companion/transport/`: local companion network/WebSocket transport adapters.
- `firmware/main/services/expression_motion/`: StackChan expression, avatar, animation, and motion engine.
- `firmware/main/system/runtime_bridge/`: the narrow bridge into temporary legacy runtime APIs.
- `firmware/main/third_party/`: passive chip libraries used by the owned hardware drivers.

`firmware/main/system/device_runtime.h` is the firmware facade used by application code. The old `firmware/main/hal` and `firmware/main/vendor/embedded_runtime` trees have been removed; passive chip libraries live in `firmware/main/third_party`, and runtime behavior lives in the owned hardware/service/system layer that owns it.

## Protocol

`protocol/` is the shared contract. The daemon validates inbound and outbound JSON messages before routing them.

Main message families:

- `handshake`: device identity, firmware version, capabilities, audio params, and pairing token.
- `daemon.hello`: session id and enabled feature flags.
- `robot.command`: speech, reaction, motion, animation, camera stream, audio playback, face tracking, and mode changes.
- `robot.event`: battery, Wi-Fi, BLE, touch, IMU, wake word, camera frame, sensor snapshot, and state.
- `ack` and `error`: command completion and failure reporting.

## Motion Priority

The effective priority is:

```text
animation or dance > manual head movement > face tracking > idle random movement
```

Codex state changes such as `thinking` and `speaking` control expression, light, and status, but they do not directly override the active head controller.

## Privacy Model

Camera frames stay on the local network between StackChan and the daemon. Face tracking detects landmarks, pose, and expressions for local motion control only; it does not do identity recognition. Microphone sound localization was removed; microphones remain for wake word and voice audio.
