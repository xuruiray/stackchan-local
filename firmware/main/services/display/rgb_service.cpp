/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include <system/device_runtime.h>
#include <hardware/io_expander/io_expander.h>
#include <hardware/lighting/rgb_light.h>

void DeviceRuntime::setRgbColor(uint8_t index, uint8_t r, uint8_t g, uint8_t b)
{
    stackchan::hal::hardware::body_io_set_rgb(index, r, g, b);
}

void DeviceRuntime::refreshRgb()
{
    stackchan::hal::hardware::body_io_refresh_rgb();
}

void DeviceRuntime::showRgbColor(uint8_t r, uint8_t g, uint8_t b)
{
    for (int i = 0; i < stackchan::hal::hardware::kRgbLightCount; i++) {
        setRgbColor(i, r, g, b);
    }
    refreshRgb();
}
