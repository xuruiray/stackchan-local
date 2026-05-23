/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include <hardware/pmic/axp2101_power.h>

#include <esp_log.h>

namespace stackchan::hal::hardware {
namespace {
constexpr const char* kTag = "StackChanPmic";
constexpr uint8_t kChargeCurrentRegister = 0x62;

enum ChargeCurrent {
    kChargeCurrent0mA = 0,
    kChargeCurrent100mA = 4,
    kChargeCurrent125mA,
    kChargeCurrent150mA,
    kChargeCurrent175mA,
    kChargeCurrent200mA,
    kChargeCurrent300mA,
    kChargeCurrent400mA,
    kChargeCurrent500mA,
    kChargeCurrent600mA,
    kChargeCurrent700mA,
    kChargeCurrent800mA,
    kChargeCurrent900mA,
    kChargeCurrent1000mA,
};
}  // namespace

StackChanPmic::StackChanPmic(i2c_master_bus_handle_t i2c_bus, uint8_t addr) : Axp2101(i2c_bus, addr)
{
    uint8_t data = ReadReg(0x90);
    data |= 0b10110100;
    WriteReg(0x90, data);
    WriteReg(0x97, (0b11110 - 2));
    WriteReg(0x69, 0b00110101);
    WriteReg(0x30, 0b111111);
    WriteReg(0x90, 0xBF);
    WriteReg(0x94, 33 - 5);
    WriteReg(0x95, 33 - 5);
    WriteReg(0x27, 0x00);

    if (!set_charger_constant_current(kChargeCurrent700mA)) {
        ESP_LOGE(kTag, "set charge current failed");
    } else {
        ESP_LOGI(kTag, "set charge current success");
    }

    SetBrightness(0);
}

void StackChanPmic::SetBrightness(uint8_t brightness)
{
    if (brightness == 0) {
        uint8_t val = ReadReg(0x90);
        WriteReg(0x90, val & 0x7F);
        return;
    }

    if (brightness > 100) {
        brightness = 100;
    }
    uint8_t reg_val = 20 + ((uint16_t)brightness * 8 / 100);
    WriteReg(0x99, reg_val);

    uint8_t val = ReadReg(0x90);
    if (!(val & 0x80)) {
        WriteReg(0x90, val | 0x80);
    }
}

bool StackChanPmic::IsExternalPowerConnected()
{
    const uint8_t power_status      = ReadReg(0x01);
    const uint8_t current_direction = (power_status & 0b01100000) >> 5;
    const bool is_charging_done     = (power_status & 0b00000111) == 0b00000100;
    return current_direction != 2 || is_charging_done;
}

bool StackChanPmic::set_charger_constant_current(uint8_t option)
{
    if (option > kChargeCurrent1000mA) {
        return false;
    }
    int val = ReadReg(kChargeCurrentRegister);
    if (val == -1) {
        return false;
    }
    val &= 0xE0;
    WriteReg(kChargeCurrentRegister, val | option);
    return true;
}

StackChanBacklight::StackChanBacklight(StackChanPmic* pmic) : pmic_(pmic)
{
}

void StackChanBacklight::SetBrightnessImpl(uint8_t brightness)
{
    (void)brightness;
    pmic_->SetBrightness(target_brightness_);
    brightness_ = target_brightness_;
}

}  // namespace stackchan::hal::hardware
