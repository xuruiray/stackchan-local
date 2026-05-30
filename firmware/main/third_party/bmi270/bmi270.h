/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once

#include <cstdint>
#include "driver/i2c_master.h"
#include "esp_err.h"
#include "BMI270_SensorAPI/bmi270.h"

struct BMI270_Data {
    float accel_x;
    float accel_y;
    float accel_z;
    float gyro_x;
    float gyro_y;
    float gyro_z;
    bool mag_available;
    bool mag_updated;
    float mag_x;
    float mag_y;
    float mag_z;
    int16_t mag_raw_x;
    int16_t mag_raw_y;
    int16_t mag_raw_z;
};

struct BMM150_TrimData {
    int8_t dig_x1 = 0;
    int8_t dig_y1 = 0;
    int8_t dig_x2 = 0;
    int8_t dig_y2 = 0;
    uint16_t dig_z1 = 0;
    int16_t dig_z2 = 0;
    int16_t dig_z3 = 0;
    int16_t dig_z4 = 0;
    uint8_t dig_xy1 = 0;
    int8_t dig_xy2 = 0;
    uint16_t dig_xyz1 = 0;
};

class BMI270 {
public:
    static constexpr uint8_t DEFAULT_ADDRESS = BMI2_I2C_PRIM_ADDR;  // 0x68

    BMI270(i2c_master_bus_handle_t i2c_bus_handle, uint8_t addr = DEFAULT_ADDRESS);
    ~BMI270();

    /**
     * @brief Initialize the device
     *
     * @return true if successful
     * @return false if failed
     */
    bool begin();

    /**
     * @brief Read sensor data
     *
     * @return true if successful
     * @return false if failed
     */
    bool update();

    void getAccelerometer(float& x, float& y, float& z);
    void getGyroscope(float& x, float& y, float& z);
    const BMI270_Data& getData();

private:
    i2c_master_dev_handle_t _i2c_dev;
    struct bmi2_dev _bmi;
    uint8_t _addr;
    bool _initialized;
    bool _bmm150_trim_ready = false;
    BMM150_TrimData _bmm150_trim;
    BMI270_Data _data;

    static BMI2_INTF_RETURN_TYPE bmi2_i2c_read(uint8_t reg_addr, uint8_t* reg_data, uint32_t len, void* intf_ptr);
    static BMI2_INTF_RETURN_TYPE bmi2_i2c_write(uint8_t reg_addr, const uint8_t* reg_data, uint32_t len,
                                                void* intf_ptr);
    static void bmi2_delay_us(uint32_t period, void* intf_ptr);

    bool readRegister(uint8_t reg_addr, uint8_t* reg_data, uint32_t len) const;
    uint8_t readRegister8(uint8_t reg_addr) const;
    bool writeRegister8(uint8_t reg_addr, uint8_t value);
    bool waitAuxReady() const;
    bool auxSetupMode(uint8_t i2c_addr);
    bool auxWriteRegister8(uint8_t reg_addr, uint8_t value);
    bool auxReadRegister8(uint8_t reg_addr, uint8_t& value);
    bool auxReadRegisters(uint8_t reg_addr, uint8_t* reg_data, uint8_t len);
    bool setupBmm150Aux();
    bool readBmm150TrimRegisters();
    bool configureBmm150RegularPreset();
    void updateBmm150();

    float lsb_to_mps2(int16_t val, float g_range, uint8_t bit_width);
    float lsb_to_dps(int16_t val, float dps, uint8_t bit_width);
};
