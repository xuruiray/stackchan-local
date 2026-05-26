/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include "nfc_probe.h"

#include <hardware/bus/i2c_bus.h>

#include <cstdio>
#include <freertos/FreeRTOS.h>

namespace stackchan::hal::sensors {
namespace {

constexpr uint8_t ST25R3916_REG_IC_IDENTITY = 0x3F;
constexpr uint8_t ST25R3916_OP_READ_REGISTER = 0x40;
constexpr uint8_t ST25R3916_VALID_IDENTIFY_TYPE = 0x05;

bool read_st25r3916_identity(i2c_master_bus_handle_t bus, uint8_t address, uint8_t& value, std::string& reason)
{
    if (!bus) {
        reason = "i2c_bus_unavailable";
        return false;
    }

    i2c_master_dev_handle_t dev = nullptr;
    if (add_i2c_device(bus, address, 400000, &dev) != ESP_OK || !dev) {
        reason = "i2c_add_device_failed";
        return false;
    }

    const uint8_t reg = ST25R3916_OP_READ_REGISTER | ST25R3916_REG_IC_IDENTITY;
    I2cBusGuard guard;
    const esp_err_t err = i2c_master_transmit_receive(dev, &reg, 1, &value, 1, 100);
    i2c_master_bus_rm_device(dev);
    if (err != ESP_OK) {
        reason = "identity_read_failed_i2c_0x50";
        return false;
    }

    const uint8_t type = static_cast<uint8_t>((value >> 3) & 0x1F);
    const uint8_t revision = static_cast<uint8_t>(value & 0x07);
    if (type != ST25R3916_VALID_IDENTIFY_TYPE || revision == 0) {
        char buffer[40];
        std::snprintf(buffer, sizeof(buffer), "unexpected_identity_0x%02x", value);
        reason = buffer;
        return false;
    }

    reason.clear();
    return true;
}

}  // namespace

void NfcProbe::init(LocalPeripheralProbeSnapshot& snapshot)
{
    snapshot.nfcDriver = "st25r3916-probe";
    snapshot.nfcAddress = kAddress;
    snapshot.nfcReason = "not_detected_i2c_0x50";

    if (!bus_) {
        snapshot.nfcAvailable = false;
        snapshot.nfcStatus.clear();
        snapshot.nfcReason = "i2c_bus_unavailable";
        return;
    }

    if (!probe_i2c_with_retry(bus_, kAddress, 3, 40)) {
        snapshot.nfcAvailable = false;
        snapshot.nfcStatus.clear();
        snapshot.nfcReason = "not_detected_i2c_0x50_after_retry";
        return;
    }

    uint8_t identity = 0;
    std::string reason;
    snapshot.nfcAvailable = read_st25r3916_identity(bus_, kAddress, identity, reason);
    if (snapshot.nfcAvailable) {
        snapshot.nfcStatus = "chip_detected";
        snapshot.nfcReason.clear();
    } else {
        snapshot.nfcStatus.clear();
        snapshot.nfcReason = reason.empty() ? "not_detected_i2c_0x50" : reason;
    }
}

}  // namespace stackchan::hal::sensors
