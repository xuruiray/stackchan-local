/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include "hal.h"
#include "board/hal_bridge.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <driver/gpio.h>
#include <driver/i2c_master.h>
#include <esp_err.h>
#include <freertos/FreeRTOS.h>
#include <mooncake_log.h>
#include <mutex>

static const std::string_view _tag = "HAL-Peripherals";

namespace {

constexpr uint8_t kLtr553Address = 0x23;
constexpr uint8_t kIna226Address = 0x41;
constexpr uint8_t kNfcAddress = 0x50;
constexpr gpio_num_t kIrTxPin = GPIO_NUM_5;
constexpr gpio_num_t kIrRxPin = GPIO_NUM_10;

constexpr uint8_t LTR553_ALS_CONTR = 0x80;
constexpr uint8_t LTR553_PS_CONTR = 0x81;
constexpr uint8_t LTR553_PS_LED = 0x82;
constexpr uint8_t LTR553_PS_N_PULSES = 0x83;
constexpr uint8_t LTR553_PS_MEAS_RATE = 0x84;
constexpr uint8_t LTR553_ALS_MEAS_RATE = 0x85;
constexpr uint8_t LTR553_PART_ID = 0x86;
constexpr uint8_t LTR553_MANUFACTURER_ID = 0x87;
constexpr uint8_t LTR553_ALS_DATA_CH1_0 = 0x88;
constexpr uint8_t LTR553_PS_DATA_0 = 0x8D;

constexpr uint8_t INA226_SHUNT_VOLTAGE = 0x01;
constexpr uint8_t INA226_BUS_VOLTAGE = 0x02;
constexpr float INA226_SHUNT_RESISTOR_OHMS = 0.01f;
constexpr float INA226_BUS_VOLTAGE_LSB = 0.00125f;
constexpr float INA226_SHUNT_VOLTAGE_LSB = 0.0000025f;
constexpr size_t kMaxI2cScanStages = 8;

std::mutex snapshot_mutex;
LocalPeripheralProbeSnapshot snapshot;
i2c_master_dev_handle_t ltr553_dev = nullptr;
i2c_master_dev_handle_t ina226_dev = nullptr;

bool probe_i2c(i2c_master_bus_handle_t bus, uint8_t address)
{
    return bus && i2c_master_probe(bus, address, pdMS_TO_TICKS(80)) == ESP_OK;
}

bool scan_probe_i2c(i2c_master_bus_handle_t bus, uint8_t address)
{
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

void init_ir()
{
    gpio_config_t tx_config = {
        .pin_bit_mask = 1ULL << kIrTxPin,
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    const esp_err_t tx_err = gpio_config(&tx_config);
    gpio_set_level(kIrTxPin, 0);

    gpio_config_t rx_config = {
        .pin_bit_mask = 1ULL << kIrRxPin,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    const esp_err_t rx_err = gpio_config(&rx_config);

    std::lock_guard<std::mutex> lock(snapshot_mutex);
    snapshot.irTxPin = static_cast<int>(kIrTxPin);
    snapshot.irRxPin = static_cast<int>(kIrRxPin);
    snapshot.irAvailable = tx_err == ESP_OK && rx_err == ESP_OK;
    snapshot.irReason = snapshot.irAvailable ? "" : "gpio_config_failed";
}

void init_ltr553(i2c_master_bus_handle_t bus)
{
    std::lock_guard<std::mutex> lock(snapshot_mutex);
    snapshot.proximityDriver = "ltr553";
    snapshot.ambientLightDriver = "ltr553";
    snapshot.proximityReason = "not_detected_i2c_0x23";
    snapshot.ambientLightReason = "not_detected_i2c_0x23";

    if (!probe_i2c(bus, kLtr553Address)) {
        return;
    }

    if (add_i2c_device(bus, kLtr553Address, 100000, &ltr553_dev) != ESP_OK) {
        snapshot.proximityReason = "i2c_add_device_failed";
        snapshot.ambientLightReason = "i2c_add_device_failed";
        return;
    }

    uint8_t part_id = 0;
    uint8_t manufacturer_id = 0;
    read_regs(ltr553_dev, LTR553_PART_ID, &part_id, 1);
    read_regs(ltr553_dev, LTR553_MANUFACTURER_ID, &manufacturer_id, 1);

    write_reg(ltr553_dev, LTR553_PS_CONTR, 0x00);
    write_reg(ltr553_dev, LTR553_ALS_CONTR, 0x00);
    write_reg(ltr553_dev, LTR553_PS_LED, 0x3C);
    write_reg(ltr553_dev, LTR553_PS_MEAS_RATE, 0x00);
    write_reg(ltr553_dev, LTR553_PS_N_PULSES, 0x01);
    write_reg(ltr553_dev, LTR553_ALS_MEAS_RATE, 0x03);
    write_reg(ltr553_dev, LTR553_ALS_CONTR, 0x19);
    write_reg(ltr553_dev, LTR553_PS_CONTR, 0x02);
    snapshot.proximityAvailable = true;
    snapshot.ambientLightAvailable = true;
    snapshot.proximityReason.clear();
    snapshot.ambientLightReason.clear();
    mclog::tagInfo(_tag, "LTR553 detected part=0x%02x manufacturer=0x%02x", part_id, manufacturer_id);
}

void init_ina226(i2c_master_bus_handle_t bus)
{
    std::lock_guard<std::mutex> lock(snapshot_mutex);
    snapshot.powerMonitorDriver = "ina226";
    snapshot.powerMonitorAddress = kIna226Address;
    snapshot.powerMonitorReason = "not_detected_i2c_0x41";

    if (!probe_i2c(bus, kIna226Address)) {
        return;
    }

    if (add_i2c_device(bus, kIna226Address, 100000, &ina226_dev) != ESP_OK) {
        snapshot.powerMonitorReason = "i2c_add_device_failed";
        return;
    }

    snapshot.powerMonitorAvailable = true;
    snapshot.powerMonitorReason.clear();
    mclog::tagInfo(_tag, "INA226 power monitor detected");
}

void init_nfc(i2c_master_bus_handle_t bus)
{
    std::lock_guard<std::mutex> lock(snapshot_mutex);
    snapshot.nfcDriver = "st25r3916-probe";
    snapshot.nfcAddress = kNfcAddress;
    snapshot.nfcAvailable = probe_i2c(bus, kNfcAddress);
    snapshot.nfcStatus = snapshot.nfcAvailable ? "chip_detected" : "";
    snapshot.nfcReason = snapshot.nfcAvailable ? "" : "not_detected_i2c_0x50";
}

void refresh_ltr553(LocalPeripheralProbeSnapshot& out)
{
    if (!ltr553_dev || (!out.proximityAvailable && !out.ambientLightAvailable)) {
        return;
    }

    uint8_t data[7] = {};
    if (read_regs(ltr553_dev, LTR553_ALS_DATA_CH1_0, data, sizeof(data)) != ESP_OK) {
        out.proximityAvailable = false;
        out.ambientLightAvailable = false;
        out.proximityReason = "read_failed";
        out.ambientLightReason = "read_failed";
        return;
    }

    const uint16_t als_ch1 = static_cast<uint16_t>(data[0] | (data[1] << 8));
    const uint16_t als_ch0 = static_cast<uint16_t>(data[2] | (data[3] << 8));
    uint8_t ps_data[2] = {};
    if (read_regs(ltr553_dev, LTR553_PS_DATA_0, ps_data, sizeof(ps_data)) == ESP_OK) {
        out.proximityRaw = static_cast<uint16_t>((ps_data[1] & 0x07) << 8 | ps_data[0]);
        out.proximityValue = out.proximityRaw;
    }

    const uint32_t total = static_cast<uint32_t>(als_ch0) + als_ch1;
    out.ambientLightRaw = total >> 1;
    if (total == 0) {
        out.ambientLightLux = 0.0f;
        return;
    }

    const float ratio = static_cast<float>(als_ch1) / static_cast<float>(total);
    float lux = 0.0f;
    if (ratio < 0.45f) {
        lux = 1.7743f * als_ch0 + 1.1059f * als_ch1;
    } else if (ratio < 0.64f) {
        lux = 4.2785f * als_ch0 - 1.9548f * als_ch1;
    } else if (ratio < 0.85f) {
        lux = 0.5926f * als_ch0 + 0.1185f * als_ch1;
    }
    out.ambientLightLux = std::max(0.0f, lux / 48.0f);
}

void refresh_ina226(LocalPeripheralProbeSnapshot& out)
{
    if (!ina226_dev || !out.powerMonitorAvailable) {
        return;
    }

    uint8_t bus_data[2] = {};
    uint8_t shunt_data[2] = {};
    if (read_regs(ina226_dev, INA226_BUS_VOLTAGE, bus_data, sizeof(bus_data)) != ESP_OK ||
        read_regs(ina226_dev, INA226_SHUNT_VOLTAGE, shunt_data, sizeof(shunt_data)) != ESP_OK) {
        out.powerMonitorAvailable = false;
        out.powerMonitorReason = "read_failed";
        return;
    }

    const uint16_t bus_raw = read_be_u16(bus_data);
    const int16_t shunt_raw = read_be_i16(shunt_data);
    out.powerMonitorBusVoltage = static_cast<float>(bus_raw) * INA226_BUS_VOLTAGE_LSB;
    out.powerMonitorShuntVoltage = static_cast<float>(shunt_raw) * INA226_SHUNT_VOLTAGE_LSB;
    out.powerMonitorCurrent = out.powerMonitorShuntVoltage / INA226_SHUNT_RESISTOR_OHMS;
    out.powerMonitorPower = out.powerMonitorBusVoltage * out.powerMonitorCurrent;
}

}  // namespace

void Hal::peripheral_probe_init()
{
    mclog::tagInfo(_tag, "init");
    auto i2c_bus = hal_bridge::board_get_i2c_bus();

    recordI2cDiagnosticScan("peripheral_probe_start");
    init_ir();
    init_ltr553(i2c_bus);
    init_ina226(i2c_bus);
    init_nfc(i2c_bus);
    recordI2cDiagnosticScan("peripheral_probe_done");
}

LocalPeripheralProbeSnapshot Hal::getLocalPeripheralProbeSnapshot()
{
    std::lock_guard<std::mutex> lock(snapshot_mutex);
    LocalPeripheralProbeSnapshot current = snapshot;
    refresh_ltr553(current);
    refresh_ina226(current);
    snapshot = current;
    return current;
}

void Hal::recordI2cDiagnosticScan(std::string_view stage)
{
    LocalI2cScanStageSnapshot scan;
    scan.stage = std::string(stage);
    scan.uptimeMs = millis();

    auto i2c_bus = hal_bridge::board_get_i2c_bus();
    if (!i2c_bus) {
        scan.reason = "i2c_bus_unavailable";
    } else {
        static constexpr uint8_t kDiagnosticAddresses[] = {
            0x21,  // GC0308 camera control
            0x23,  // LTR553 proximity / ambient light
            0x34,  // AXP2101 PMIC
            0x36,  // AW88298 audio amp
            0x38,  // FT6336 touch
            0x40,  // ES7210 audio ADC
            0x41,  // INA226 body power monitor
            0x50,  // ST25R3916 NFC
            0x51,  // BM8563 RTC
            0x58,  // AW9523 CoreS3 IO expander
            0x68,  // Si12T head touch
            0x69,  // BMI270 IMU
            0x6f,  // PY32 StackChan body IO expander
            0x71,  // PY32 alternate ADD_SEL address
        };
        for (const auto address : kDiagnosticAddresses) {
            if (scan_probe_i2c(i2c_bus, address)) {
                scan.addresses.push_back(address);
            }
        }

        uint8_t one_byte = 0;
        uint8_t two_bytes[2] = {};
        const bool py32_by_read = diagnostic_read_reg(i2c_bus, 0x6f, 0x02, &one_byte, 1);
        const bool ltr_by_read = diagnostic_read_reg(i2c_bus, kLtr553Address, LTR553_PART_ID, &one_byte, 1);
        const bool ina_by_read = diagnostic_read_reg(i2c_bus, kIna226Address, 0x00, two_bytes, sizeof(two_bytes));
        const bool nfc_by_ping = diagnostic_write_ping(i2c_bus, kNfcAddress, 0x00);
        if ((py32_by_read || isIoExpanderAvailable()) &&
            std::find(scan.addresses.begin(), scan.addresses.end(), 0x6f) == scan.addresses.end()) {
            scan.addresses.push_back(0x6f);
        }
        if (ltr_by_read && std::find(scan.addresses.begin(), scan.addresses.end(), kLtr553Address) == scan.addresses.end()) {
            scan.addresses.push_back(kLtr553Address);
        }
        if (ina_by_read && std::find(scan.addresses.begin(), scan.addresses.end(), kIna226Address) == scan.addresses.end()) {
            scan.addresses.push_back(kIna226Address);
        }
        if (nfc_by_ping && std::find(scan.addresses.begin(), scan.addresses.end(), kNfcAddress) == scan.addresses.end()) {
            scan.addresses.push_back(kNfcAddress);
        }
        std::sort(scan.addresses.begin(), scan.addresses.end());

        scan.foundLtr553 = std::find(scan.addresses.begin(), scan.addresses.end(), kLtr553Address) != scan.addresses.end();
        scan.foundIna226 = std::find(scan.addresses.begin(), scan.addresses.end(), kIna226Address) != scan.addresses.end();
        scan.foundNfc = std::find(scan.addresses.begin(), scan.addresses.end(), kNfcAddress) != scan.addresses.end();
    }

    std::lock_guard<std::mutex> lock(snapshot_mutex);
    auto& scans = snapshot.i2cScans;
    scans.erase(std::remove_if(scans.begin(), scans.end(),
                               [&scan](const LocalI2cScanStageSnapshot& item) { return item.stage == scan.stage; }),
                scans.end());
    scans.push_back(scan);
    if (scans.size() > kMaxI2cScanStages) {
        scans.erase(scans.begin(), scans.begin() + static_cast<long>(scans.size() - kMaxI2cScanStages));
    }

    std::string address_log;
    for (const auto address : scan.addresses) {
        char chunk[8];
        snprintf(chunk, sizeof(chunk), "%s0x%02x", address_log.empty() ? "" : " ", address);
        address_log += chunk;
    }
    mclog::tagInfo(_tag, "i2c scan {}: {}", scan.stage, address_log.empty() ? "none" : address_log);
}
