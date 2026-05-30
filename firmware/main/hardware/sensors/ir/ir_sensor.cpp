/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include "ir_sensor.h"

#include <esp_err.h>

#include <cstdio>

namespace stackchan::hal::sensors {
namespace {

constexpr uint32_t kResolutionHz = 1000000;
constexpr uint32_t kDecodeMarginUs = 200;
constexpr uint32_t kRepeatEventMinIntervalMs = 100;
constexpr uint32_t kErrorEventMinIntervalMs = 1000;
constexpr uint32_t kNecLeading0Us = 9000;
constexpr uint32_t kNecLeading1Us = 4500;
constexpr uint32_t kNecZero0Us = 560;
constexpr uint32_t kNecZero1Us = 560;
constexpr uint32_t kNecOne0Us = 560;
constexpr uint32_t kNecOne1Us = 1690;
constexpr uint32_t kNecRepeat0Us = 9000;
constexpr uint32_t kNecRepeat1Us = 2250;

bool in_range(uint32_t value, uint32_t expected)
{
    return value + kDecodeMarginUs > expected && value < expected + kDecodeMarginUs;
}

bool is_nec_logic0(const rmt_symbol_word_t& symbol)
{
    return in_range(symbol.duration0, kNecZero0Us) && in_range(symbol.duration1, kNecZero1Us);
}

bool is_nec_logic1(const rmt_symbol_word_t& symbol)
{
    return in_range(symbol.duration0, kNecOne0Us) && in_range(symbol.duration1, kNecOne1Us);
}

std::string hex16(uint16_t value)
{
    char buffer[5] = {};
    std::snprintf(buffer, sizeof(buffer), "%04X", value);
    return buffer;
}

}  // namespace

IrGpio::~IrGpio()
{
    if (rx_channel_) {
        rmt_disable(rx_channel_);
        rmt_del_channel(rx_channel_);
        rx_channel_ = nullptr;
    }
    if (receive_queue_) {
        vQueueDelete(receive_queue_);
        receive_queue_ = nullptr;
    }
}

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

    if (tx_err != ESP_OK || rx_err != ESP_OK) {
        snapshot.irAvailable = false;
        snapshot.irReason = "gpio_config_failed";
        available_ = false;
        return;
    }

    receive_queue_ = xQueueCreate(1, sizeof(rmt_rx_done_event_data_t));
    if (!receive_queue_) {
        snapshot.irAvailable = false;
        snapshot.irReason = "rmt_queue_create_failed";
        available_ = false;
        return;
    }

    rmt_rx_channel_config_t rx_channel_config = {};
    rx_channel_config.clk_src = RMT_CLK_SRC_DEFAULT;
    rx_channel_config.resolution_hz = kResolutionHz;
    rx_channel_config.mem_block_symbols = raw_symbols_.size();
    rx_channel_config.gpio_num = kRxPin;
    esp_err_t err = rmt_new_rx_channel(&rx_channel_config, &rx_channel_);
    if (err != ESP_OK || !rx_channel_) {
        snapshot.irAvailable = false;
        snapshot.irReason = "rmt_rx_channel_failed";
        available_ = false;
        return;
    }

    rmt_rx_event_callbacks_t callbacks = {};
    callbacks.on_recv_done = rxDoneCallback;
    err = rmt_rx_register_event_callbacks(rx_channel_, &callbacks, receive_queue_);
    if (err != ESP_OK) {
        snapshot.irAvailable = false;
        snapshot.irReason = "rmt_rx_callback_failed";
        available_ = false;
        return;
    }

    receive_config_.signal_range_min_ns = 1250;
    receive_config_.signal_range_max_ns = 12000000;

    err = rmt_enable(rx_channel_);
    if (err != ESP_OK || !startReceive()) {
        snapshot.irAvailable = false;
        snapshot.irReason = "rmt_rx_enable_failed";
        available_ = false;
        return;
    }

    snapshot.irAvailable = true;
    snapshot.irReason.clear();
    available_ = true;
}

bool IrGpio::pollEvent(LocalIrEvent& event, uint32_t now)
{
    event = LocalIrEvent();
    if (!available_ || !receive_queue_) {
        return false;
    }

    rmt_rx_done_event_data_t rx_data = {};
    if (xQueueReceive(receive_queue_, &rx_data, 0) != pdPASS) {
        return false;
    }

    receiving_ = false;
    const bool decoded = parseNecFrame(rx_data.received_symbols, rx_data.num_symbols, event, now);
    startReceive();
    return decoded;
}

bool IrGpio::startReceive()
{
    if (!rx_channel_ || receiving_) {
        return rx_channel_ != nullptr;
    }

    const esp_err_t err = rmt_receive(rx_channel_, raw_symbols_.data(),
                                      raw_symbols_.size() * sizeof(rmt_symbol_word_t), &receive_config_);
    receiving_ = err == ESP_OK;
    return receiving_;
}

bool IrGpio::parseNecFrame(const rmt_symbol_word_t* symbols, size_t symbol_count, LocalIrEvent& event, uint32_t now)
{
    event = LocalIrEvent();
    if (!symbols) {
        return false;
    }

    if (symbol_count == 34) {
        const bool valid_leading =
            in_range(symbols[0].duration0, kNecLeading0Us) && in_range(symbols[0].duration1, kNecLeading1Us);
        if (valid_leading) {
            uint16_t address = 0;
            uint16_t command = 0;
            bool decoded = true;
            for (int i = 0; i < 16; i++) {
                const auto& symbol = symbols[i + 1];
                if (is_nec_logic1(symbol)) {
                    address |= static_cast<uint16_t>(1U << i);
                } else if (!is_nec_logic0(symbol)) {
                    decoded = false;
                    break;
                }
            }
            for (int i = 0; decoded && i < 16; i++) {
                const auto& symbol = symbols[i + 17];
                if (is_nec_logic1(symbol)) {
                    command |= static_cast<uint16_t>(1U << i);
                } else if (!is_nec_logic0(symbol)) {
                    decoded = false;
                    break;
                }
            }

            if (decoded) {
                last_address_ = address;
                last_command_ = command;
                has_last_code_ = true;

                event.action = "received";
                event.uptimeMs = now;
                event.protocol = "nec";
                event.address = hex16(address);
                event.command = hex16(command);
                event.repeat = false;
                return true;
            }
        }
    }

    if (symbol_count == 2 && has_last_code_ &&
        in_range(symbols[0].duration0, kNecRepeat0Us) && in_range(symbols[0].duration1, kNecRepeat1Us)) {
        if (static_cast<int32_t>(now - last_repeat_event_ms_) < static_cast<int32_t>(kRepeatEventMinIntervalMs)) {
            return false;
        }
        last_repeat_event_ms_ = now;
        event.action = "received";
        event.uptimeMs = now;
        event.protocol = "nec";
        event.address = hex16(last_address_);
        event.command = hex16(last_command_);
        event.repeat = true;
        return true;
    }

    if (static_cast<int32_t>(now - last_error_event_ms_) < static_cast<int32_t>(kErrorEventMinIntervalMs)) {
        return false;
    }
    last_error_event_ms_ = now;
    event.action = "receiveError";
    event.uptimeMs = now;
    event.reason = "unknown_nec_frame";
    return true;
}

bool IrGpio::rxDoneCallback(rmt_channel_handle_t, const rmt_rx_done_event_data_t* data, void* user_data)
{
    BaseType_t high_task_wakeup = pdFALSE;
    auto queue = static_cast<QueueHandle_t>(user_data);
    if (queue && data) {
        xQueueSendFromISR(queue, data, &high_task_wakeup);
    }
    return high_task_wakeup == pdTRUE;
}

}  // namespace stackchan::hal::sensors
