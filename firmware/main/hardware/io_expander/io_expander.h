/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once

#include <cstdint>
#include <driver/i2c_master.h>
#include <hardware/bus/i2c_device.h>

namespace m5 {
class PY32IOExpander_Class;
}

namespace stackchan::hal::hardware {

class CoreS3IoExpander : public I2cDevice {
public:
    CoreS3IoExpander(i2c_master_bus_handle_t i2c_bus, uint8_t addr);

    void ResetAw88298();
    void ResetIli9342();
};

m5::PY32IOExpander_Class* body_io_expander();
bool body_io_expander_create(i2c_master_bus_handle_t i2c_bus);
void body_io_expander_release();
bool body_io_expander_begin();
bool body_io_expander_available();
void body_io_configure_servo_power_pin();
void body_io_configure_rgb_pin(uint8_t led_count);
void body_io_set_rgb(uint8_t index, uint8_t r, uint8_t g, uint8_t b);
void body_io_refresh_rgb();
void body_io_set_servo_power_enabled(bool enabled);
bool body_io_servo_power_enabled();

}  // namespace stackchan::hal::hardware
