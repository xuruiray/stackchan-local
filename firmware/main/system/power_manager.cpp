/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include <system/device_runtime.h>
#include <runtime_compat/embedded_runtime_bridge.h>
#include <mooncake_log.h>

void DeviceRuntime::powerOff()
{
    mclog::tagWarn("PowerManager", "power off requested");
    embedded_runtime_bridge::board_power_off();
}

uint8_t DeviceRuntime::getBatteryLevel()
{
    return embedded_runtime_bridge::board_get_battery_level();
}

bool DeviceRuntime::isBatteryCharging()
{
    return embedded_runtime_bridge::board_is_battery_charging();
}
