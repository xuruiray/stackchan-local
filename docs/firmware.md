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
source ~/esp/esp-idf-v5.5.4/export.sh
python3 firmware/fetch_repos.py
npm run firmware:build
npm run firmware:check-local-only
cd firmware
idf.py -p /dev/cu.usbmodem21301 flash
```

`npm run firmware:build` sets the ESP32-S3 target and builds through the project wrapper. `npm run firmware:check-local-only` checks the generated compile database and fails if legacy cloud runtime sources are linked into the local-only build.

## Local-Only Build Boundary

`CONFIG_STACKCHAN_LOCAL_ENABLE_LEGACY_CLOUD` defaults to `n`. In the default build, CMake excludes copied launcher/cloud app surfaces, App Center, EzData, cloud avatar WebSocket, cloud OTA, Xiaozhi cloud application, MQTT/WebSocket protocol clients, and 4G/RNDIS board paths.

The local-only build defines `STACKCHAN_LOCAL_DISABLE_LEGACY_CLOUD=1`, compiles out the camera explain HTTP path, and links `firmware/main/local_xiaozhi/application_local_stub.cc` instead of the upstream cloud `application.cc`.

## Local Companion Mode

The firmware boots into the StackChan face UI and connects to the desktop daemon over local WebSocket. It does not fall back to the original cloud server path.

Runtime behavior:

- Show StackChan face as the main screen.
- Send heartbeat, state, sensor, camera, touch, IMU, battery, and Wi-Fi events.
- Apply commands from the desktop daemon through the Local Companion main loop.
- Keep blinking and idle motion when no higher-priority motion controller is active.
- Reconnect on daemon disconnect. If disconnected and idle for one minute, power off.

## Wi-Fi Provisioning

If no Wi-Fi credentials are saved, the device starts an AP named `StackChan-XXXX`.

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
