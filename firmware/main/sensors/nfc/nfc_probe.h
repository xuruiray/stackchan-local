/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once

#include <sensors/sensor_snapshot.h>

#include <driver/i2c_master.h>

namespace stackchan::hal::sensors {

class NfcProbe {
public:
    static constexpr uint8_t kAddress = 0x50;

    explicit NfcProbe(i2c_master_bus_handle_t bus) : bus_(bus)
    {
    }

    void init(LocalPeripheralProbeSnapshot& snapshot);

private:
    i2c_master_bus_handle_t bus_ = nullptr;
};

}  // namespace stackchan::hal::sensors
