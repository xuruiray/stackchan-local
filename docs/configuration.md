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
- `STACKCHAN_FACE_TRACKING_FPS`: requested camera stream FPS. Default `4`.
- `STACKCHAN_FACE_TRACKING_MIRROR_X`: mirror horizontal tracking. Default `false`.
- `STACKCHAN_FACE_TRACKING_SPEED`: servo speed for tracking commands.
- `STACKCHAN_FACE_TRACKING_DEADBAND`: normalized center deadband.
- `STACKCHAN_FACE_TRACKING_YAW_KP`, `STACKCHAN_FACE_TRACKING_YAW_KI`, `STACKCHAN_FACE_TRACKING_YAW_KD`: yaw PID gains.
- `STACKCHAN_FACE_TRACKING_PITCH_KP`, `STACKCHAN_FACE_TRACKING_PITCH_KI`, `STACKCHAN_FACE_TRACKING_PITCH_KD`: pitch PID gains.

## Completion Notifications

- `STACKCHAN_VOLCENGINE_TTS_ENABLED`: enable cloud TTS for completion announcements. Default `0`.
- `VOLCENGINE_TTS_API_KEY`: provider key. Never commit this.
- `VOLCENGINE_TTS_VOICE_ID`: TTS voice id.
- `STACKCHAN_CODEX_COMPLETION_TTS_TEXT`: text prefix used for completion announcements.
- `STACKCHAN_CODEX_COMPLETION_TTS_VOLUME`: playback volume, `0` to `100`. Default `80`.

Cloud TTS is optional. If it is disabled or fails, the daemon falls back to local `say` where possible.
