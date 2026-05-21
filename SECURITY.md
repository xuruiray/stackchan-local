# Security

StackChan Local is intended for a trusted local network.

## Secrets

Keep pairing tokens and provider API keys in `.env` or your local shell environment. Never commit real keys.

Daemon debug logs redact common secret fields such as tokens, passwords, API keys, authorization headers, and image payloads before exposing them in the WebUI.

## Network Exposure

By default, the WebUI binds to `127.0.0.1` and the device WebSocket binds to `0.0.0.0` so hardware on the LAN can connect. Do not expose the WebSocket port directly to the public internet.

## Camera And Audio

Camera frames are used for local face detection only. The project does not do identity recognition. Microphone direction finding is removed; microphones are used for wake word and voice audio only.

## Reporting

If you find a security issue, open a private GitHub Security Advisory if the repository supports it. Otherwise, open an issue with enough detail to reproduce the problem, but do not include secrets or private network data.
