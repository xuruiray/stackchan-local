/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once

#include <axp2101.h>
#include <hardware/power/backlight.h>
#include <driver/i2c_master.h>

namespace stackchan::hal::hardware {

class StackChanPmic : public Axp2101 {
public:
    StackChanPmic(i2c_master_bus_handle_t i2c_bus, uint8_t addr);

    bool SetBrightness(uint8_t brightness);
    bool IsExternalPowerConnected();

private:
    bool set_charger_constant_current(uint8_t option);
};

class StackChanBacklight : public Backlight {
public:
    explicit StackChanBacklight(StackChanPmic* pmic);

private:
    void SetBrightnessImpl(uint8_t brightness) override;

    StackChanPmic* pmic_;
};

}  // namespace stackchan::hal::hardware
