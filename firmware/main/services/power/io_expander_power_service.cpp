/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include <system/device_runtime.h>

#include <hardware/io_expander/io_expander.h>
#include <hardware/lighting/rgb_light.h>
#include <hardware/registry.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <mooncake_log.h>

static const std::string_view _tag = "IOExpanderService";

void DeviceRuntime::io_expander_init()
{
    mclog::tagInfo(_tag, "init");

    auto i2c_bus = stackchan::hal::hardware::GetHardwareRegistry().i2c_bus();
    stackchan::hal::hardware::body_io_expander_create(i2c_bus);
    uint32_t start_tick = GetDeviceRuntime().millis();

    while (true) {
        vTaskDelay(pdMS_TO_TICKS(200));

        if (GetDeviceRuntime().millis() - start_tick > 1200) {
            mclog::tagError(_tag, "init timeout");
            stackchan::hal::hardware::GetHardwareRegistry().set_module_status("body-io-py32", false, "init_timeout");
            stackchan::hal::hardware::body_io_expander_release();
            break;
        }

        if (stackchan::hal::hardware::body_io_expander_begin()) {
            stackchan::hal::hardware::GetHardwareRegistry().set_module_status("body-io-py32", true);
            GetDeviceRuntime().recordI2cDiagnosticScan("after_py32_begin");
            break;
        }
        mclog::tagInfo(_tag, "init failed, retrying...");
    }

    if (!stackchan::hal::hardware::body_io_expander_available()) {
        return;
    }

    stackchan::hal::hardware::body_io_configure_servo_power_pin();
    GetDeviceRuntime().setServoPowerEnabled(true);
    vTaskDelay(pdMS_TO_TICKS(200));
    GetDeviceRuntime().recordI2cDiagnosticScan("after_py32_vm_en");

    stackchan::hal::hardware::body_io_configure_rgb_pin(stackchan::hal::hardware::kRgbLightCount);
    vTaskDelay(pdMS_TO_TICKS(200));
    GetDeviceRuntime().showRgbColor(0, 0, 0);
    vTaskDelay(pdMS_TO_TICKS(50));
    GetDeviceRuntime().showRgbColor(0, 0, 0);

    mclog::tagInfo(_tag, "init done");
}

void DeviceRuntime::setServoPowerEnabled(bool enabled)
{
    stackchan::hal::hardware::body_io_set_servo_power_enabled(enabled);
}

bool DeviceRuntime::isServoPowerEnabled()
{
    return stackchan::hal::hardware::body_io_servo_power_enabled();
}

bool DeviceRuntime::isIoExpanderAvailable()
{
    return stackchan::hal::hardware::body_io_expander_available();
}
