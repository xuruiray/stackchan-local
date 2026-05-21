# WebUI

The desktop daemon serves the debug dashboard at:

```text
http://localhost:8788
```

It is designed as a vertical-first hardware panel for phones and narrow windows, while desktop widths use a two-column layout.

![Desktop WebUI screenshot](assets/webui-screenshot.png)

The README screenshot is captured from a real local daemon session. The camera preview area is blurred before committing so the repository does not expose private room details.

## Static Layout Mockups

The SVG examples below are static documentation assets that show the intended desktop and mobile layout without live camera data.

![Desktop WebUI example](assets/webui-dashboard.svg)

![Mobile WebUI example](assets/webui-mobile.svg)

## Layout

- Sticky status bar: device online, face tracking, FPS, battery, Wi-Fi, IMU age, last error.
- Video area: latest camera frame, face boxes, landmarks, target crosshair, pose, confidence, frame timestamp.
- Tabs: `Overview`, `Hardware`, `Tuning`, `Debug`, and `Logs`.
- Hardware tab: power, IO, servos, IMU, interaction state, and peripheral placeholders.
- Tuning tab: camera presets, face-tracking PID, tracking presets, TTS volume, completion TTS toggle, completion light toggle.
- Debug tab: device id, firmware version, session id, capabilities, camera preset, detector latency, counters, last event, and sanitized snapshot.
- Logs tab: daemon ring-buffer logs with level/type/search filters.

The UI updates fields in place from SSE events and avoids rebuilding the full page, which prevents the flashing behavior seen during early prototypes.

## HTTP Endpoints

- `GET /status`: lightweight daemon, device, tracking, and sensor status.
- `GET /stream.mjpg`: MJPEG preview stream for external viewers and debugging.
- `GET /frame.jpg`: latest camera preview frame. The built-in WebUI uses this as a low-latency frame pump to avoid WebView MJPEG buffering.
- `GET /events`: SSE stream for status and frame metadata updates.
- `GET /debug/snapshot`: full sanitized state snapshot without image/base64 payloads.
- `GET /debug/logs?limit=200&level=info&type=device|vision|command|system`: recent structured logs.
- `GET /debug/log-events`: SSE stream for log updates.
- `POST /api/tracking`: update face-tracking enable state, camera preset, or PID settings.
- `GET /api/completion-tts`: current Codex completion notification settings.
- `POST /api/completion-tts`: update completion TTS, completion light, or volume.
- `POST /api/completion-tts-test`: trigger one local completion notification test.

## Log Redaction

The daemon keeps recent logs in an in-memory ring buffer. Base64 image data and large audio payloads are summarized before they reach the WebUI.

## WebUI Examples

The example images in `docs/assets/` are static SVG mockups intended for GitHub documentation. They represent the current layout and control groups, but live values come from the daemon at runtime.
