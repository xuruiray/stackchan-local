/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include <hardware/touch/screen_touch.h>

#include <esp_log.h>
#include <esp_timer.h>

namespace stackchan::hal::hardware {
namespace {
constexpr const char* kTag = "ScreenTouch";
}

StackChanScreenTouch::StackChanScreenTouch(i2c_master_bus_handle_t i2c_bus, uint8_t addr) : I2cDevice(i2c_bus, addr)
{
    uint8_t chip_id = ReadReg(0xA3);
    ESP_LOGI(kTag, "FT6336 chip id: 0x%02X", chip_id);
    read_buffer_ = new uint8_t[6];
}

StackChanScreenTouch::~StackChanScreenTouch()
{
    delete[] read_buffer_;
}

bool StackChanScreenTouch::UpdateTouchPoint()
{
    auto err = TryReadRegs(0x02, read_buffer_, 6);
    if (err != ESP_OK) {
        touch_point_.num = 0;
        touch_point_.x   = -1;
        touch_point_.y   = -1;

        consecutive_failures_++;
        int64_t now_us = esp_timer_get_time();
        if (last_error_log_us_ == 0 || (now_us - last_error_log_us_) >= 1000 * 1000) {
            ESP_LOGW(kTag, "FT6336 read failed (%s), skipped %lu sample(s)", esp_err_to_name(err),
                     static_cast<unsigned long>(consecutive_failures_));
            last_error_log_us_ = now_us;
        }
        return false;
    }

    consecutive_failures_ = 0;
    touch_point_.num      = read_buffer_[0] & 0x0F;
    touch_point_.x        = ((read_buffer_[1] & 0x0F) << 8) | read_buffer_[2];
    touch_point_.y        = ((read_buffer_[3] & 0x0F) << 8) | read_buffer_[4];
    return true;
}

const StackChanScreenTouch::TouchPoint& StackChanScreenTouch::GetTouchPoint() const
{
    return touch_point_;
}

}  // namespace stackchan::hal::hardware
