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
STACKCHAN_FACE_TRACKING=1 npm run dev
```

## Firmware

Install ESP-IDF v5.5.x, then fetch firmware dependencies and build:

```bash
cd firmware
python3 ./fetch_repos.py
idf.py set-target esp32s3
idf.py build
idf.py flash monitor
```

The Local Companion firmware reads the desktop endpoint from the NVS namespace `stackchan_local`:

- `url`: fallback WebSocket URL, for example `ws://192.168.1.10:8787/stackchan/local`
- `token`: pairing token; must match `STACKCHAN_PAIRING_TOKEN`
- `mdns`: if true, discover `_stackchan-local._tcp` before using `url`

If the device has no saved Wi-Fi credentials, it starts a hotspot named `Xiaozhi-XXXX`. Connect to that hotspot and open `http://192.168.4.1` to configure Wi-Fi.

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

Generated directories such as `node_modules/`, `desktop/dist/`, `protocol/dist/`, `firmware/build/`, `firmware/components/`, `firmware/managed_components/`, and `firmware/xiaozhi-esp32/` are intentionally ignored.
