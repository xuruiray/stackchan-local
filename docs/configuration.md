# Configuration

Copy `.env.example` to `.env` for local development:

```bash
cp .env.example .env
```

## Core

- `STACKCHAN_LOCAL_HOST`: WebSocket bind host. Default `0.0.0.0`.
- `STACKCHAN_LOCAL_PORT`: WebSocket port. Default `8787`.
- `STACKCHAN_PREVIEW_ENABLED`: enable WebUI. Default `1`.
- `STACKCHAN_PREVIEW_HOST`: WebUI bind host. Default `127.0.0.1`.
- `STACKCHAN_PREVIEW_PORT`: WebUI port. Default `8788`.
- `STACKCHAN_PAIRING_TOKEN`: shared token used by firmware handshake.
- `STACKCHAN_ADVERTISE_MDNS`: advertise `_stackchan-local._tcp`. Default `1`.

## Codex Companion

- `STACKCHAN_CODEX_STATUS`: mirror Codex state to hardware. Default `1`.
- `STACKCHAN_CODEX_SESSIONS_ROOT`: optional override for Codex session storage path.

## Face Tracking

- `STACKCHAN_FACE_TRACKING`: enable camera-based face tracking. Default `0`.
- `STACKCHAN_FACE_TRACKING_PYTHON`: Python executable used by the local MediaPipe detector. Use an absolute path if the daemon is launched by `launchctl` or another stripped environment.
- `STACKCHAN_FACE_TRACKING_CAMERA_PRESET`: camera stream preset, one of `fast`, `accurate`, or `debug`. Default `fast`.
- `STACKCHAN_FACE_LANDMARKER_MODEL`: MediaPipe Tasks Face Landmarker model path. Default `desktop/models/face_landmarker.task`.
- `STACKCHAN_FACE_TRACKING_MAX_FACES`: maximum faces passed through the local detector. Default `1`.
- `STACKCHAN_FACE_TRACKING_MIN_DETECTION_CONFIDENCE`: detector threshold. Default `0.18`.
- `STACKCHAN_FACE_TRACKING_MIN_PRESENCE_CONFIDENCE`: face presence threshold. Default `0.18`.
- `STACKCHAN_FACE_TRACKING_MIN_TRACKING_CONFIDENCE`: tracking threshold. Default `0.18`.
- `STACKCHAN_FACE_TRACKING_MIRROR_X`: mirror horizontal tracking. Default `false`.
- `STACKCHAN_FACE_TRACKING_SPEED`: servo speed for tracking commands.
- `STACKCHAN_FACE_TRACKING_DEADBAND`: normalized center deadband.
- `STACKCHAN_FACE_TRACKING_YAW_KP`, `STACKCHAN_FACE_TRACKING_YAW_KI`, `STACKCHAN_FACE_TRACKING_YAW_KD`: yaw PID gains.
- `STACKCHAN_FACE_TRACKING_PITCH_KP`, `STACKCHAN_FACE_TRACKING_PITCH_KI`, `STACKCHAN_FACE_TRACKING_PITCH_KD`: pitch PID gains.

Default tracking is tuned for responsiveness: `speed=760`, `deadband=0.018`, yaw PID `78/0/10`, pitch PID `54/0/8`, and `outputLimitDeg=32`. The WebUI `Official Range` preset keeps the original servo range but lower-gain behavior is available through `Smooth PID`.

Camera presets:

- `fast`: `320x240 @ 10fps`, JPEG quality `18`. Default low-latency desktop pet mode.
- `accurate`: `320x240 @ 6fps`, JPEG quality `28`. Clearer frames without switching the GC0308 sensor into its unstable VGA path.
- `debug`: `320x240 @ 2fps`, JPEG quality `35`. Useful when inspecting image quality and detector behavior.

The firmware currently falls back to `320x240` when a client requests a larger frame. On this StackChan GC0308/DVP path, `640x480` reports correct metadata but can produce corrupted green/magenta frames, so VGA mode is disabled for stability.

## Completion Notifications

- `STACKCHAN_VOLCENGINE_TTS_ENABLED`: enable cloud TTS for completion announcements. Default `0`.
- `VOLCENGINE_TTS_API_KEY`: provider key. Never commit this.
- `VOLCENGINE_TTS_VOICE_ID`: TTS voice id.
- `STACKCHAN_CODEX_COMPLETION_TTS_TEXT`: text prefix used for completion announcements.
- `STACKCHAN_CODEX_COMPLETION_TTS_VOLUME`: playback volume, `0` to `100`. Default `80`.

Cloud TTS is optional. If it is disabled or fails, the daemon falls back to local `say` where possible.
