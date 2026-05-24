/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once

#include <hardware/sensors/sensor_snapshot.h>

#include <driver/gpio.h>

namespace stackchan::hal::sensors {

class IrGpio {
public:
    static constexpr gpio_num_t kTxPin = GPIO_NUM_5;
    static constexpr gpio_num_t kRxPin = GPIO_NUM_10;

    void init(LocalPeripheralProbeSnapshot& snapshot);
};

}  // namespace stackchan::hal::sensors
