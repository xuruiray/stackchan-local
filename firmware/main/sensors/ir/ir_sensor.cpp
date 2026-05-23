/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include "ir_sensor.h"

#include <esp_err.h>

namespace stackchan::hal::sensors {

void IrGpio::init(LocalPeripheralProbeSnapshot& snapshot)
{
    gpio_config_t tx_config = {
        .pin_bit_mask = 1ULL << kTxPin,
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    const esp_err_t tx_err = gpio_config(&tx_config);
    gpio_set_level(kTxPin, 0);

    gpio_config_t rx_config = {
        .pin_bit_mask = 1ULL << kRxPin,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    const esp_err_t rx_err = gpio_config(&rx_config);

    snapshot.irTxPin = static_cast<int>(kTxPin);
    snapshot.irRxPin = static_cast<int>(kRxPin);
    snapshot.irAvailable = tx_err == ESP_OK && rx_err == ESP_OK;
    snapshot.irReason = snapshot.irAvailable ? "" : "gpio_config_failed";
}

}  // namespace stackchan::hal::sensors
