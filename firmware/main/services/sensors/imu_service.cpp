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
static constexpr float kGravityMps2 = 9.80665f;
static constexpr int kGyroBiasSamples = 40;

static std::unique_ptr<BMI270> _bmi270;
static std::mutex _imu_snapshot_mutex;
static LocalImuSnapshot _imu_snapshot;

namespace {

struct BodyImuFrame {
    float accelX = 0.0f;
    float accelY = 0.0f;
    float accelZ = 0.0f;
    float gyroX = 0.0f;
    float gyroY = 0.0f;
    float gyroZ = 0.0f;
    float magX = 0.0f;
    float magY = 0.0f;
    float magZ = 0.0f;
    int16_t magRawX = 0;
    int16_t magRawY = 0;
    int16_t magRawZ = 0;
};

BodyImuFrame to_body_frame(const BMI270_Data& data)
{
    BodyImuFrame frame;

    // CoreS3 mounts the BMI270 with chip +Y close to StackChan's vertical axis.
    // Services and UI consume a body frame where +Z points upward.
    frame.accelX = data.accel_x;
    frame.accelY = data.accel_z;
    frame.accelZ = data.accel_y;
    frame.gyroX = data.gyro_x;
    frame.gyroY = data.gyro_z;
    frame.gyroZ = data.gyro_y;
    frame.magX = data.mag_x;
    frame.magY = data.mag_z;
    frame.magZ = data.mag_y;
    frame.magRawX = data.mag_raw_x;
    frame.magRawY = data.mag_raw_z;
    frame.magRawZ = data.mag_raw_y;
    return frame;
}

float vector_magnitude(float x, float y, float z)
{
    return std::sqrt(x * x + y * y + z * z);
}

class GyroBiasCalibrator {
public:
    void update(const BodyImuFrame& frame)
    {
        if (ready_) {
            return;
        }

        const float accel_norm = vector_magnitude(frame.accelX, frame.accelY, frame.accelZ);
        const float gyro_norm = vector_magnitude(frame.gyroX, frame.gyroY, frame.gyroZ);
        if (std::fabs(accel_norm - kGravityMps2) > 1.8f || gyro_norm > 3.0f) {
            return;
        }

        sum_x_ += frame.gyroX;
        sum_y_ += frame.gyroY;
        sum_z_ += frame.gyroZ;
        ++samples_;
        if (samples_ >= kGyroBiasSamples) {
            bias_x_ = sum_x_ / static_cast<float>(samples_);
            bias_y_ = sum_y_ / static_cast<float>(samples_);
            bias_z_ = sum_z_ / static_cast<float>(samples_);
            ready_ = true;
            mclog::tagInfo(_tag, "gyro bias calibrated x={:.3f} y={:.3f} z={:.3f} dps", bias_x_, bias_y_, bias_z_);
        }
    }

    void apply(BodyImuFrame& frame) const
    {
        if (!ready_) {
            return;
        }
        frame.gyroX -= bias_x_;
        frame.gyroY -= bias_y_;
        frame.gyroZ -= bias_z_;
    }

private:
    float sum_x_ = 0.0f;
    float sum_y_ = 0.0f;
    float sum_z_ = 0.0f;
    float bias_x_ = 0.0f;
    float bias_y_ = 0.0f;
    float bias_z_ = 0.0f;
    int samples_ = 0;
    bool ready_ = false;
};

}  // namespace

static void _imu_task(void* param)
{
    auto motion_detector = std::make_unique<MotionDetector>();
    motion_detector->setShakeThreshold(16.0f);
    GyroBiasCalibrator gyro_bias;

    while (1) {
        if (_bmi270 && _bmi270->update()) {
            auto& data = _bmi270->getData();
            auto frame = to_body_frame(data);
            gyro_bias.update(frame);
            gyro_bias.apply(frame);
            // mclog::debug("IMU Accel: {:.2f}\t{:.2f}\t{:.2f}", data.accel_x, data.accel_y, data.accel_z);

            motion_detector->update(frame.accelX, frame.accelY, frame.accelZ);

            ImuMotionEvent motion = ImuMotionEvent::None;
            if (motion_detector->isShakeDetected()) {
                mclog::tagInfo(_tag, "Shake Detected!");
                motion = ImuMotionEvent::Shake;
                GetDeviceRuntime().onImuMotionEvent.emit(ImuMotionEvent::Shake);
            }
            {
                std::lock_guard<std::mutex> lock(_imu_snapshot_mutex);
                _imu_snapshot.available = true;
                _imu_snapshot.x         = frame.accelX;
                _imu_snapshot.y         = frame.accelY;
                _imu_snapshot.z         = frame.accelZ;
                _imu_snapshot.gyroX     = frame.gyroX;
                _imu_snapshot.gyroY     = frame.gyroY;
                _imu_snapshot.gyroZ     = frame.gyroZ;
                _imu_snapshot.magnetometerAvailable = data.mag_available;
                if (data.mag_available && data.mag_updated) {
                    _imu_snapshot.magnetometerX = frame.magX;
                    _imu_snapshot.magnetometerY = frame.magY;
                    _imu_snapshot.magnetometerZ = frame.magZ;
                    _imu_snapshot.magnetometerRawX = frame.magRawX;
                    _imu_snapshot.magnetometerRawY = frame.magRawY;
                    _imu_snapshot.magnetometerRawZ = frame.magRawZ;
                    float heading = std::atan2(frame.magY, frame.magX) * 180.0f / kPi;
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
        stackchan::hal::hardware::GetHardwareRegistry().set_module_status("imu-bmi270", false, "init_failed");
        mclog::tagError(_tag, "BMI270 init failed");
        return;
    }
    stackchan::hal::hardware::GetHardwareRegistry().set_module_status("imu-bmi270", true);
    mclog::tagInfo(_tag, "BMI270 init ok");

    // xTaskCreateWithCaps(_imu_task, "imu", 4096, NULL, 2, NULL, MALLOC_CAP_SPIRAM);
    xTaskCreatePinnedToCoreWithCaps(_imu_task, "imu", 4096, NULL, 2, NULL, 1, MALLOC_CAP_SPIRAM);
}

LocalImuSnapshot DeviceRuntime::getLocalImuSnapshot()
{
    std::lock_guard<std::mutex> lock(_imu_snapshot_mutex);
    return _imu_snapshot;
}
