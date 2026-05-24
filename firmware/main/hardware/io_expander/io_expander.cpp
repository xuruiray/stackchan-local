/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include <system/device_runtime.h>
#include <hardware/io_expander/io_expander.h>
#include <system/runtime_bridge/embedded_runtime_bridge.h>
#include <hardware/io_expander/vendor/py32_io_expander/PY32IOExpander_Class.hpp>
#include <esp_log.h>
#include <mooncake_log.h>
#include <memory>

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

}  // namespace stackchan::hal::hardware

void DeviceRuntime::io_expander_init()
{
    mclog::tagInfo(_tag, "init");

    auto i2c_bus        = embedded_runtime_bridge::board_get_i2c_bus();
    _io_expander        = std::make_unique<m5::PY32IOExpander_Class>(i2c_bus);
    uint32_t start_tick = GetDeviceRuntime().millis();

    // PY32 IO Expander may boot slowly, wait for it
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(200));

        if (GetDeviceRuntime().millis() - start_tick > 1200) {
            mclog::tagError(_tag, "init timeout");
            _io_expander.reset();
            break;
        }

        if (_io_expander->begin()) {
            GetDeviceRuntime().recordI2cDiagnosticScan("after_py32_begin");
            break;
        }
        mclog::tagInfo(_tag, "init failed, retrying...");
    }

    if (_io_expander) {
        // VM EN
        _io_expander->setDirection(0, true);  // Output
        _io_expander->setPullMode(0, true);   // Pull-up
        GetDeviceRuntime().setServoPowerEnabled(true);
        vTaskDelay(pdMS_TO_TICKS(200));
        GetDeviceRuntime().recordI2cDiagnosticScan("after_py32_vm_en");

        // RGB
        _io_expander->setDirection(13, true);   // Output
        _io_expander->setPullMode(13, true);    // Pull-up
        _io_expander->setDriveMode(13, false);  // Push-pull
        _io_expander->setLedCount(12);
        vTaskDelay(pdMS_TO_TICKS(200));
        GetDeviceRuntime().showRgbColor(0, 0, 0);
        vTaskDelay(pdMS_TO_TICKS(50));
        GetDeviceRuntime().showRgbColor(0, 0, 0);

        mclog::tagInfo(_tag, "init done");
    }
}

void DeviceRuntime::setServoPowerEnabled(bool enabled)
{
    if (!_io_expander) {
        return;
    }
    _io_expander->digitalWrite(0, enabled ? true : false);
    _servo_power_enabled = enabled;
}

bool DeviceRuntime::isServoPowerEnabled()
{
    return _servo_power_enabled;
}

bool DeviceRuntime::isIoExpanderAvailable()
{
    return _io_expander != nullptr;
}
