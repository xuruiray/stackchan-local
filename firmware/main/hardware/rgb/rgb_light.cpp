/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include <system/device_runtime.h>
#include <hardware/io_expander/io_expander.h>
#include <hardware/rgb/rgb_light.h>
#include <hardware/io_expander/vendor/py32_io_expander/PY32IOExpander_Class.hpp>

void DeviceRuntime::setRgbColor(uint8_t index, uint8_t r, uint8_t g, uint8_t b)
{
    auto* io_expander = stackchan::hal::hardware::body_io_expander();
    if (!io_expander) {
        return;
    }
    io_expander->setLedColor(index, r, g, b);
}

void DeviceRuntime::refreshRgb()
{
    auto* io_expander = stackchan::hal::hardware::body_io_expander();
    if (!io_expander) {
        return;
    }
    io_expander->refreshLeds();
}

void DeviceRuntime::showRgbColor(uint8_t r, uint8_t g, uint8_t b)
{
    for (int i = 0; i < stackchan::hal::hardware::kRgbLightCount; i++) {
        setRgbColor(i, r, g, b);
    }
    refreshRgb();
}
