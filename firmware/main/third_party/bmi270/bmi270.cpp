/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include "bmi270.h"
#include <hardware/bus/i2c_bus.h>
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <cmath>
#include <cstring>

static const char* TAG = "BMI270";

namespace {
constexpr uint8_t kBmm150Address = 0x10;
constexpr uint8_t kBmm150ChipId = 0x32;

constexpr uint8_t STATUS_ADDR = 0x03;
constexpr uint8_t AUX_X_LSB_ADDR = 0x04;
constexpr uint8_t AUX_CONF_ADDR = 0x44;
constexpr uint8_t AUX_DEV_ID_ADDR = 0x4B;
constexpr uint8_t AUX_IF_CONF_ADDR = 0x4C;
constexpr uint8_t AUX_RD_ADDR = 0x4D;
constexpr uint8_t AUX_WR_ADDR = 0x4E;
constexpr uint8_t AUX_WR_DATA_ADDR = 0x4F;
constexpr uint8_t AUX_IF_TRIM_ADDR = 0x68;
constexpr uint8_t IF_CONF_ADDR = 0x6B;
constexpr uint8_t PWR_CONF_ADDR = 0x7C;
constexpr uint8_t PWR_CTRL_ADDR = 0x7D;

constexpr uint8_t BMM150_CHIP_ID = 0x40;
constexpr uint8_t BMM150_DATA_X_LSB = 0x42;
constexpr uint8_t BMM150_POWER_CONTROL = 0x4B;
constexpr uint8_t BMM150_OP_MODE = 0x4C;
constexpr uint8_t BMM150_AXES_ENABLE = 0x4E;
constexpr uint8_t BMM150_REP_XY = 0x51;
constexpr uint8_t BMM150_REP_Z = 0x52;
constexpr uint8_t BMM150_DIG_X1 = 0x5D;
constexpr uint8_t BMM150_DIG_Z4_LSB = 0x62;
constexpr uint8_t BMM150_DIG_Z2_LSB = 0x68;

constexpr uint8_t BMI2_AUX_ODR_100HZ_VALUE = 0x08;
constexpr uint8_t BMI2_ASDA_PUPSEL_10K_VALUE = 0x02;
constexpr uint8_t BMI2_AUX_AUTO_READ_8_BYTES = 0x4F;

constexpr uint8_t BMM150_ODR_MASK = 0x38;
constexpr uint8_t BMM150_ODR_POS = 3;
constexpr uint8_t BMM150_OP_MODE_MASK = 0x06;
constexpr uint8_t BMM150_OP_MODE_POS = 1;
constexpr uint8_t BMM150_DATA_RATE_10HZ = 0x00;
constexpr uint8_t BMM150_POWERMODE_NORMAL = 0x00;
constexpr uint8_t BMM150_REPXY_REGULAR = 0x04;
constexpr uint8_t BMM150_REPZ_REGULAR = 0x07;
constexpr uint8_t BMM150_XYZ_CHANNEL_ENABLE = 0x00;

constexpr int16_t BMM150_OVERFLOW_ADCVAL_XYAXES_FLIP = -4096;
constexpr int16_t BMM150_OVERFLOW_ADCVAL_ZAXIS_HALL = -16384;

struct Bmm150RawData {
    int16_t x = 0;
    int16_t y = 0;
    int16_t z = 0;
    uint16_t rhall = 0;
};

int16_t combine_i16(uint8_t lsb, uint8_t msb)
{
    return static_cast<int16_t>(static_cast<uint16_t>(lsb) | (static_cast<uint16_t>(msb) << 8));
}

int16_t parse_bmm150_signed_axis(uint8_t lsb, uint8_t msb, uint8_t lsb_mask, uint8_t lsb_shift,
                                 int16_t msb_multiplier)
{
    const uint8_t low_bits = static_cast<uint8_t>((lsb & lsb_mask) >> lsb_shift);
    const int16_t high_bits = static_cast<int16_t>(static_cast<int8_t>(msb)) * msb_multiplier;
    return static_cast<int16_t>(high_bits | low_bits);
}

Bmm150RawData parse_bmm150_aux_data(const uint8_t aux_data[8])
{
    Bmm150RawData raw;
    raw.x = parse_bmm150_signed_axis(aux_data[0], aux_data[1], 0xF8, 3, 32);
    raw.y = parse_bmm150_signed_axis(aux_data[2], aux_data[3], 0xF8, 3, 32);
    raw.z = parse_bmm150_signed_axis(aux_data[4], aux_data[5], 0xFE, 1, 128);
    raw.rhall = static_cast<uint16_t>((static_cast<uint16_t>(aux_data[7]) << 6) | ((aux_data[6] & 0xFC) >> 2));
    return raw;
}

float compensate_bmm150_x(int16_t mag_data_x, uint16_t rhall, const BMM150_TrimData& trim)
{
    if (mag_data_x == BMM150_OVERFLOW_ADCVAL_XYAXES_FLIP || rhall == 0 || trim.dig_xyz1 == 0) {
        return 0.0f;
    }

    const float process_comp_x0 = static_cast<float>(trim.dig_xyz1) * 16384.0f / static_cast<float>(rhall);
    const float retval = process_comp_x0 - 16384.0f;
    const float process_comp_x1 = static_cast<float>(trim.dig_xy2) * (retval * retval / 268435456.0f);
    const float process_comp_x2 = process_comp_x1 + retval * static_cast<float>(trim.dig_xy1) / 16384.0f;
    const float process_comp_x3 = static_cast<float>(trim.dig_x2) + 160.0f;
    const float process_comp_x4 = static_cast<float>(mag_data_x) * ((process_comp_x2 + 256.0f) * process_comp_x3);
    return ((process_comp_x4 / 8192.0f) + (static_cast<float>(trim.dig_x1) * 8.0f)) / 16.0f;
}

float compensate_bmm150_y(int16_t mag_data_y, uint16_t rhall, const BMM150_TrimData& trim)
{
    if (mag_data_y == BMM150_OVERFLOW_ADCVAL_XYAXES_FLIP || rhall == 0 || trim.dig_xyz1 == 0) {
        return 0.0f;
    }

    const float process_comp_y0 = static_cast<float>(trim.dig_xyz1) * 16384.0f / static_cast<float>(rhall);
    const float retval = process_comp_y0 - 16384.0f;
    const float process_comp_y1 = static_cast<float>(trim.dig_xy2) * (retval * retval / 268435456.0f);
    const float process_comp_y2 = process_comp_y1 + retval * static_cast<float>(trim.dig_xy1) / 16384.0f;
    const float process_comp_y3 = static_cast<float>(trim.dig_y2) + 160.0f;
    const float process_comp_y4 = static_cast<float>(mag_data_y) * ((process_comp_y2 + 256.0f) * process_comp_y3);
    return ((process_comp_y4 / 8192.0f) + (static_cast<float>(trim.dig_y1) * 8.0f)) / 16.0f;
}

float compensate_bmm150_z(int16_t mag_data_z, uint16_t rhall, const BMM150_TrimData& trim)
{
    if (mag_data_z == BMM150_OVERFLOW_ADCVAL_ZAXIS_HALL || trim.dig_z2 == 0 || trim.dig_z1 == 0 ||
        trim.dig_xyz1 == 0 || rhall == 0) {
        return 0.0f;
    }

    const float process_comp_z0 = static_cast<float>(mag_data_z) - static_cast<float>(trim.dig_z4);
    const float process_comp_z1 = static_cast<float>(rhall) - static_cast<float>(trim.dig_xyz1);
    const float process_comp_z2 = static_cast<float>(trim.dig_z3) * process_comp_z1;
    const float process_comp_z3 = static_cast<float>(trim.dig_z1) * static_cast<float>(rhall) / 32768.0f;
    const float process_comp_z4 = static_cast<float>(trim.dig_z2) + process_comp_z3;
    const float process_comp_z5 = (process_comp_z0 * 131072.0f) - process_comp_z2;
    return (process_comp_z5 / (process_comp_z4 * 4.0f)) / 16.0f;
}
}  // namespace

BMI270::BMI270(i2c_master_bus_handle_t i2c_bus_handle, uint8_t addr) : _addr(addr), _initialized(false), _data{}
{
    stackchan::hal::hardware::bus::I2cBusGuard guard;
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
        stackchan::hal::hardware::bus::I2cBusGuard guard;
        i2c_master_bus_rm_device(_i2c_dev);
    }
}

BMI2_INTF_RETURN_TYPE BMI270::bmi2_i2c_read(uint8_t reg_addr, uint8_t* reg_data, uint32_t len, void* intf_ptr)
{
    i2c_master_dev_handle_t dev = *(i2c_master_dev_handle_t*)intf_ptr;
    stackchan::hal::hardware::bus::I2cBusGuard guard;
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

    stackchan::hal::hardware::bus::I2cBusGuard guard;
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

bool BMI270::auxReadRegisters(uint8_t reg_addr, uint8_t* reg_data, uint8_t len)
{
    if (reg_data == nullptr) {
        return false;
    }

    for (uint8_t i = 0; i < len; ++i) {
        if (!auxReadRegister8(static_cast<uint8_t>(reg_addr + i), reg_data[i])) {
            return false;
        }
    }
    return true;
}

bool BMI270::readBmm150TrimRegisters()
{
    uint8_t trim_x1y1[2] = {};
    uint8_t trim_xyz_data[4] = {};
    uint8_t trim_xy1xy2[10] = {};

    if (!auxReadRegisters(BMM150_DIG_X1, trim_x1y1, sizeof(trim_x1y1)) ||
        !auxReadRegisters(BMM150_DIG_Z4_LSB, trim_xyz_data, sizeof(trim_xyz_data)) ||
        !auxReadRegisters(BMM150_DIG_Z2_LSB, trim_xy1xy2, sizeof(trim_xy1xy2))) {
        return false;
    }

    _bmm150_trim.dig_x1 = static_cast<int8_t>(trim_x1y1[0]);
    _bmm150_trim.dig_y1 = static_cast<int8_t>(trim_x1y1[1]);
    _bmm150_trim.dig_x2 = static_cast<int8_t>(trim_xyz_data[2]);
    _bmm150_trim.dig_y2 = static_cast<int8_t>(trim_xyz_data[3]);
    _bmm150_trim.dig_z1 = static_cast<uint16_t>((static_cast<uint16_t>(trim_xy1xy2[3]) << 8) | trim_xy1xy2[2]);
    _bmm150_trim.dig_z2 = combine_i16(trim_xy1xy2[0], trim_xy1xy2[1]);
    _bmm150_trim.dig_z3 = combine_i16(trim_xy1xy2[6], trim_xy1xy2[7]);
    _bmm150_trim.dig_z4 = combine_i16(trim_xyz_data[0], trim_xyz_data[1]);
    _bmm150_trim.dig_xy1 = trim_xy1xy2[9];
    _bmm150_trim.dig_xy2 = static_cast<int8_t>(trim_xy1xy2[8]);
    _bmm150_trim.dig_xyz1 =
        static_cast<uint16_t>((static_cast<uint16_t>(trim_xy1xy2[5] & 0x7F) << 8) | trim_xy1xy2[4]);

    _bmm150_trim_ready = _bmm150_trim.dig_xyz1 != 0 && _bmm150_trim.dig_z1 != 0 && _bmm150_trim.dig_z2 != 0;
    if (!_bmm150_trim_ready) {
        ESP_LOGW(TAG, "BMM150 trim data invalid");
    }
    return _bmm150_trim_ready;
}

bool BMI270::configureBmm150RegularPreset()
{
    uint8_t op_mode = 0;
    if (!auxReadRegister8(BMM150_OP_MODE, op_mode)) {
        return false;
    }

    op_mode = static_cast<uint8_t>((op_mode & ~BMM150_ODR_MASK) | (BMM150_DATA_RATE_10HZ << BMM150_ODR_POS));
    if (!auxWriteRegister8(BMM150_OP_MODE, op_mode) ||
        !auxWriteRegister8(BMM150_REP_XY, BMM150_REPXY_REGULAR) ||
        !auxWriteRegister8(BMM150_REP_Z, BMM150_REPZ_REGULAR) ||
        !auxWriteRegister8(BMM150_AXES_ENABLE, BMM150_XYZ_CHANNEL_ENABLE)) {
        return false;
    }

    op_mode = static_cast<uint8_t>((op_mode & ~BMM150_OP_MODE_MASK) |
                                   (BMM150_POWERMODE_NORMAL << BMM150_OP_MODE_POS));
    return auxWriteRegister8(BMM150_OP_MODE, op_mode);
}

bool BMI270::setupBmm150Aux()
{
    if (!auxSetupMode(kBmm150Address)) {
        return false;
    }

    if (!writeRegister8(AUX_IF_TRIM_ADDR, BMI2_ASDA_PUPSEL_10K_VALUE)) {
        return false;
    }

    if (!auxWriteRegister8(BMM150_POWER_CONTROL, 0x83)) {
        return false;
    }
    vTaskDelay(pdMS_TO_TICKS(4));

    uint8_t chip_id = 0;
    if (!auxReadRegister8(BMM150_CHIP_ID, chip_id) || chip_id != kBmm150ChipId) {
        ESP_LOGW(TAG, "BMM150 not detected through BMI270 AUX: 0x%02x", chip_id);
        return false;
    }

    if (!readBmm150TrimRegisters()) {
        return false;
    }

    if (!configureBmm150RegularPreset()) {
        return false;
    }

    if (!writeRegister8(AUX_CONF_ADDR, BMI2_AUX_ODR_100HZ_VALUE) ||
        !writeRegister8(AUX_IF_CONF_ADDR, BMI2_AUX_AUTO_READ_8_BYTES) ||
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

    if (!_bmm150_trim_ready) {
        return;
    }

    uint8_t aux_data[8] = {};
    if (!readRegister(AUX_X_LSB_ADDR, aux_data, sizeof(aux_data))) {
        return;
    }

    const auto raw = parse_bmm150_aux_data(aux_data);
    if (raw.x == BMM150_OVERFLOW_ADCVAL_XYAXES_FLIP || raw.y == BMM150_OVERFLOW_ADCVAL_XYAXES_FLIP ||
        raw.z == BMM150_OVERFLOW_ADCVAL_ZAXIS_HALL || raw.rhall == 0) {
        return;
    }

    const float mag_x = compensate_bmm150_x(raw.x, raw.rhall, _bmm150_trim);
    const float mag_y = compensate_bmm150_y(raw.y, raw.rhall, _bmm150_trim);
    const float mag_z = compensate_bmm150_z(raw.z, raw.rhall, _bmm150_trim);
    if (!std::isfinite(mag_x) || !std::isfinite(mag_y) || !std::isfinite(mag_z)) {
        return;
    }

    _data.mag_raw_x = raw.x;
    _data.mag_raw_y = raw.y;
    _data.mag_raw_z = raw.z;
    _data.mag_x = mag_x;
    _data.mag_y = mag_y;
    _data.mag_z = mag_z;
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
