/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once

#include <hardware/sensors/hardware_status.h>

#include <driver/gpio.h>
#include <driver/rmt_rx.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

#include <array>

namespace stackchan::hal::sensors {

class IrGpio {
public:
    static constexpr gpio_num_t kTxPin = GPIO_NUM_5;
    static constexpr gpio_num_t kRxPin = GPIO_NUM_10;

    ~IrGpio();

    void init(LocalPeripheralProbeSnapshot& snapshot);
    bool pollEvent(LocalIrEvent& event, uint32_t now);

private:
    bool startReceive();
    bool parseNecFrame(const rmt_symbol_word_t* symbols, size_t symbol_count, LocalIrEvent& event, uint32_t now);

    static bool rxDoneCallback(rmt_channel_handle_t channel, const rmt_rx_done_event_data_t* data, void* user_data);

    rmt_channel_handle_t rx_channel_ = nullptr;
    QueueHandle_t receive_queue_ = nullptr;
    std::array<rmt_symbol_word_t, 64> raw_symbols_ = {};
    rmt_receive_config_t receive_config_ = {};
    bool available_ = false;
    bool receiving_ = false;
    bool has_last_code_ = false;
    uint16_t last_address_ = 0;
    uint16_t last_command_ = 0;
    uint32_t last_repeat_event_ms_ = 0;
    uint32_t last_error_event_ms_ = 0;
};

}  // namespace stackchan::hal::sensors
