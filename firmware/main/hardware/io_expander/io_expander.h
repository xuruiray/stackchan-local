/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once

#include <cstdint>
#include <driver/i2c_master.h>
#include <i2c_device.h>

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

}  // namespace stackchan::hal::hardware
