/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include "ina226_sensor.h"

#include <hardware/bus/i2c_bus.h>

#include <freertos/FreeRTOS.h>
#include <mooncake_log.h>

namespace stackchan::hal::sensors {
namespace {

static const std::string_view kTag = "INA226";

constexpr uint8_t INA226_CONFIGURATION = 0x00;
constexpr uint8_t INA226_SHUNT_VOLTAGE = 0x01;
constexpr uint8_t INA226_BUS_VOLTAGE = 0x02;
constexpr uint8_t INA226_CALIBRATION = 0x05;
constexpr float INA226_SHUNT_RESISTOR_OHMS = 0.01f;
constexpr float INA226_BUS_VOLTAGE_LSB = 0.00125f;
constexpr float INA226_SHUNT_VOLTAGE_LSB = 0.0000025f;
constexpr uint16_t INA226_CALIBRATION_VALUE = 2048;

}  // namespace

void Ina226::init(LocalPeripheralProbeSnapshot& snapshot)
{
    if (dev_) {
        I2cBusGuard guard;
        i2c_master_bus_rm_device(dev_);
        dev_ = nullptr;
    }

    snapshot.powerMonitorDriver = "ina226";
    snapshot.powerMonitorAddress = kAddress;
    snapshot.powerMonitorReason = "not_detected_i2c_0x41";

    if (!bus_) {
        snapshot.powerMonitorReason = "i2c_bus_unavailable";
        return;
    }

    uint8_t config_data[2] = {};
    const bool config_ok = diagnostic_read_reg(bus_, kAddress, INA226_CONFIGURATION, config_data, sizeof(config_data));
    if (!config_ok && !probe_i2c_with_retry(bus_, kAddress, 5, 60)) {
        snapshot.powerMonitorReason = "not_detected_i2c_0x41_after_retry";
        return;
    }

    if (!config_ok && !diagnostic_read_reg(bus_, kAddress, INA226_CONFIGURATION, config_data, sizeof(config_data))) {
        snapshot.powerMonitorReason = "config_read_failed_i2c_0x41";
        return;
    }

    if (add_i2c_device(bus_, kAddress, 100000, &dev_) != ESP_OK) {
        snapshot.powerMonitorReason = "i2c_add_device_failed";
        return;
    }

    const uint8_t calibration_data[3] = {
        INA226_CALIBRATION,
        static_cast<uint8_t>(INA226_CALIBRATION_VALUE >> 8),
        static_cast<uint8_t>(INA226_CALIBRATION_VALUE & 0xFF),
    };
    I2cBusGuard guard;
    if (i2c_master_transmit(dev_, calibration_data, sizeof(calibration_data), 100) != ESP_OK) {
        i2c_master_bus_rm_device(dev_);
        dev_ = nullptr;
        snapshot.powerMonitorReason = "calibration_write_failed_i2c_0x41";
        return;
    }

    snapshot.powerMonitorAvailable = true;
    snapshot.powerMonitorReason.clear();
    mclog::tagInfo(kTag, "power monitor detected");
}

void Ina226::refresh(LocalPeripheralProbeSnapshot& snapshot)
{
    if (!dev_ || !snapshot.powerMonitorAvailable) {
        return;
    }

    uint8_t bus_data[2] = {};
    uint8_t shunt_data[2] = {};
    if (read_regs(dev_, INA226_BUS_VOLTAGE, bus_data, sizeof(bus_data)) != ESP_OK ||
        read_regs(dev_, INA226_SHUNT_VOLTAGE, shunt_data, sizeof(shunt_data)) != ESP_OK) {
        snapshot.powerMonitorAvailable = false;
        snapshot.powerMonitorReason = "read_failed";
        return;
    }

    const uint16_t bus_raw = read_be_u16(bus_data);
    const int16_t shunt_raw = read_be_i16(shunt_data);
    snapshot.powerMonitorBusVoltage = static_cast<float>(bus_raw) * INA226_BUS_VOLTAGE_LSB;
    snapshot.powerMonitorShuntVoltage = static_cast<float>(shunt_raw) * INA226_SHUNT_VOLTAGE_LSB;
    snapshot.powerMonitorCurrent = snapshot.powerMonitorShuntVoltage / INA226_SHUNT_RESISTOR_OHMS;
    snapshot.powerMonitorPower = snapshot.powerMonitorBusVoltage * snapshot.powerMonitorCurrent;
}

}  // namespace stackchan::hal::sensors
