/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include "bmi270.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <cmath>
#include <cstring>

static const char* TAG = "BMI270";

namespace {
constexpr uint8_t kBmm150Address = 0x10;
constexpr uint8_t kBmm150ChipId = 0x32;
constexpr float kBmm150MagResolution = 10.0f * 4912.0f / 32760.0f;

constexpr uint8_t CHIP_ID_ADDR = 0x00;
constexpr uint8_t STATUS_ADDR = 0x03;
constexpr uint8_t AUX_X_LSB_ADDR = 0x04;
constexpr uint8_t AUX_DEV_ID_ADDR = 0x4B;
constexpr uint8_t AUX_IF_CONF_ADDR = 0x4C;
constexpr uint8_t AUX_RD_ADDR = 0x4D;
constexpr uint8_t AUX_WR_ADDR = 0x4E;
constexpr uint8_t AUX_WR_DATA_ADDR = 0x4F;
constexpr uint8_t IF_CONF_ADDR = 0x6B;
constexpr uint8_t PWR_CONF_ADDR = 0x7C;
constexpr uint8_t PWR_CTRL_ADDR = 0x7D;

constexpr uint8_t BMM150_CHIP_ID = 0x40;
constexpr uint8_t BMM150_DATA_X_LSB = 0x42;
constexpr uint8_t BMM150_POWER_CONTROL = 0x4B;
constexpr uint8_t BMM150_OP_MODE = 0x4C;
}  // namespace

BMI270::BMI270(i2c_master_bus_handle_t i2c_bus_handle, uint8_t addr) : _addr(addr), _initialized(false)
{
    i2c_device_config_t dev_cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address  = _addr,
        .scl_speed_hz    = 400000,
    };
    ESP_ERROR_CHECK(i2c_master_bus_add_device(i2c_bus_handle, &dev_cfg, &_i2c_dev));

    _bmi.intf            = BMI2_I2C_INTF;
    _bmi.read            = bmi2_i2c_read;
    _bmi.write           = bmi2_i2c_write;
    _bmi.delay_us        = bmi2_delay_us;
    _bmi.read_write_len  = 32;         // Max read/write length
    _bmi.config_file_ptr = NULL;       // Use default config
    _bmi.intf_ptr        = &_i2c_dev;  // Pass the device handle as interface pointer
}

BMI270::~BMI270()
{
    if (_i2c_dev) {
        i2c_master_bus_rm_device(_i2c_dev);
    }
}

BMI2_INTF_RETURN_TYPE BMI270::bmi2_i2c_read(uint8_t reg_addr, uint8_t* reg_data, uint32_t len, void* intf_ptr)
{
    i2c_master_dev_handle_t dev = *(i2c_master_dev_handle_t*)intf_ptr;
    esp_err_t err               = i2c_master_transmit_receive(dev, &reg_addr, 1, reg_data, len, 1000);
    return (err == ESP_OK) ? BMI2_OK : BMI2_E_COM_FAIL;
}

BMI2_INTF_RETURN_TYPE BMI270::bmi2_i2c_write(uint8_t reg_addr, const uint8_t* reg_data, uint32_t len, void* intf_ptr)
{
    i2c_master_dev_handle_t dev = *(i2c_master_dev_handle_t*)intf_ptr;

    uint8_t* buf = (uint8_t*)malloc(len + 1);
    if (!buf) return BMI2_E_COM_FAIL;

    buf[0] = reg_addr;
    memcpy(buf + 1, reg_data, len);

    esp_err_t err = i2c_master_transmit(dev, buf, len + 1, 1000);
    free(buf);

    return (err == ESP_OK) ? BMI2_OK : BMI2_E_COM_FAIL;
}

bool BMI270::readRegister(uint8_t reg_addr, uint8_t* reg_data, uint32_t len) const
{
    return bmi2_i2c_read(reg_addr, reg_data, len, const_cast<i2c_master_dev_handle_t*>(&_i2c_dev)) == BMI2_OK;
}

uint8_t BMI270::readRegister8(uint8_t reg_addr) const
{
    uint8_t value = 0;
    readRegister(reg_addr, &value, 1);
    return value;
}

bool BMI270::writeRegister8(uint8_t reg_addr, uint8_t value)
{
    return bmi2_i2c_write(reg_addr, &value, 1, &_i2c_dev) == BMI2_OK;
}

bool BMI270::waitAuxReady() const
{
    for (int retry = 0; retry < 10; ++retry) {
        if ((readRegister8(STATUS_ADDR) & 0x04) == 0) {
            return true;
        }
        vTaskDelay(pdMS_TO_TICKS(1));
    }
    return false;
}

bool BMI270::auxSetupMode(uint8_t i2c_addr)
{
    return writeRegister8(IF_CONF_ADDR, 0x20) &&
           writeRegister8(PWR_CONF_ADDR, 0x00) &&
           writeRegister8(PWR_CTRL_ADDR, 0x0E) &&
           writeRegister8(AUX_IF_CONF_ADDR, 0x80) &&
           writeRegister8(AUX_DEV_ID_ADDR, i2c_addr << 1);
}

bool BMI270::auxWriteRegister8(uint8_t reg_addr, uint8_t value)
{
    if (!writeRegister8(AUX_WR_DATA_ADDR, value) || !writeRegister8(AUX_WR_ADDR, reg_addr)) {
        return false;
    }
    return waitAuxReady();
}

bool BMI270::auxReadRegister8(uint8_t reg_addr, uint8_t& value)
{
    if (!writeRegister8(AUX_IF_CONF_ADDR, 0x80) || !writeRegister8(AUX_RD_ADDR, reg_addr) || !waitAuxReady()) {
        return false;
    }
    value = readRegister8(AUX_X_LSB_ADDR);
    return true;
}

bool BMI270::setupBmm150Aux()
{
    if (!auxSetupMode(kBmm150Address)) {
        return false;
    }

    auxWriteRegister8(BMM150_POWER_CONTROL, 0x83);
    vTaskDelay(pdMS_TO_TICKS(4));

    uint8_t chip_id = 0;
    auxReadRegister8(BMM150_CHIP_ID, chip_id);
    if (!auxReadRegister8(BMM150_CHIP_ID, chip_id) || chip_id != kBmm150ChipId) {
        ESP_LOGW(TAG, "BMM150 not detected through BMI270 AUX: 0x%02x", chip_id);
        return false;
    }

    if (!auxWriteRegister8(BMM150_OP_MODE, 0x38)) {
        return false;
    }
    if (!writeRegister8(AUX_IF_CONF_ADDR, 0x4F) ||
        !writeRegister8(AUX_RD_ADDR, BMM150_DATA_X_LSB) ||
        !writeRegister8(PWR_CTRL_ADDR, 0x0F)) {
        return false;
    }

    ESP_LOGI(TAG, "BMM150 init ok through BMI270 AUX");
    return true;
}

void BMI270::updateBmm150()
{
    _data.mag_updated = false;
    if (!_data.mag_available) {
        return;
    }

    int16_t buffer[10] = {};
    if (!readRegister(AUX_X_LSB_ADDR, reinterpret_cast<uint8_t*>(buffer), sizeof(buffer))) {
        return;
    }

    _data.mag_raw_x = static_cast<int16_t>(buffer[0] >> 2);
    _data.mag_raw_y = static_cast<int16_t>(buffer[1] >> 2);
    _data.mag_raw_z = static_cast<int16_t>(buffer[2] & 0xFFFE);
    _data.mag_x = static_cast<float>(_data.mag_raw_x) * kBmm150MagResolution;
    _data.mag_y = static_cast<float>(_data.mag_raw_y) * kBmm150MagResolution;
    _data.mag_z = static_cast<float>(_data.mag_raw_z) * kBmm150MagResolution;
    _data.mag_updated = true;
}

#define NOP() asm volatile("nop")

void BMI270::bmi2_delay_us(uint32_t period, void* intf_ptr)
{
    uint64_t m = (uint64_t)esp_timer_get_time();
    if (period) {
        uint64_t e = (m + period);
        if (m > e) {  // overflow
            while ((uint64_t)esp_timer_get_time() > e) {
                NOP();
            }
        }
        while ((uint64_t)esp_timer_get_time() < e) {
            NOP();
        }
    }
}

bool BMI270::begin()
{
    int8_t rslt;

    // Initialize bmi270
    rslt = bmi270_init(&_bmi);
    if (rslt != BMI2_OK) {
        ESP_LOGE(TAG, "bmi270_init failed: %d", rslt);
        return false;
    }

    // Configure Accel
    struct bmi2_sens_config config;
    config.type = BMI2_ACCEL;
    rslt        = bmi2_get_sensor_config(&config, 1, &_bmi);
    if (rslt == BMI2_OK) {
        config.cfg.acc.odr         = BMI2_ACC_ODR_100HZ;
        config.cfg.acc.range       = BMI2_ACC_RANGE_2G;
        config.cfg.acc.bwp         = BMI2_ACC_NORMAL_AVG4;
        config.cfg.acc.filter_perf = BMI2_PERF_OPT_MODE;
        rslt                       = bmi2_set_sensor_config(&config, 1, &_bmi);
    }
    if (rslt != BMI2_OK) {
        ESP_LOGE(TAG, "Accel config failed: %d", rslt);
        return false;
    }

    // Configure Gyro
    config.type = BMI2_GYRO;
    rslt        = bmi2_get_sensor_config(&config, 1, &_bmi);
    if (rslt == BMI2_OK) {
        config.cfg.gyr.odr         = BMI2_GYR_ODR_100HZ;
        config.cfg.gyr.range       = BMI2_GYR_RANGE_2000;
        config.cfg.gyr.bwp         = BMI2_GYR_NORMAL_MODE;
        config.cfg.gyr.filter_perf = BMI2_PERF_OPT_MODE;
        config.cfg.gyr.noise_perf  = BMI2_PERF_OPT_MODE;
        rslt                       = bmi2_set_sensor_config(&config, 1, &_bmi);
    }
    if (rslt != BMI2_OK) {
        ESP_LOGE(TAG, "Gyro config failed: %d", rslt);
        return false;
    }

    // Enable sensors
    uint8_t sensor_list[2] = {BMI2_ACCEL, BMI2_GYRO};
    rslt                   = bmi2_sensor_enable(sensor_list, 2, &_bmi);
    if (rslt != BMI2_OK) {
        ESP_LOGE(TAG, "Sensor enable failed: %d", rslt);
        return false;
    }

    _data.mag_available = setupBmm150Aux();
    _data.mag_updated = false;

    _initialized = true;
    return true;
}

bool BMI270::update()
{
    if (!_initialized) return false;

    struct bmi2_sens_data sens_data = {{0}};
    int8_t rslt                     = bmi2_get_sensor_data(&sens_data, &_bmi);

    if (rslt == BMI2_OK) {
        // Convert Accel
        // Assuming 2G range and 16-bit resolution as configured
        _data.accel_x = lsb_to_mps2(sens_data.acc.x, 2.0f, 16);
        _data.accel_y = lsb_to_mps2(sens_data.acc.y, 2.0f, 16);
        _data.accel_z = lsb_to_mps2(sens_data.acc.z, 2.0f, 16);

        // Convert Gyro
        // Assuming 2000dps range and 16-bit resolution
        _data.gyro_x = lsb_to_dps(sens_data.gyr.x, 2000.0f, 16);
        _data.gyro_y = lsb_to_dps(sens_data.gyr.y, 2000.0f, 16);
        _data.gyro_z = lsb_to_dps(sens_data.gyr.z, 2000.0f, 16);

        updateBmm150();

        return true;
    }
    return false;
}

void BMI270::getAccelerometer(float& x, float& y, float& z)
{
    x = _data.accel_x;
    y = _data.accel_y;
    z = _data.accel_z;
}

void BMI270::getGyroscope(float& x, float& y, float& z)
{
    x = _data.gyro_x;
    y = _data.gyro_y;
    z = _data.gyro_z;
}

const BMI270_Data& BMI270::getData()
{
    return _data;
}

float BMI270::lsb_to_mps2(int16_t val, float g_range, uint8_t bit_width)
{
    float half_scale = (float)(1 << (bit_width - 1));
    return (9.80665f * val * g_range) / half_scale;
}

float BMI270::lsb_to_dps(int16_t val, float dps, uint8_t bit_width)
{
    float half_scale = (float)(1 << (bit_width - 1));
    return (dps * val) / half_scale;
}
