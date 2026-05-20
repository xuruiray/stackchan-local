# Firmware

`firmware/` is the StackChan Local firmware workspace. It keeps the original firmware dependency structure but changes the runtime target to Local Companion mode.

## Dependency Fetch

The repository does not commit generated ESP-IDF dependency directories. Fetch them before building:

```bash
cd firmware
python3 ./fetch_repos.py
```

This downloads the pinned dependencies listed in `firmware/repos.json`, including the patched XiaoZhi ESP32 source.

## Build And Flash

```bash
idf.py set-target esp32s3
idf.py build
idf.py flash monitor
```

## Local Companion Mode

The firmware boots into the StackChan face UI and connects to the desktop daemon over local WebSocket. It does not fall back to the original cloud server path.

Runtime behavior:

- Show StackChan face as the main screen.
- Send heartbeat, state, sensor, camera, touch, IMU, battery, and Wi-Fi events.
- Apply commands from the desktop daemon through the Local Companion main loop.
- Keep blinking and idle motion when no higher-priority motion controller is active.
- Reconnect on daemon disconnect. If disconnected and idle for one minute, power off.

## Wi-Fi Provisioning

If no Wi-Fi credentials are saved, the device starts an AP named `Xiaozhi-XXXX`.

1. Connect your phone or computer to that AP.
2. Open `http://192.168.4.1`.
3. Configure the LAN that also contains your desktop daemon.

The firmware then tries mDNS discovery for `_stackchan-local._tcp`. If discovery fails, it falls back to the saved WebSocket URL in NVS.

## Local Configuration

The Local Companion reads NVS namespace `stackchan_local`:

- `url`: fallback daemon URL.
- `token`: pairing token.
- `mdns`: whether to use mDNS discovery.

Use the same pairing token as `STACKCHAN_PAIRING_TOKEN`.
