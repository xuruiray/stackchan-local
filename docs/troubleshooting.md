# Troubleshooting

## WebUI Shows Device Offline

1. Confirm the daemon is running:

   ```bash
   npm run dev
   ```

2. Open `http://localhost:8788/debug/snapshot` and check `devices`.
3. Confirm the hardware and Mac are on the same LAN.
4. Confirm firmware token matches `STACKCHAN_PAIRING_TOKEN`.
5. Check whether mDNS failed and the firmware is using an old fallback URL.

## Pairing Failed

Pairing failure usually means the token in firmware NVS does not match the daemon environment. Update both sides, restart the daemon, then reboot the device.

## No Camera Frame

- Confirm the device capability includes `camera`.
- Enable face tracking or request a camera stream from the WebUI.
- Check WebUI logs for `cameraFrame` or `vision` warnings.

## Face Tracking Is Unstable

Start with the stable preset in the Tuning tab. Increase proportional gain only after deadband and mirror direction are correct. If the head moves away from the face, toggle horizontal mirror.

## Completion TTS Does Not Play

- Confirm Codex completion announcements are enabled in the Tuning tab.
- Confirm volume is not zero.
- If cloud TTS is enabled, confirm the API key is set in the local environment.
- If cloud TTS fails, the daemon logs the provider error and falls back to local `say` where possible.

## Do Not Commit Secrets

Run a quick scan before publishing:

```bash
rg -n "V[O]LCENGINE_TTS_API_KEY=.*\\S|O[P]ENAI_API_KEY=.*\\S|s[k]-proj-|s[k]-live-|s[k]-[A-Za-z0-9]{20,}" .
```

Keep real `.env` files out of Git.
