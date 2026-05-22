# Setup

This guide assumes you cloned this repository and are running on macOS with Node.js 22 or newer.

## Desktop Daemon

```bash
npm install
cp .env.example .env
npm run dev
```

Edit `.env` before using real hardware. At minimum, change `STACKCHAN_PAIRING_TOKEN` to a private value and flash the same token into the firmware configuration.

Default endpoints:

- Device WebSocket: `ws://<mac-ip>:8787/stackchan/local`
- WebUI: `http://localhost:8788`
- mDNS service: `_stackchan-local._tcp`

Optional local face tracking:

```bash
npm run vision:install
npm run vision:model
STACKCHAN_FACE_TRACKING=1 npm run dev
```

The model download is cached at `desktop/models/face_landmarker.task` by default and is intentionally not committed.

## Firmware

Install ESP-IDF v5.5.x, then build:

```bash
source ~/esp/esp-idf-v5.5.4/export.sh
npm run firmware:build
npm run firmware:check-local-only
cd firmware
idf.py -p /dev/cu.usbmodem21301 flash
```

`npm run firmware:check-local-only` verifies that copied legacy cloud sources are not present in the firmware compile database.

The Local Companion firmware reads the desktop endpoint from the NVS namespace `stackchan_local`:

- `url`: fallback WebSocket URL, for example `ws://192.168.1.10:8787/stackchan/local`
- `token`: pairing token; must match `STACKCHAN_PAIRING_TOKEN`
- `mdns`: if true, discover `_stackchan-local._tcp` before using `url`

If the device has no saved Wi-Fi credentials, it starts a hotspot named `StackChan-XXXX`. Connect to that hotspot and open `http://192.168.4.1` to configure Wi-Fi.

## Codex MCP

Run the daemon as an MCP stdio server:

```bash
npm run mcp
```

Add that command to your Codex MCP configuration for this repository. The same daemon code can run either in WebSocket/WebUI mode or MCP stdio mode.

## Common Checks

```bash
npm run typecheck
npm test
```

Generated directories such as `node_modules/`, `desktop/dist/`, `protocol/dist/`, `firmware/build/`, and `firmware/managed_components/` are intentionally ignored.
