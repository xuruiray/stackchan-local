/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once

#include <hardware/sensors/sensor_snapshot.h>

#include <driver/i2c_master.h>

namespace stackchan::hal::sensors {

class Ina226 {
public:
    static constexpr uint8_t kAddress = 0x41;

    explicit Ina226(i2c_master_bus_handle_t bus) : bus_(bus)
    {
    }

    void init(LocalPeripheralProbeSnapshot& snapshot);
    void refresh(LocalPeripheralProbeSnapshot& snapshot);

private:
    i2c_master_bus_handle_t bus_ = nullptr;
    i2c_master_dev_handle_t dev_ = nullptr;
};

}  // namespace stackchan::hal::sensors
