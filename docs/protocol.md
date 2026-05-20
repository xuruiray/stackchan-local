# Local Protocol

The firmware connects to:

```text
ws://<mac-ip>:8787/stackchan/local
```

Messages are JSON envelopes unless explicitly noted. Large image payloads are kept out of `/status` and `/debug/snapshot`; use `/frame.jpg` for the latest preview frame.

## Pairing

The first message from firmware must be `handshake`:

```json
{
  "type": "handshake",
  "deviceId": "stackchan-001",
  "firmwareVersion": "0.1.0-local",
  "capabilities": {
    "avatar": true,
    "motion": true,
    "rgb": true,
    "camera": true,
    "audio": true,
    "imu": true,
    "touch": true,
    "sensorSnapshot": true
  },
  "audioParams": {
    "codec": "opus",
    "sampleRate": 16000,
    "channels": 1
  },
  "pairingToken": "change-me"
}
```

The daemon validates the token and replies with `daemon.hello`, including a session id and enabled feature flags.

## Commands

`robot.command` supports:

- `say`: speak text through firmware TTS fallback or local speech path.
- `react`: update avatar expression and optional RGB reaction.
- `moveHead`: manual yaw/pitch movement.
- `playAnimation`: run a named animation or dance routine.
- `captureImage`: request one camera snapshot.
- `cameraStream`: start or stop low-FPS JPEG camera streaming.
- `trackFace`: send a normalized face target and PID settings.
- `setMode`: set companion mode such as `idle`, `thinking`, or `speaking`.
- `playAudio`: stream pre-synthesized PCM/WAV chunks to the hardware speaker.

Every command has a `commandId`. Firmware should answer with an ACK containing the same id, success state, optional recoverable error, and latency metadata when available.

## Events

`robot.event` supports:

- `battery`: level and charging state.
- `wifi`: SSID, RSSI, and connection state.
- `ble`: provisioning and BLE state.
- `imu`: accelerometer, gyro, derived attitude, and filter metadata.
- `touch`: head and screen touch events.
- `wakeWord`: wake word detection state.
- `cameraFrame`: base64 JPEG frame for local face detection.
- `sensorSnapshot`: one-second hardware summary for the WebUI.
- `state`: current firmware mode and motion state.

## Sensor Snapshot

`sensorSnapshot` is intentionally low frequency. It groups data that does not need a dedicated high-rate stream:

- Power and IO: battery, charging, backlight, volume, servo power, IO expander.
- Motion: servo yaw/pitch, moving state, torque, IMU age.
- Interaction: touch, wake word, BLE, Wi-Fi.
- Peripherals: camera, RGB, RTC, NFC, IR, proximity/ALS, magnetometer, microphone audio link.

If a peripheral is present but not wired into firmware yet, report it as `status: "not_connected"` or `status: "unsupported"` rather than inventing values.

## Camera Face Tracking

Face tracking uses:

- `robot.command.cameraStream`: daemon asks firmware to stream low-FPS JPEG frames.
- `robot.event.cameraFrame`: firmware sends base64 JPEG frames for OpenCV detection.
- `robot.command.trackFace`: daemon sends normalized target data and PID settings.

Firmware applies `trackFace` from the Local Companion main loop, not directly inside the WebSocket callback.

## Removed Sound Seeking

Microphone direction seeking was abandoned. There is no `soundDirection`, `soundLocalization`, or `trackSound` runtime path. Microphones are only reported as audio hardware and remain available for wake word and voice audio.
