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
#include "esp_timer.h"
#include <mooncake_log.h>
#include <cmath>
#include <memory>
#include <mutex>

static const std::string_view _tag = "IMU";
static constexpr float kPi = 3.14159265358979323846f;
static constexpr float kRadToDeg = 180.0f / kPi;
static constexpr float kDegToRad = kPi / 180.0f;
static constexpr float kGravityMps2 = 9.80665f;
static constexpr float kAccelGravityToleranceMps2 = 1.2f;
static constexpr float kAccelCorrectionMaxGyroDps = 180.0f;
static constexpr float kMagCorrectionMaxGyroDps = 45.0f;
static constexpr float kIntegralCorrectionMaxGyroDps = 12.0f;
static constexpr float kIntegralAccelToleranceMps2 = 0.45f;
static constexpr float kIntegralFeedbackDecay = 0.9f;
static constexpr float kStableCorrectionMaxGyroDps = 8.0f;
static constexpr float kStableCorrectionAccelToleranceMps2 = 0.35f;
static constexpr float kStableCorrectionKp = 3.0f;
static constexpr float kStableObservationBlendPerSecond = 4.0f;
// Keep BMM150 telemetry visible, but do not use it to correct yaw until the
// local magnetic field around the servos is calibrated and consistency-gated.
static constexpr bool kUseMagnetometerForYawFusion = false;
static constexpr int kGyroBiasSamples = 40;
static constexpr float kDefaultFusionDtSeconds = 0.01f;
static constexpr float kMaxFusionDtSeconds = 0.2f;
static constexpr TickType_t kImuTaskPeriodTicks = pdMS_TO_TICKS(10);

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

float vector_magnitude(float w, float x, float y, float z)
{
    return std::sqrt(w * w + x * x + y * y + z * z);
}

float clamp_dt(float dt)
{
    if (!std::isfinite(dt) || dt <= 0.0f) {
        return kDefaultFusionDtSeconds;
    }
    if (dt > kMaxFusionDtSeconds) {
        return kMaxFusionDtSeconds;
    }
    return dt;
}

float normalize_angle_deg(float angle)
{
    while (angle < 0.0f) {
        angle += 360.0f;
    }
    while (angle >= 360.0f) {
        angle -= 360.0f;
    }
    return angle;
}

struct AttitudeEstimate {
    bool available = false;
    float qw = 1.0f;
    float qx = 0.0f;
    float qy = 0.0f;
    float qz = 0.0f;
    float pitchDeg = 0.0f;
    float rollDeg = 0.0f;
    float yawDeg = 0.0f;
    bool magnetometerUsed = false;
    ImuAttitudeQuality quality = ImuAttitudeQuality::Unavailable;
    float sampleHz = 0.0f;
};

class MahonyAttitudeFusion {
public:
    AttitudeEstimate update(const BodyImuFrame& frame, bool magnetometer_available, bool magnetometer_updated,
                            float dt_seconds)
    {
        const float dt = clamp_dt(dt_seconds);
        const float accel_norm = vector_magnitude(frame.accelX, frame.accelY, frame.accelZ);
        const float gyro_norm = vector_magnitude(frame.gyroX, frame.gyroY, frame.gyroZ);
        const float accel_error = std::fabs(accel_norm - kGravityMps2);
        const bool accel_valid = accel_norm > 0.001f &&
                                 accel_error < kAccelGravityToleranceMps2 &&
                                 gyro_norm < kAccelCorrectionMaxGyroDps;
        const bool mag_candidate = accel_valid &&
                                   gyro_norm < kMagCorrectionMaxGyroDps &&
                                   is_magnetometer_usable(frame, magnetometer_available && magnetometer_updated);
        const bool mag_usable = kUseMagnetometerForYawFusion && mag_candidate;
        const bool integral_valid = accel_valid &&
                                    gyro_norm < kIntegralCorrectionMaxGyroDps &&
                                    accel_error < kIntegralAccelToleranceMps2;
        const bool stable_correction = accel_valid &&
                                       gyro_norm < kStableCorrectionMaxGyroDps &&
                                       accel_error < kStableCorrectionAccelToleranceMps2;

        if (!initialized_ && accel_valid) {
            initialize_from_frame(frame, mag_usable);
            initialized_ = true;
        }

        update_filter(frame.gyroX * kDegToRad, frame.gyroY * kDegToRad, frame.gyroZ * kDegToRad,
                      frame.accelX, frame.accelY, frame.accelZ,
                      frame.magX, frame.magY, frame.magZ,
                      accel_valid, mag_usable, integral_valid, stable_correction ? kStableCorrectionKp : two_kp_, dt);
        if (stable_correction) {
            float observation_blend = dt * kStableObservationBlendPerSecond;
            if (observation_blend > 1.0f) {
                observation_blend = 1.0f;
            }
            blend_toward_frame(frame, mag_usable, observation_blend);
        }
        initialized_ = true;

        AttitudeEstimate estimate;
        estimate.available = initialized_;
        estimate.qw = q0_;
        estimate.qx = q1_;
        estimate.qy = q2_;
        estimate.qz = q3_;
        estimate.magnetometerUsed = mag_usable;
        estimate.quality = mag_usable ? ImuAttitudeQuality::GyroAccelMag : ImuAttitudeQuality::GyroAccel;
        estimate.sampleHz = dt > 0.0f ? 1.0f / dt : 0.0f;
        fill_euler(estimate);
        return estimate;
    }

private:
    bool is_magnetometer_usable(const BodyImuFrame& frame, bool has_magnetometer)
    {
        if (!has_magnetometer) {
            return false;
        }

        const float mag_norm = vector_magnitude(frame.magX, frame.magY, frame.magZ);
        if (!std::isfinite(mag_norm) || mag_norm < 1.0f || mag_norm > 10000.0f) {
            return false;
        }

        if (mag_norm_baseline_ <= 0.0f) {
            mag_norm_baseline_ = mag_norm;
            return true;
        }

        const bool within_dynamic_range = mag_norm > mag_norm_baseline_ * 0.35f &&
                                          mag_norm < mag_norm_baseline_ * 2.8f;
        if (!within_dynamic_range) {
            return false;
        }

        mag_norm_baseline_ = mag_norm_baseline_ * 0.995f + mag_norm * 0.005f;
        return true;
    }

    void normalize_quaternion()
    {
        const float norm = vector_magnitude(q0_, q1_, q2_, q3_);
        if (!std::isfinite(norm) || norm <= 0.0f) {
            q0_ = 1.0f;
            q1_ = 0.0f;
            q2_ = 0.0f;
            q3_ = 0.0f;
            return;
        }
        q0_ /= norm;
        q1_ /= norm;
        q2_ /= norm;
        q3_ /= norm;
    }

    void quaternion_from_euler(float roll, float pitch, float yaw, float& qw, float& qx, float& qy, float& qz) const
    {
        const float cr = std::cos(roll * 0.5f);
        const float sr = std::sin(roll * 0.5f);
        const float cp = std::cos(pitch * 0.5f);
        const float sp = std::sin(pitch * 0.5f);
        const float cy = std::cos(yaw * 0.5f);
        const float sy = std::sin(yaw * 0.5f);

        qw = cr * cp * cy + sr * sp * sy;
        qx = sr * cp * cy - cr * sp * sy;
        qy = cr * sp * cy + sr * cp * sy;
        qz = cr * cp * sy - sr * sp * cy;
    }

    void set_quaternion_from_euler(float roll, float pitch, float yaw)
    {
        quaternion_from_euler(roll, pitch, yaw, q0_, q1_, q2_, q3_);
        normalize_quaternion();
    }

    float current_yaw() const
    {
        const float siny_cosp = 2.0f * (q0_ * q3_ + q1_ * q2_);
        const float cosy_cosp = 1.0f - 2.0f * (q2_ * q2_ + q3_ * q3_);
        return std::atan2(siny_cosp, cosy_cosp);
    }

    void observation_euler_from_frame(const BodyImuFrame& frame, bool mag_valid, float& roll, float& pitch, float& yaw) const
    {
        roll = std::atan2(frame.accelY, frame.accelZ);
        pitch = std::atan2(-frame.accelX, std::sqrt(frame.accelY * frame.accelY + frame.accelZ * frame.accelZ));
        yaw = initialized_ ? current_yaw() : 0.0f;

        if (mag_valid) {
            const float cr = std::cos(roll);
            const float sr = std::sin(roll);
            const float cp = std::cos(pitch);
            const float sp = std::sin(pitch);
            const float mx = frame.magX * cp + frame.magZ * sp;
            const float my = frame.magX * sr * sp + frame.magY * cr - frame.magZ * sr * cp;
            yaw = std::atan2(my, mx) + kPi;
        }
    }

    void initialize_from_frame(const BodyImuFrame& frame, bool mag_valid)
    {
        float roll = 0.0f;
        float pitch = 0.0f;
        float yaw = 0.0f;
        observation_euler_from_frame(frame, mag_valid, roll, pitch, yaw);

        set_quaternion_from_euler(roll, pitch, yaw);
        integral_fb_x_ = 0.0f;
        integral_fb_y_ = 0.0f;
        integral_fb_z_ = 0.0f;
    }

    void blend_toward_frame(const BodyImuFrame& frame, bool mag_valid, float alpha)
    {
        if (alpha <= 0.0f) {
            return;
        }

        float roll = 0.0f;
        float pitch = 0.0f;
        float yaw = 0.0f;
        observation_euler_from_frame(frame, mag_valid, roll, pitch, yaw);

        float target_w = 1.0f;
        float target_x = 0.0f;
        float target_y = 0.0f;
        float target_z = 0.0f;
        quaternion_from_euler(roll, pitch, yaw, target_w, target_x, target_y, target_z);

        const float dot = q0_ * target_w + q1_ * target_x + q2_ * target_y + q3_ * target_z;
        if (dot < 0.0f) {
            target_w = -target_w;
            target_x = -target_x;
            target_y = -target_y;
            target_z = -target_z;
        }

        q0_ = q0_ * (1.0f - alpha) + target_w * alpha;
        q1_ = q1_ * (1.0f - alpha) + target_x * alpha;
        q2_ = q2_ * (1.0f - alpha) + target_y * alpha;
        q3_ = q3_ * (1.0f - alpha) + target_z * alpha;
        normalize_quaternion();
    }

    void decay_integral_feedback()
    {
        integral_fb_x_ *= kIntegralFeedbackDecay;
        integral_fb_y_ *= kIntegralFeedbackDecay;
        integral_fb_z_ *= kIntegralFeedbackDecay;
    }

    void update_filter(float gx, float gy, float gz, float ax, float ay, float az,
                       float mx, float my, float mz, bool accel_valid, bool mag_valid,
                       bool integral_valid, float correction_kp, float dt)
    {
        float halfex = 0.0f;
        float halfey = 0.0f;
        float halfez = 0.0f;

        if (accel_valid) {
            float recip_norm = 1.0f / vector_magnitude(ax, ay, az);
            ax *= recip_norm;
            ay *= recip_norm;
            az *= recip_norm;

            const float q0q0 = q0_ * q0_;
            const float q0q1 = q0_ * q1_;
            const float q0q2 = q0_ * q2_;
            const float q0q3 = q0_ * q3_;
            const float q1q1 = q1_ * q1_;
            const float q1q2 = q1_ * q2_;
            const float q1q3 = q1_ * q3_;
            const float q2q2 = q2_ * q2_;
            const float q2q3 = q2_ * q3_;
            const float q3q3 = q3_ * q3_;

            const float halfvx = q1q3 - q0q2;
            const float halfvy = q0q1 + q2q3;
            const float halfvz = q0q0 - 0.5f + q3q3;
            halfex += ay * halfvz - az * halfvy;
            halfey += az * halfvx - ax * halfvz;
            halfez += ax * halfvy - ay * halfvx;

            if (mag_valid) {
                recip_norm = 1.0f / vector_magnitude(mx, my, mz);
                mx *= recip_norm;
                my *= recip_norm;
                mz *= recip_norm;

                const float hx = 2.0f * mx * (0.5f - q2q2 - q3q3) +
                                 2.0f * my * (q1q2 - q0q3) +
                                 2.0f * mz * (q1q3 + q0q2);
                const float hy = 2.0f * mx * (q1q2 + q0q3) +
                                 2.0f * my * (0.5f - q1q1 - q3q3) +
                                 2.0f * mz * (q2q3 - q0q1);
                const float bx = std::sqrt(hx * hx + hy * hy);
                const float bz = 2.0f * mx * (q1q3 - q0q2) +
                                 2.0f * my * (q2q3 + q0q1) +
                                 2.0f * mz * (0.5f - q1q1 - q2q2);

                const float halfwx = bx * (0.5f - q2q2 - q3q3) + bz * (q1q3 - q0q2);
                const float halfwy = bx * (q1q2 - q0q3) + bz * (q0q1 + q2q3);
                const float halfwz = bx * (q0q2 + q1q3) + bz * (0.5f - q1q1 - q2q2);

                halfex += kMagCorrectionWeight * (my * halfwz - mz * halfwy);
                halfey += kMagCorrectionWeight * (mz * halfwx - mx * halfwz);
                halfez += kMagCorrectionWeight * (mx * halfwy - my * halfwx);
            }

            if (two_ki_ > 0.0f && integral_valid) {
                integral_fb_x_ += two_ki_ * halfex * dt;
                integral_fb_y_ += two_ki_ * halfey * dt;
                integral_fb_z_ += two_ki_ * halfez * dt;
                gx += integral_fb_x_;
                gy += integral_fb_y_;
                gz += integral_fb_z_;
            } else {
                decay_integral_feedback();
            }

            gx += correction_kp * halfex;
            gy += correction_kp * halfey;
            gz += correction_kp * halfez;
        } else {
            decay_integral_feedback();
        }

        gx *= 0.5f * dt;
        gy *= 0.5f * dt;
        gz *= 0.5f * dt;

        const float qa = q0_;
        const float qb = q1_;
        const float qc = q2_;
        q0_ += -qb * gx - qc * gy - q3_ * gz;
        q1_ += qa * gx + qc * gz - q3_ * gy;
        q2_ += qa * gy - qb * gz + q3_ * gx;
        q3_ += qa * gz + qb * gy - qc * gx;
        normalize_quaternion();
    }

    void fill_euler(AttitudeEstimate& estimate) const
    {
        const float sinr_cosp = 2.0f * (q0_ * q1_ + q2_ * q3_);
        const float cosr_cosp = 1.0f - 2.0f * (q1_ * q1_ + q2_ * q2_);
        estimate.rollDeg = std::atan2(sinr_cosp, cosr_cosp) * kRadToDeg;

        const float sinp = 2.0f * (q0_ * q2_ - q3_ * q1_);
        if (std::fabs(sinp) >= 1.0f) {
            estimate.pitchDeg = std::copysign(90.0f, sinp);
        } else {
            estimate.pitchDeg = std::asin(sinp) * kRadToDeg;
        }

        const float siny_cosp = 2.0f * (q0_ * q3_ + q1_ * q2_);
        const float cosy_cosp = 1.0f - 2.0f * (q2_ * q2_ + q3_ * q3_);
        estimate.yawDeg = normalize_angle_deg(std::atan2(siny_cosp, cosy_cosp) * kRadToDeg);
    }

    static constexpr float kMagCorrectionWeight = 0.35f;
    float q0_ = 1.0f;
    float q1_ = 0.0f;
    float q2_ = 0.0f;
    float q3_ = 0.0f;
    float integral_fb_x_ = 0.0f;
    float integral_fb_y_ = 0.0f;
    float integral_fb_z_ = 0.0f;
    float mag_norm_baseline_ = 0.0f;
    float two_kp_ = 1.0f;
    float two_ki_ = 0.04f;
    bool initialized_ = false;
};

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
    MahonyAttitudeFusion attitude_fusion;
    int64_t last_sample_us = esp_timer_get_time();

    while (1) {
        if (_bmi270 && _bmi270->update()) {
            const int64_t now_us = esp_timer_get_time();
            const float dt_seconds = static_cast<float>(now_us - last_sample_us) / 1000000.0f;
            last_sample_us = now_us;
            auto& data = _bmi270->getData();
            auto frame = to_body_frame(data);
            gyro_bias.update(frame);
            gyro_bias.apply(frame);
            auto attitude = attitude_fusion.update(frame, data.mag_available, data.mag_updated, dt_seconds);
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
                _imu_snapshot.attitudeAvailable = attitude.available;
                _imu_snapshot.attitudeQw = attitude.qw;
                _imu_snapshot.attitudeQx = attitude.qx;
                _imu_snapshot.attitudeQy = attitude.qy;
                _imu_snapshot.attitudeQz = attitude.qz;
                _imu_snapshot.attitudePitchDeg = attitude.pitchDeg;
                _imu_snapshot.attitudeRollDeg = attitude.rollDeg;
                _imu_snapshot.attitudeYawDeg = attitude.yawDeg;
                _imu_snapshot.attitudeMagnetometerUsed = attitude.magnetometerUsed;
                _imu_snapshot.attitudeQuality = attitude.quality;
                _imu_snapshot.attitudeSampleHz = attitude.sampleHz;
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
        vTaskDelay(kImuTaskPeriodTicks);
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
