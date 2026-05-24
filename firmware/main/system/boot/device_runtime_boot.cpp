/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include <system/device_runtime.h>
#include <system/runtime_bridge/embedded_runtime_bridge.h>
#include <system/core/system_context.h>
#include <system/core/settings.h>
#include <memory>
#include <mooncake_log.h>

static std::unique_ptr<DeviceRuntime> _device_runtime_instance;
static const std::string_view _tag = "DeviceRuntime";

DeviceRuntime& GetDeviceRuntime()
{
    if (!_device_runtime_instance) {
        mclog::tagInfo(_tag, "creating device runtime instance");
        _device_runtime_instance = std::make_unique<DeviceRuntime>();
    }
    return *_device_runtime_instance.get();
}

void DeviceRuntime::init()
{
    mclog::tagInfo(_tag, "init");
    auto& context = stackchan::system::GetSystemContext();

    context.mark_boot_phase("nvs");
    mclog::tagInfo(_tag, "boot phase: nvs");
    stackchan::system::init_nvs_or_reset();

    context.mark_boot_phase("board");
    mclog::tagInfo(_tag, "boot phase: board");
    board_init();
    recordI2cDiagnosticScan("after_board_init_axp2101");

    context.mark_boot_phase("sensors");
    mclog::tagInfo(_tag, "boot phase: sensors");
    head_touch_init();
    io_expander_init();
    peripheral_probe_init();
    rtc_init();
    imu_init();

    context.mark_boot_phase("motion");
    mclog::tagInfo(_tag, "boot phase: motion");
    servo_init();

    context.mark_boot_phase("display");
    mclog::tagInfo(_tag, "boot phase: display");
    lvgl_init();

    context.mark_boot_phase("ready");
    context.services().mark("device-runtime", true);
    mclog::tagInfo(_tag, "boot phase: ready");
}

/* -------------------------------------------------------------------------- */
/*                                    Board                                   */
/* -------------------------------------------------------------------------- */

void DeviceRuntime::board_init()
{
    mclog::tagInfo(_tag, "board init");
    embedded_runtime_bridge::board_init();
}
