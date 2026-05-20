# Codex MCP

StackChan Local exposes a small MCP stdio server so Codex can control the hardware through the desktop daemon.

## Run

```bash
npm run mcp
```

The MCP process uses the same environment variables as the normal daemon. Set `STACKCHAN_PAIRING_TOKEN` and any optional TTS or face-tracking settings in `.env` or in the environment used by Codex.

## Tools

- `stackchan_status`: return connected device, sensors, active mode, tracking, and command state.
- `stackchan_say`: speak text through the device speaker.
- `stackchan_react`: set face/emotion and optional RGB reaction.
- `stackchan_move_head`: move yaw and pitch.
- `stackchan_play_animation`: run a named animation or dance routine.
- `stackchan_capture_image`: request one camera snapshot.
- `stackchan_set_mode`: set companion state such as `idle`, `thinking`, or `speaking`.
- `stackchan_face_tracking`: enable, disable, or inspect local camera-based face tracking.

Microphone sound-seeking was removed. Person tracking is camera-only.

## Codex State Integration

The desktop daemon can watch local Codex session changes and mirror task state to StackChan:

- `thinking`: task is running.
- `speaking`: completion TTS or local speech playback is active.
- `idle`: no active task or playback.

When a Codex task finishes, the completion announcer can optionally send a TTS message and flash the RGB light. Both controls are available in the WebUI Tuning tab.
