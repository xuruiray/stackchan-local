/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once

#include <cstdint>
#include <hardware/bus/i2c_device.h>
#include <driver/i2c_master.h>

namespace stackchan::hal::hardware {

class StackChanScreenTouch : public I2cDevice {
public:
    struct TouchPoint {
        int num = 0;
        int x   = -1;
        int y   = -1;
    };

    StackChanScreenTouch(i2c_master_bus_handle_t i2c_bus, uint8_t addr);
    ~StackChanScreenTouch();

    bool UpdateTouchPoint();
    const TouchPoint& GetTouchPoint() const;

private:
    uint8_t* read_buffer_ = nullptr;
    TouchPoint touch_point_;
    int64_t last_error_log_us_     = 0;
    uint32_t consecutive_failures_ = 0;
};

}  // namespace stackchan::hal::hardware
