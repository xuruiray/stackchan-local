
# StackChan Local Firmware

This directory contains the ESP-IDF firmware workspace for StackChan Local.

The project-owned firmware lives in `main/`. ESP-IDF Component Manager resolves registry and Git dependencies into `managed_components/`; the retained embedded runtime subset lives in `main/embedded_runtime/`. Generated ESP-IDF outputs stay ignored.

`main/embedded_runtime/` contains the selected audio, display, LED, board-common, settings, assets, and device-state runtime code used by Local Companion. The original cloud application, cloud protocol clients, OTA runtime, 4G/RNDIS board support, ESP-NOW control path, and launcher app stack are not compiled.

`main/local_runtime_adapters/` contains the project-owned compatibility surface for retained upstream runtime APIs. It links a local `Application` stub and a small Wi-Fi network adapter that implements only the WebSocket path needed by StackChan Local; HTTP, MQTT, UDP, 4G modem, ESP-NOW, and upstream cloud OTA paths are intentionally excluded from the runtime build.

`main/robot_expression_motion_runtime/` contains the robot expression and motion runtime: avatar rendering, emotions, idle modifiers, animation playback, servo motion, RGB control, and JSON command adapters.

## Toolchain

Use ESP-IDF v5.5.x for ESP32-S3.

## Build

```bash
idf.py set-target esp32s3
idf.py build
```

## Flash

```bash
idf.py flash monitor
```

See `../docs/firmware.md` for Wi-Fi provisioning, local endpoint configuration, and runtime behavior.
