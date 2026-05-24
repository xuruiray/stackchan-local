/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include <hardware/io_expander/io_expander.h>
#include <third_party/py32_io_expander/PY32IOExpander_Class.hpp>
#include <esp_log.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <memory>
#include <string_view>

static const std::string_view _tag = "IOExpander";

static std::unique_ptr<m5::PY32IOExpander_Class> _io_expander;
static bool _servo_power_enabled = false;

namespace stackchan::hal::hardware {

CoreS3IoExpander::CoreS3IoExpander(i2c_master_bus_handle_t i2c_bus, uint8_t addr) : I2cDevice(i2c_bus, addr)
{
    WriteReg(0x02, 0b00000111);
    WriteReg(0x03, 0b10001111);
    WriteReg(0x04, 0b00011000);
    WriteReg(0x05, 0b00001100);
    WriteReg(0x11, 0b00010000);
    WriteReg(0x12, 0b11111111);
    WriteReg(0x13, 0b11111111);
}

void CoreS3IoExpander::ResetAw88298()
{
    ESP_LOGI(_tag.data(), "reset AW88298");
    WriteReg(0x02, 0b00000011);
    vTaskDelay(pdMS_TO_TICKS(10));
    WriteReg(0x02, 0b00000111);
    vTaskDelay(pdMS_TO_TICKS(50));
}

void CoreS3IoExpander::ResetIli9342()
{
    ESP_LOGI(_tag.data(), "reset ILI9342");
    WriteReg(0x03, 0b10000001);
    vTaskDelay(pdMS_TO_TICKS(20));
    WriteReg(0x03, 0b10000011);
    vTaskDelay(pdMS_TO_TICKS(10));
}

m5::PY32IOExpander_Class* body_io_expander()
{
    return _io_expander.get();
}

bool body_io_expander_create(i2c_master_bus_handle_t i2c_bus)
{
    _io_expander = std::make_unique<m5::PY32IOExpander_Class>(i2c_bus);
    return _io_expander != nullptr;
}

void body_io_expander_release()
{
    _io_expander.reset();
    _servo_power_enabled = false;
}

bool body_io_expander_begin()
{
    return _io_expander && _io_expander->begin();
}

bool body_io_expander_available()
{
    return _io_expander != nullptr;
}

void body_io_configure_servo_power_pin()
{
    if (!_io_expander) {
        return;
    }
    _io_expander->setDirection(0, true);
    _io_expander->setPullMode(0, true);
}

void body_io_configure_rgb_pin(uint8_t led_count)
{
    if (!_io_expander) {
        return;
    }
    _io_expander->setDirection(13, true);
    _io_expander->setPullMode(13, true);
    _io_expander->setDriveMode(13, false);
    _io_expander->setLedCount(led_count);
}

void body_io_set_rgb(uint8_t index, uint8_t r, uint8_t g, uint8_t b)
{
    if (!_io_expander) {
        return;
    }
    _io_expander->setLedColor(index, r, g, b);
}

void body_io_refresh_rgb()
{
    if (!_io_expander) {
        return;
    }
    _io_expander->refreshLeds();
}

void body_io_set_servo_power_enabled(bool enabled)
{
    if (!_io_expander) {
        return;
    }
    _io_expander->digitalWrite(0, enabled ? true : false);
    _servo_power_enabled = enabled;
}

bool body_io_servo_power_enabled()
{
    return _servo_power_enabled;
}

}  // namespace stackchan::hal::hardware
