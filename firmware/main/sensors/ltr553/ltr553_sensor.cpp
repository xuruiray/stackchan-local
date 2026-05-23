/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include "ltr553_sensor.h"

#include <hardware/i2c/i2c_bus.h>

#include <algorithm>
#include <mooncake_log.h>

namespace stackchan::hal::sensors {
namespace {

static const std::string_view kTag = "LTR553";

constexpr uint8_t LTR553_ALS_CONTR = 0x80;
constexpr uint8_t LTR553_PS_CONTR = 0x81;
constexpr uint8_t LTR553_PS_LED = 0x82;
constexpr uint8_t LTR553_PS_N_PULSES = 0x83;
constexpr uint8_t LTR553_PS_MEAS_RATE = 0x84;
constexpr uint8_t LTR553_ALS_MEAS_RATE = 0x85;
constexpr uint8_t LTR553_MANUFACTURER_ID = 0x87;
constexpr uint8_t LTR553_ALS_DATA_CH1_0 = 0x88;
constexpr uint8_t LTR553_PS_DATA_0 = 0x8D;

}  // namespace

void Ltr553::init(LocalPeripheralProbeSnapshot& snapshot)
{
    snapshot.proximityDriver = "ltr553";
    snapshot.ambientLightDriver = "ltr553";
    snapshot.proximityReason = "not_detected_i2c_0x23";
    snapshot.ambientLightReason = "not_detected_i2c_0x23";

    if (!probe_i2c(bus_, kAddress)) {
        return;
    }

    if (add_i2c_device(bus_, kAddress, 100000, &dev_) != ESP_OK) {
        snapshot.proximityReason = "i2c_add_device_failed";
        snapshot.ambientLightReason = "i2c_add_device_failed";
        return;
    }

    uint8_t part_id = 0;
    uint8_t manufacturer_id = 0;
    read_regs(dev_, kPartIdRegister, &part_id, 1);
    read_regs(dev_, LTR553_MANUFACTURER_ID, &manufacturer_id, 1);

    write_reg(dev_, LTR553_PS_CONTR, 0x00);
    write_reg(dev_, LTR553_ALS_CONTR, 0x00);
    write_reg(dev_, LTR553_PS_LED, 0x3C);
    write_reg(dev_, LTR553_PS_MEAS_RATE, 0x00);
    write_reg(dev_, LTR553_PS_N_PULSES, 0x01);
    write_reg(dev_, LTR553_ALS_MEAS_RATE, 0x03);
    write_reg(dev_, LTR553_ALS_CONTR, 0x19);
    write_reg(dev_, LTR553_PS_CONTR, 0x02);
    snapshot.proximityAvailable = true;
    snapshot.ambientLightAvailable = true;
    snapshot.proximityReason.clear();
    snapshot.ambientLightReason.clear();
    mclog::tagInfo(kTag, "detected part=0x%02x manufacturer=0x%02x", part_id, manufacturer_id);
}

void Ltr553::refresh(LocalPeripheralProbeSnapshot& snapshot)
{
    if (!dev_ || (!snapshot.proximityAvailable && !snapshot.ambientLightAvailable)) {
        return;
    }

    uint8_t data[7] = {};
    if (read_regs(dev_, LTR553_ALS_DATA_CH1_0, data, sizeof(data)) != ESP_OK) {
        snapshot.proximityAvailable = false;
        snapshot.ambientLightAvailable = false;
        snapshot.proximityReason = "read_failed";
        snapshot.ambientLightReason = "read_failed";
        return;
    }

    const uint16_t als_ch1 = static_cast<uint16_t>(data[0] | (data[1] << 8));
    const uint16_t als_ch0 = static_cast<uint16_t>(data[2] | (data[3] << 8));
    uint8_t ps_data[2] = {};
    if (read_regs(dev_, LTR553_PS_DATA_0, ps_data, sizeof(ps_data)) == ESP_OK) {
        snapshot.proximityRaw = static_cast<uint16_t>((ps_data[1] & 0x07) << 8 | ps_data[0]);
        snapshot.proximityValue = snapshot.proximityRaw;
    }

    const uint32_t total = static_cast<uint32_t>(als_ch0) + als_ch1;
    snapshot.ambientLightRaw = total >> 1;
    if (total == 0) {
        snapshot.ambientLightLux = 0.0f;
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
    snapshot.ambientLightLux = std::max(0.0f, lux / 48.0f);
}

}  // namespace stackchan::hal::sensors
