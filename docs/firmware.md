# Firmware

`firmware/` is the StackChan Local firmware workspace. It targets the current M5Stack StackChan / ESP32-S3 hardware profile and keeps only the runtime pieces needed by Local Companion mode.

## Dependencies

ESP-IDF Component Manager resolves normal dependencies into the ignored `firmware/managed_components/` cache during build. ArduinoJson comes from the ESP Component Registry; Mooncake, Mooncake Log, and Smooth UI Toolkit are Git dependencies. Runtime pieces formerly copied under `firmware/main/vendor/embedded_runtime/` now live in the owned `hardware/`, `services/`, and `system/` layers, so builds are reproducible from this repository plus ESP-IDF managed components.

## Build And Flash

```bash
source ~/esp/esp-idf-v5.5.4/export.sh
npm run firmware:build
npm run firmware:check-local-only
cd firmware
idf.py -p /dev/cu.usbmodem21301 flash
```

`npm run firmware:build` lets ESP-IDF Component Manager resolve registry/Git dependencies and builds through the project wrapper. `npm run firmware:check-local-only` checks the generated compile database and fails if legacy cloud runtime sources are linked into the local-only build.

## Local-Only Build Boundary

`CONFIG_STACKCHAN_LOCAL_ENABLE_LEGACY_CLOUD` defaults to `n`. In the default build, CMake excludes copied launcher/cloud app surfaces, App Center, EzData, cloud avatar WebSocket, cloud OTA, upstream cloud application, MQTT/WebSocket protocol clients, and 4G/RNDIS board paths.

The local-only build defines `STACKCHAN_LOCAL_DISABLE_LEGACY_CLOUD=1`, compiles out the camera explain HTTP path, and links `firmware/main/system/runtime_bridge/application_local_stub.cc` instead of the original cloud `application.cc`.

## Firmware Layout

Project-owned firmware code is organized by hardware architecture responsibility:

```text
firmware/main/
  app/local_companion/       Local Companion UI app
  system/
    boot/                    app boot sequence and runtime startup
    core/                    SystemContext, Clock, EventBus, ServiceRegistry, settings, diagnostics
    lifecycle/               reboot, power-off, factory reset, runtime state
    power_policy/            idle power policy namespace
    platform/esp_idf/        ESP-IDF adapters
    runtime_bridge/          compatibility bridge to retained runtime primitives
    legacy_runtime/          temporary Board/Application/Protocol compatibility primitives
    core/assets/             embedded audio/language asset pack builder and store
  hardware/
    board/m5stack_stackchan/ BoardProfile, pinmap, electrical config
    bus/                     I2C helpers
    power/                   AXP2101/backlight driver
    display/                 ILI9342/LVGL display driver
    touch/                   FT6336 touch driver
    audio/                   CoreS3 codec driver
    camera/                  GC0308 camera driver
    motion/                  servo driver declarations
    io_expander/             AW9523/PY32 IO expander driver surface
    lighting/                RGB strip hardware constants
    sensors/                 SI12T/BMI270/PCF8563/INA226/LTR553/NFC/IR driver-facing modules
    network/                 BLE peripheral and Wi-Fi station adapters
  services/
    display/                 LVGL display runtime, input binding, and RGB display behavior
    motion/                  servo calibration and expression-motion binding
    sensors/                 polling, snapshots, I2C diagnostics, events
    power/                   IO expander, servo power, body RGB power-up policy
    audio/                   codec service, wake word, audio processing, mic level, and playback test behavior
    network/                 Wi-Fi, SNTP, BLE provisioning
    expression_motion/       avatar/motion/modifiers
    local_companion/         WebSocket session, commands, telemetry, media stream
  third_party/               passive chip libraries copied from old module vendor dirs
```

`hardware/` drivers take only bus/config dependencies and expose begin/available/read/write/control-style operations. They should not call Local Companion services, LVGL application objects, or `GetDeviceRuntime()` for application behavior. `services/` composes those drivers into polling loops, snapshots, telemetry, RGB/servo power behavior, and UI bindings. `system/core/SystemContext` owns the boot phase, service registry, event bus, task runner, and the shared `HardwareRegistry`.

The legacy `firmware/main/hal` directory has been removed. New compatibility-facing code can include `system/device_runtime.h`, but new hardware modules should prefer direct driver interfaces and `hardware/registry.h` over adding more `Board::GetInstance()` or `embedded_runtime_bridge` calls.

`system/legacy_runtime/` and `system/runtime_bridge/embedded_runtime_bridge.{h,cpp}` remain temporary compatibility boundaries for retained runtime calls such as display locks, battery state, speaker volume, and power-off. New local firmware code should not expand those boundaries unless it is replacing an older direct runtime dependency.

## Hardware Acceptance

After flashing, run the desktop daemon and validate `http://localhost:8788`:

- `/`, `/status`, `/debug/snapshot`, and `/debug/logs` return 200.
- The Hardware, Debug, and Logs tabs update while the device is online.
- `/debug/snapshot` covers battery/PMIC, screen touch, head touch, IMU accel/gyro, RTC, mic level, camera, RGB/io expander, servo power, I2C scan, NFC probe, IR, LTR553 proximity/ALS, INA226 power monitor, and magnetometer status.
- Present hardware reports legal values that change with touch, motion, light, sound, and camera stimuli. Absent or unwired modules report `available:false` with a clear `reason`.
- Enabling camera stream produces a valid JPEG from `/frame.jpg` or `/stream.mjpg`.
- Firmware serial logs and desktop logs contain boot phases for board, bus, driver, and service init, with no unexplained `ERROR`, no persistent `WARN` spam, no reconnect loop, and no repeated sensor init timeout.

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
