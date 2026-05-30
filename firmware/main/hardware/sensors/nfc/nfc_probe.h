/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once

#include <hardware/sensors/hardware_status.h>

#include <driver/i2c_master.h>

namespace stackchan::hal::sensors {

class NfcProbe {
public:
    static constexpr uint8_t kAddress = 0x50;

    explicit NfcProbe(i2c_master_bus_handle_t bus) : bus_(bus)
    {
    }

    void init(LocalPeripheralProbeSnapshot& snapshot);
    bool pollEvent(LocalNfcEvent& event, LocalPeripheralProbeSnapshot& snapshot, uint32_t now);

private:
    i2c_master_bus_handle_t bus_ = nullptr;
    uint32_t next_health_check_ms_ = 0;
    uint32_t last_error_event_ms_ = 0;
};

}  // namespace stackchan::hal::sensors
