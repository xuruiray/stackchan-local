/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include <hardware/sensors/imu_sensor.h>
#include <system/device_runtime.h>
#include <hardware/registry.h>
#include <third_party/bmi270/bmi270.h>
#include <services/sensors/motion_detector/motion_detector.h>
#include <mooncake_log.h>
#include <cmath>
#include <memory>
#include <mutex>

static const std::string_view _tag = "IMU";
static constexpr float kPi = 3.14159265358979323846f;

static std::unique_ptr<BMI270> _bmi270;
static std::mutex _imu_snapshot_mutex;
static LocalImuSnapshot _imu_snapshot;

static void _imu_task(void* param)
{
    auto motion_detector = std::make_unique<MotionDetector>();
    motion_detector->setShakeThreshold(16.0f);

    while (1) {
        if (_bmi270 && _bmi270->update()) {
            auto& data = _bmi270->getData();
            // mclog::debug("IMU Accel: {:.2f}\t{:.2f}\t{:.2f}", data.accel_x, data.accel_y, data.accel_z);

            motion_detector->update(data.accel_x, data.accel_y, data.accel_z);

            ImuMotionEvent motion = ImuMotionEvent::None;
            if (motion_detector->isShakeDetected()) {
                mclog::tagInfo(_tag, "Shake Detected!");
                motion = ImuMotionEvent::Shake;
                GetDeviceRuntime().onImuMotionEvent.emit(ImuMotionEvent::Shake);
            }
            {
                std::lock_guard<std::mutex> lock(_imu_snapshot_mutex);
                _imu_snapshot.available = true;
                _imu_snapshot.x         = data.accel_x;
                _imu_snapshot.y         = data.accel_y;
                _imu_snapshot.z         = data.accel_z;
                _imu_snapshot.gyroX     = data.gyro_x;
                _imu_snapshot.gyroY     = data.gyro_y;
                _imu_snapshot.gyroZ     = data.gyro_z;
                _imu_snapshot.magnetometerAvailable = data.mag_available;
                if (data.mag_available && data.mag_updated) {
                    _imu_snapshot.magnetometerX = data.mag_x;
                    _imu_snapshot.magnetometerY = data.mag_y;
                    _imu_snapshot.magnetometerZ = data.mag_z;
                    _imu_snapshot.magnetometerRawX = data.mag_raw_x;
                    _imu_snapshot.magnetometerRawY = data.mag_raw_y;
                    _imu_snapshot.magnetometerRawZ = data.mag_raw_z;
                    float heading = std::atan2(data.mag_y, data.mag_x) * 180.0f / kPi;
                    if (heading < 0.0f) {
                        heading += 360.0f;
                    }
                    _imu_snapshot.magnetometerHeadingDeg = heading;
                }
                _imu_snapshot.motion    = motion;
                _imu_snapshot.updatedAt = GetDeviceRuntime().millis();
            }
            // if (motion_detector->isPickUpDetected()) {
            //     mclog::tagInfo(_tag, "Pick Up Detected!");
            //     GetDeviceRuntime().onImuMotionEvent.emit(ImuMotionEvent::PickUp);
            // }
        }
        vTaskDelay(pdMS_TO_TICKS(100));
    }
}

void DeviceRuntime::imu_init()
{
    mclog::tagInfo(_tag, "init");

    auto i2c_bus = stackchan::hal::hardware::GetHardwareRegistry().i2c_bus();

    _bmi270 = std::make_unique<BMI270>(i2c_bus, 0x69);
    if (!_bmi270->begin()) {
        _bmi270.reset();
        mclog::tagError(_tag, "BMI270 init failed");
        return;
    }
    mclog::tagInfo(_tag, "BMI270 init ok");

    // xTaskCreateWithCaps(_imu_task, "imu", 4096, NULL, 2, NULL, MALLOC_CAP_SPIRAM);
    xTaskCreatePinnedToCoreWithCaps(_imu_task, "imu", 4096, NULL, 2, NULL, 1, MALLOC_CAP_SPIRAM);
}

LocalImuSnapshot DeviceRuntime::getLocalImuSnapshot()
{
    std::lock_guard<std::mutex> lock(_imu_snapshot_mutex);
    return _imu_snapshot;
}
