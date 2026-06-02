/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include <hardware/motion/servo_controller.h>
#include <system/device_runtime.h>
#include <third_party/ftservo/src/SCSCL.h>
#include <services/expression_motion/stackchan.h>
#include <smooth_ui_toolkit.hpp>
#include <mooncake_log.h>
#include <system/core/settings.h>
#include <mutex>

using namespace smooth_ui_toolkit;
using namespace stackchan::motion;

static SCSCL _scs_bus;
static std::mutex _scs_bus_mutex;

struct ServoConfig_t {
    int id             = -1;
    int defaultZeroPos = 0;
    Vector2i angleLimit;
    Vector2i rawPosLimit;
    std::string settingNs;
    std::string settingZeroPositionKey;
    bool enablePwmMode = false;
};

class ScsServo : public Servo {
public:
    static inline const std::string _tag = "ScsServo";

    ScsServo(const ServoConfig_t& config) : _config(config)
    {
    }

    void init() override
    {
        set_angle_limit(_config.angleLimit);
        get_zero_pos_from_nvs();
        Servo::init();
    }

    void get_zero_pos_from_nvs()
    {
        _zero_pos     = _config.defaultZeroPos;
        bool is_valid = false;

        {
            Settings settings(_config.settingNs, false);
            int nvs_zero_pos = settings.GetInt(_config.settingZeroPositionKey, -1);

            // Limit check
            if (nvs_zero_pos >= _config.rawPosLimit.x && nvs_zero_pos <= _config.rawPosLimit.y) {
                _zero_pos = nvs_zero_pos;
                is_valid  = true;
                mclog::tagInfo(_tag, "id: {} get zero pos: {} from settings", _config.id, _zero_pos);
            } else {
                is_valid = false;
                mclog::tagWarn(_tag, "id: {} get invalid zero pos: {} from settings", _config.id, nvs_zero_pos);
            }
        }

        if (!is_valid) {
            _zero_pos = _config.defaultZeroPos;
            mclog::tagInfo(_tag, "id: {} override zero pos to default: {}", _config.id, _zero_pos);

            Settings settings(_config.settingNs, true);
            settings.SetInt(_config.settingZeroPositionKey, _zero_pos);
        }
    }

    void set_angle_impl(int angle) override
    {
        std::lock_guard<std::mutex> lock(_scs_bus_mutex);
        (void)write_angle_locked(angle);
    }

    bool set_angle_with_ack_impl(int angle, int speed) override
    {
        (void)speed;
        std::lock_guard<std::mutex> lock(_scs_bus_mutex);
        return write_angle_locked(angle);
    }

    int getCurrentAngle() override
    {
        std::lock_guard<std::mutex> lock(_scs_bus_mutex);
        int current_pos = _scs_bus.ReadPos(_config.id);
        int angle       = (current_pos - _zero_pos) * 5 * 10 / 16;
        angle           = uitk::clamp(angle, getAngleLimit().x, getAngleLimit().y);
        // mclog::tagInfo(_tag, "id: {} current pos: {} angle: {}", _id, current_pos, angle);
        return angle;
    }

    bool is_moving_impl() override
    {
        std::lock_guard<std::mutex> lock(_scs_bus_mutex);
        int moving = _scs_bus.ReadMove(_config.id);
        // mclog::tagInfo(_tag, "id: {} moving: {}", _id, moving);
        return moving != 0;
    }

    void setTorqueEnabled(bool enabled) override
    {
        Servo::setTorqueEnabled(enabled);
        std::lock_guard<std::mutex> lock(_scs_bus_mutex);
        _scs_bus.EnableTorque(_config.id, enabled ? 1 : 0);
        // mclog::tagInfo(_tag, "id: {} set torque: {}", _id, enabled);
    }

    bool getTorqueEnabled() override
    {
        std::lock_guard<std::mutex> lock(_scs_bus_mutex);
        int torque_enable = _scs_bus.ReadToqueEnable(_config.id);
        // mclog::tagInfo(_tag, "id: {} torque enable: {}", _id, torque_enable);
        return torque_enable > 0;
    }

    void setCurrentAngleAsZero() override
    {
        {
            std::lock_guard<std::mutex> lock(_scs_bus_mutex);
            _zero_pos = _scs_bus.ReadPos(_config.id);
        }

        Settings settings(_config.settingNs, true);
        settings.SetInt(_config.settingZeroPositionKey, _zero_pos);

        mclog::tagInfo(_tag, "id: {} set zero pos: {} to settings", _config.id, _zero_pos);
    }

    void resetZeroCalibration() override
    {
        _zero_pos = _config.defaultZeroPos;

        Settings settings(_config.settingNs, true);
        settings.SetInt(_config.settingZeroPositionKey, _zero_pos);

        mclog::tagInfo(_tag, "id: {} set zero pos: {} to settings", _config.id, _zero_pos);
    }

    void rotate(int velocity) override
    {
        velocity = uitk::clamp(velocity, -1000, 1000);

        if (!_config.enablePwmMode) {
            return;
        }

        int mapped_velocity = map_range(velocity, 0, 1000, 0, 1023);

        std::lock_guard<std::mutex> lock(_scs_bus_mutex);
        check_mode(Mode::PWM);
        _scs_bus.WritePWM(_config.id, mapped_velocity);
    }

private:
    enum class Mode { Position = 0, PWM = 1 };

    ServoConfig_t _config;
    int _zero_pos      = 0;
    Mode _current_mode = Mode::Position;

    bool write_angle_locked(int angle)
    {
        int mapped_angle = _zero_pos + angle * 16 / 5 / 10;  // 一步对应 0.3125度, 0.3125 = 5/16
        mapped_angle     = uitk::clamp(mapped_angle, _config.rawPosLimit.x, _config.rawPosLimit.y);

        // mclog::tagInfo(_tag, "id: {} mapped angle: {}", _id, mapped_angle);

        check_mode(Mode::Position);
        return _scs_bus.WritePos(_config.id, mapped_angle, 20, 0) != 0;
    }

    void check_mode(Mode targetMode)
    {
        if (targetMode == _current_mode) {
            return;
        }

        _scs_bus.SwitchMode(_config.id, static_cast<uint8_t>(targetMode));
        _current_mode = targetMode;
    }
};

void DeviceRuntime::servo_init()
{
    mclog::tagInfo("Servo", "init");

    {
        std::lock_guard<std::mutex> lock(_scs_bus_mutex);
        _scs_bus.begin(UART_NUM_1, 1000000, 6, 7);
    }

    ServoConfig_t yaw_servo_config;
    yaw_servo_config.id                     = 1;
    yaw_servo_config.defaultZeroPos         = 460;
    yaw_servo_config.angleLimit             = Vector2i(-1280, 1280);
    yaw_servo_config.rawPosLimit            = Vector2i(0, 1000);
    yaw_servo_config.settingNs              = "servo";
    yaw_servo_config.settingZeroPositionKey = "zero_pos_1";
    yaw_servo_config.enablePwmMode          = true;

    ServoConfig_t pitch_servo_config;
    pitch_servo_config.id                     = 2;
    pitch_servo_config.defaultZeroPos         = 620;
    pitch_servo_config.angleLimit             = Vector2i(30, 870);
    pitch_servo_config.rawPosLimit            = Vector2i(0, 1000);
    pitch_servo_config.settingNs              = "servo";
    pitch_servo_config.settingZeroPositionKey = "zero_pos_2";

    auto yaw_servo   = std::make_unique<ScsServo>(yaw_servo_config);
    auto pitch_servo = std::make_unique<ScsServo>(pitch_servo_config);
    auto motion      = std::make_unique<Motion>(std::move(yaw_servo), std::move(pitch_servo));
    motion->init();

    GetStackChan().attachMotion(std::move(motion));
}
