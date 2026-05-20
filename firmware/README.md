
# StackChan Local Firmware

This directory contains the ESP-IDF firmware workspace for StackChan Local.

It keeps the original StackChan/XiaoZhi source layout, but the runtime is Local Companion mode: the device connects to the desktop daemon on the local network instead of requiring the original cloud server path.

## Toolchain

Use ESP-IDF v5.5.x for ESP32-S3.

## Fetch Dependencies

```bash
python3 ./fetch_repos.py
```

This creates ignored dependency directories such as `components/` and `xiaozhi-esp32/`.

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
