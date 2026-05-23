/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include <hal/hal.h>
#include <runtime_compat/embedded_runtime_bridge.h>
#include <mooncake_log.h>

void Hal::powerOff()
{
    mclog::tagWarn("HAL-Power", "power off requested");
    embedded_runtime_bridge::board_power_off();
}

uint8_t Hal::getBatteryLevel()
{
    return embedded_runtime_bridge::board_get_battery_level();
}

bool Hal::isBatteryCharging()
{
    return embedded_runtime_bridge::board_is_battery_charging();
}
