/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once

#include <cstddef>
#include <cstdint>
#include <driver/i2c_master.h>
#include <esp_err.h>

namespace stackchan::hal::sensors {

bool probe_i2c(i2c_master_bus_handle_t bus, uint8_t address);
esp_err_t add_i2c_device(i2c_master_bus_handle_t bus, uint8_t address, uint32_t speed_hz,
                         i2c_master_dev_handle_t* out_dev);
esp_err_t write_reg(i2c_master_dev_handle_t dev, uint8_t reg, uint8_t value);
esp_err_t read_regs(i2c_master_dev_handle_t dev, uint8_t reg, uint8_t* data, size_t len);
bool diagnostic_read_reg(i2c_master_bus_handle_t bus, uint8_t address, uint8_t reg, uint8_t* data, size_t len);
bool diagnostic_write_ping(i2c_master_bus_handle_t bus, uint8_t address, uint8_t value);
uint16_t read_be_u16(const uint8_t data[2]);
int16_t read_be_i16(const uint8_t data[2]);

}  // namespace stackchan::hal::sensors
