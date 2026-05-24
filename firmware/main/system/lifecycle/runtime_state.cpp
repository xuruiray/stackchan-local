/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include <system/device_runtime.h>

#include <esp_mac.h>
#include <esp_system.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <mooncake_log.h>
#include <system/core/settings.h>

void DeviceRuntime::delay(std::uint32_t ms)
{
    vTaskDelay(pdMS_TO_TICKS(ms));
}

std::uint32_t DeviceRuntime::millis()
{
    return esp_timer_get_time() / 1000;
}

void DeviceRuntime::feedTheDog()
{
    vTaskDelay(1);
}

std::array<uint8_t, 6> DeviceRuntime::getFactoryMac()
{
    std::array<uint8_t, 6> mac;
    esp_efuse_mac_get_default(mac.data());
    return mac;
}

std::string DeviceRuntime::getFactoryMacString(std::string divider)
{
    auto mac = getFactoryMac();
    return fmt::format("{:02X}{}{:02X}{}{:02X}{}{:02X}{}{:02X}{}{:02X}", mac[0], divider, mac[1], divider, mac[2],
                       divider, mac[3], divider, mac[4], divider, mac[5]);
}

void DeviceRuntime::reboot()
{
    esp_restart();
}

namespace {
static std::string_view warm_boot_nvs_ns  = "warm_boot";
static std::string_view warm_boot_nvs_key = "app_index";
}

void DeviceRuntime::requestWarmReboot(int appIndex)
{
    mclog::tagInfo("RuntimeState", "warm reboot request to app index: {}", appIndex);
    {
        Settings settings(warm_boot_nvs_ns.data(), true);
        settings.SetInt(warm_boot_nvs_key.data(), appIndex);
    }

    delay(100);
    esp_restart();
}

int DeviceRuntime::getWarmRebootTarget()
{
    Settings settings(warm_boot_nvs_ns.data(), false);
    return settings.GetInt(warm_boot_nvs_key.data(), -1);
}

void DeviceRuntime::clearWarmRebootRequest()
{
    mclog::tagInfo("RuntimeState", "clear warm reboot request");

    Settings settings(warm_boot_nvs_ns.data(), true);
    settings.SetInt(warm_boot_nvs_key.data(), -1);
}
