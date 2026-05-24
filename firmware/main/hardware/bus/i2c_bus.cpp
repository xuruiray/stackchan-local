/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include <hardware/bus/i2c_bus.h>

#include <esp_log.h>
#include <freertos/FreeRTOS.h>

namespace {

class I2cDiagnosticLogSilencer {
public:
    I2cDiagnosticLogSilencer()
        : i2c_master_level_(esp_log_level_get("i2c.master")), i2c_level_(esp_log_level_get("i2c"))
    {
        esp_log_level_set("i2c.master", ESP_LOG_NONE);
        esp_log_level_set("i2c", ESP_LOG_NONE);
    }

    ~I2cDiagnosticLogSilencer()
    {
        esp_log_level_set("i2c.master", i2c_master_level_);
        esp_log_level_set("i2c", i2c_level_);
    }

private:
    esp_log_level_t i2c_master_level_;
    esp_log_level_t i2c_level_;
};

}  // namespace

namespace stackchan::hal::hardware::bus {

bool probe_i2c(i2c_master_bus_handle_t bus, uint8_t address)
{
    I2cDiagnosticLogSilencer silence;
    return bus && i2c_master_probe(bus, address, pdMS_TO_TICKS(80)) == ESP_OK;
}

esp_err_t add_i2c_device(i2c_master_bus_handle_t bus, uint8_t address, uint32_t speed_hz,
                         i2c_master_dev_handle_t* out_dev)
{
    i2c_device_config_t dev_cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = address,
        .scl_speed_hz = speed_hz,
    };
    return i2c_master_bus_add_device(bus, &dev_cfg, out_dev);
}

esp_err_t write_reg(i2c_master_dev_handle_t dev, uint8_t reg, uint8_t value)
{
    uint8_t data[2] = {reg, value};
    return i2c_master_transmit(dev, data, sizeof(data), pdMS_TO_TICKS(80));
}

esp_err_t read_regs(i2c_master_dev_handle_t dev, uint8_t reg, uint8_t* data, size_t len)
{
    return i2c_master_transmit_receive(dev, &reg, 1, data, len, pdMS_TO_TICKS(80));
}

bool diagnostic_read_reg(i2c_master_bus_handle_t bus, uint8_t address, uint8_t reg, uint8_t* data, size_t len)
{
    if (!bus || !data || len == 0) {
        return false;
    }
    I2cDiagnosticLogSilencer silence;
    i2c_master_dev_handle_t dev = nullptr;
    if (add_i2c_device(bus, address, 100000, &dev) != ESP_OK || dev == nullptr) {
        return false;
    }
    const esp_err_t err = read_regs(dev, reg, data, len);
    i2c_master_bus_rm_device(dev);
    return err == ESP_OK;
}

bool diagnostic_write_ping(i2c_master_bus_handle_t bus, uint8_t address, uint8_t value)
{
    if (!bus) {
        return false;
    }
    I2cDiagnosticLogSilencer silence;
    i2c_master_dev_handle_t dev = nullptr;
    if (add_i2c_device(bus, address, 100000, &dev) != ESP_OK || dev == nullptr) {
        return false;
    }
    const esp_err_t err = i2c_master_transmit(dev, &value, 1, pdMS_TO_TICKS(80));
    i2c_master_bus_rm_device(dev);
    return err == ESP_OK;
}

uint16_t read_be_u16(const uint8_t data[2])
{
    return static_cast<uint16_t>((data[0] << 8) | data[1]);
}

int16_t read_be_i16(const uint8_t data[2])
{
    return static_cast<int16_t>(read_be_u16(data));
}

}  // namespace stackchan::hal::hardware::bus
