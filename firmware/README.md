
# StackChan Local Firmware

This directory contains the ESP-IDF firmware workspace for StackChan Local.

The project-owned firmware lives in `main/`. ESP-IDF Component Manager resolves registry and Git dependencies into `managed_components/`; generated ESP-IDF outputs stay ignored.

The former `main/vendor/embedded_runtime/` compatibility copy has been dissolved into owned layers. Driver-level pieces now live under `main/hardware/`, hardware application runtime pieces live under `main/services/`, and boot/lifecycle/assets/compatibility primitives live under `main/system/`. The original cloud application, cloud protocol clients, cloud OTA runtime, 4G/RNDIS board support, ESP-NOW control path, unused LED implementations, unused audio codecs, and unused display decoders are not compiled.

`main/third_party/` contains passive chip/library sources used by drivers: BMI270, FTServo, PCF8563, PY32 IO expander, and SI12T.

The active firmware is split into three layers:

- `main/hardware/`: board profile, pin/config, buses, and hardware drivers only.
- `main/services/`: hardware application behavior such as display/LVGL binding, sensor polling, power/RGB/servo policy, network provisioning, expression motion, and Local Companion.
- `main/system/`: boot order, context, lifecycle, settings, diagnostics, and ESP-IDF platform glue.

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

If no Wi-Fi credentials are saved, the firmware starts a `StackChan-XXXX` provisioning AP. Connect to it and open `http://192.168.4.1`.

Local Companion uses the NVS namespace `stackchan_local`:

- `url`: fallback desktop daemon WebSocket URL.
- `token`: pairing token. Use the same value as `STACKCHAN_PAIRING_TOKEN`.
- `mdns`: whether mDNS discovery for `_stackchan-local._tcp` is enabled.
