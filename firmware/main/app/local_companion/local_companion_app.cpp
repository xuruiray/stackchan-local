/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include "local_companion_app.h"

#include <ArduinoJson.hpp>
#include <app/common/status_bar/status_bar.h>
#include <assets/assets.h>
#include <system/device_runtime.h>
#include <mooncake_log.h>
#include <smooth_lvgl.hpp>
#include <services/expression_motion/animation/animation.h>
#include <services/expression_motion/stackchan.h>
#include <algorithm>
#include <cmath>
#include <string>
#include <string_view>

using namespace mooncake;
using namespace stackchan;

namespace {
constexpr uint32_t kIdleSettleMs = 2500;
constexpr uint32_t kCommandQuietMs = 6500;
constexpr uint32_t kDanceQuietMs = 10000;
constexpr uint32_t kFaceTrackingApplyIntervalMs = 80;
constexpr uint32_t kOfflineIdleShutdownMs = 60000;
constexpr int kFaceTrackingSearchYaw = 0;
constexpr int kFaceTrackingSearchPitch = 260;
constexpr int kFaceTrackingSearchSpeedMin = 420;

float clamp_float(float value, float min_value, float max_value)
{
    return std::max(min_value, std::min(max_value, value));
}

bool should_hide_bottom_status(LocalCompanionState state)
{
    switch (state) {
        case LocalCompanionState::Idle:
        case LocalCompanionState::Thinking:
        case LocalCompanionState::Speaking:
            return true;
        default:
            return false;
    }
}

avatar::Emotion emotion_from_string(std::string_view emotion)
{
    if (emotion == "happy" || emotion == "love") {
        return avatar::Emotion::Happy;
    }
    if (emotion == "sad") {
        return avatar::Emotion::Sad;
    }
    if (emotion == "angry") {
        return avatar::Emotion::Angry;
    }
    if (emotion == "sleepy") {
        return avatar::Emotion::Sleepy;
    }
    if (emotion == "thinking" || emotion == "surprised") {
        return avatar::Emotion::Doubt;
    }
    return avatar::Emotion::Neutral;
}
}  // namespace

AppLocalCompanion::AppLocalCompanion()
{
    setAppInfo().name = "LOCAL";
    static auto icon  = assets::get_image("icon_sentinel.bin");
    setAppInfo().icon = (void*)&icon;
    static uint32_t theme_color = 0x222831;
    setAppInfo().userData       = (void*)&theme_color;
}

void AppLocalCompanion::onCreate()
{
    mclog::tagInfo(getAppInfo().name, "on create");
    open();
}

void AppLocalCompanion::onOpen()
{
    mclog::tagInfo(getAppInfo().name, "on open");

    {
        LvglLockGuard lock;

        auto avatar = std::make_unique<avatar::DefaultAvatar>();
        avatar->init(lv_screen_active());
        GetStackChan().attachAvatar(std::move(avatar));
        install_base_modifiers();
        refresh_idle_activity(kIdleSettleMs);

        view::create_status_bar(0x89DCEB, 0x111827);

        _status_label = lv_label_create(lv_screen_active());
        lv_label_set_text(_status_label, "Connecting");
        lv_obj_set_style_text_color(_status_label, lv_color_hex(0x111827), 0);
        lv_obj_set_style_text_font(_status_label, &lv_font_montserrat_14, 0);
        lv_obj_align(_status_label, LV_ALIGN_BOTTOM_MID, 0, -10);

        _touch_layer = lv_obj_create(lv_screen_active());
        lv_obj_remove_style_all(_touch_layer);
        lv_obj_set_size(_touch_layer, LV_PCT(100), LV_PCT(100));
        lv_obj_align(_touch_layer, LV_ALIGN_CENTER, 0, 0);
        lv_obj_add_flag(_touch_layer, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_remove_flag(_touch_layer, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_add_event_cb(_touch_layer, AppLocalCompanion::screen_long_press_event_cb, LV_EVENT_LONG_PRESSED, this);
    }

    GetDeviceRuntime().startBleServer();
    GetDeviceRuntime().startLocalCompanionService([&](std::string_view msg) {
        LvglLockGuard lock;
        if (_status_label) {
            lv_obj_clear_flag(_status_label, LV_OBJ_FLAG_HIDDEN);
            lv_label_set_text(_status_label, std::string(msg).c_str());
        }
    });

    GetDeviceRuntime().onBleAvatarData.connect([&](const char* data) {
        std::lock_guard<std::mutex> lock(_mutex);
        if (_ble_avatar_data.update_flag) {
            return;
        }
        _ble_avatar_data.update_flag = true;
        _ble_avatar_data.data_ptr    = (char*)data;
        refresh_idle_activity(kCommandQuietMs);
    });

    GetDeviceRuntime().onBleMotionData.connect([&](const char* data) {
        std::lock_guard<std::mutex> lock(_mutex);
        if (_ble_motion_data.update_flag) {
            return;
        }
        _ble_motion_data.update_flag = true;
        _ble_motion_data.data_ptr    = (char*)data;
        refresh_idle_activity(kCommandQuietMs);
    });

    GetDeviceRuntime().onBleRgbData.connect([&](const char* data) {
        std::lock_guard<std::mutex> lock(_mutex);
        if (_ble_rgb_data.update_flag) {
            return;
        }
        _ble_rgb_data.update_flag = true;
        _ble_rgb_data.data_ptr    = (char*)data;
        refresh_idle_activity(kCommandQuietMs);
    });

    GetDeviceRuntime().onWsTextMessage.connect([&](const WsTextMessage_t& message) {
        {
            std::lock_guard<std::mutex> lock(_mutex);
            refresh_idle_activity(kCommandQuietMs);
        }
        LvglLockGuard lock;
        auto& stackchan = GetStackChan();
        stackchan.addModifier(std::make_unique<TimedSpeechModifier>(message.content, 6000));
        stackchan.addModifier(std::make_unique<SpeakingModifier>(2000));
    });

    GetDeviceRuntime().onWsReactMessage.connect([&](const WsReactMessage_t& message) {
        std::lock_guard<std::mutex> lock(_mutex);
        _ws_react_data.update_flag = true;
        _ws_react_data.emotion     = message.emotion;
        _ws_react_data.duration_ms = message.durationMs;
        _ws_react_data.avatar_json = message.avatarJson;
        _ws_react_data.rgb_json    = message.rgbJson;
        refresh_idle_activity(kCommandQuietMs);
    });

    GetDeviceRuntime().onWsDanceData.connect([&](std::string_view data) {
        {
            std::lock_guard<std::mutex> lock(_mutex);
            refresh_idle_activity(kDanceQuietMs);
        }
        LvglLockGuard lock;
        auto sequence = stackchan::animation::parse_sequence_from_json(data.data());
        if (!sequence.empty()) {
            if (_dance_modifier_id >= 0) {
                GetStackChan().removeModifier(_dance_modifier_id);
            }
            _dance_modifier_id = GetStackChan().addModifier(std::make_unique<DanceModifier>(sequence));
        }
    });

    _head_gesture_connection = GetDeviceRuntime().onHeadPetGesture.connect([&](HeadPetGesture gesture) {
        std::lock_guard<std::mutex> lock(_mutex);
        if (gesture == HeadPetGesture::Press) {
            _head_pressed        = true;
            _long_press_handled = false;
            _head_press_started = GetDeviceRuntime().millis();
        } else if (gesture == HeadPetGesture::Release) {
            _head_pressed        = false;
            _long_press_handled = false;
        }
    });

    _local_activity_connection = GetDeviceRuntime().onLocalCompanionActivity.connect([&](const char*) {
        std::lock_guard<std::mutex> lock(_mutex);
        refresh_idle_activity(kCommandQuietMs);
    });
}

void AppLocalCompanion::onRunning()
{
    std::lock_guard<std::mutex> lock(_mutex);
    LvglLockGuard lvgl_lock;

    if (_ble_avatar_data.update_flag) {
        GetStackChan().updateAvatarFromJson(_ble_avatar_data.data_ptr);
        _ble_avatar_data.update_flag = false;
        _ble_avatar_data.data_ptr    = nullptr;
    }

    if (_ble_motion_data.update_flag) {
        GetStackChan().updateMotionFromJson(_ble_motion_data.data_ptr);
        _ble_motion_data.update_flag = false;
        _ble_motion_data.data_ptr    = nullptr;
    }

    if (_ble_rgb_data.update_flag) {
        GetStackChan().updateNeonLightFromJson(_ble_rgb_data.data_ptr);
        _ble_rgb_data.update_flag = false;
        _ble_rgb_data.data_ptr    = nullptr;
    }

    if (_ws_react_data.update_flag) {
        if (!_ws_react_data.avatar_json.empty()) {
            GetStackChan().updateAvatarFromJson(_ws_react_data.avatar_json.c_str());
        } else {
            GetStackChan().addModifier(std::make_unique<TimedEmotionModifier>(
                emotion_from_string(_ws_react_data.emotion), _ws_react_data.duration_ms));
        }
        if (!_ws_react_data.rgb_json.empty()) {
            GetStackChan().updateNeonLightFromJson(_ws_react_data.rgb_json.c_str());
        }
        _ws_react_data = PendingReactData();
    }

    sync_mode_visuals();
    sync_face_tracking();
    GetStackChan().update();
    view::update_status_bar();

    if (GetDeviceRuntime().millis() - _last_status_update > 500) {
        _last_status_update = GetDeviceRuntime().millis();
        update_status_label();
    }

    handle_head_long_press();
    sync_idle_modifiers();
    sync_offline_idle_shutdown();
}

void AppLocalCompanion::onClose()
{
    mclog::tagInfo(getAppInfo().name, "on close");

    LvglLockGuard lock;
    GetDeviceRuntime().onBleAvatarData.clear();
    GetDeviceRuntime().onBleMotionData.clear();
    GetDeviceRuntime().onBleRgbData.clear();
    GetDeviceRuntime().onWsTextMessage.clear();
    GetDeviceRuntime().onWsReactMessage.clear();
    GetDeviceRuntime().onWsDanceData.clear();
    if (_head_gesture_connection != 0) {
        GetDeviceRuntime().onHeadPetGesture.disconnect(_head_gesture_connection);
        _head_gesture_connection = 0;
    }
    if (_local_activity_connection != 0) {
        GetDeviceRuntime().onLocalCompanionActivity.disconnect(_local_activity_connection);
        _local_activity_connection = 0;
    }
    remove_modifier(_dance_modifier_id);
    stop_idle_modifiers();
    remove_modifier(_imu_modifier_id);
    remove_modifier(_head_pet_modifier_id);
    remove_modifier(_blink_modifier_id);
    remove_modifier(_breath_modifier_id);
    destroy_pairing_panel();
    destroy_touch_layer();
    view::destroy_status_bar();
    GetStackChan().resetAvatar();
}

void AppLocalCompanion::update_status_label()
{
    if (!_status_label) {
        return;
    }
    if (_pairing_panel) {
        lv_obj_clear_flag(_status_label, LV_OBJ_FLAG_HIDDEN);
        lv_label_set_text(_status_label, "Pairing");
        return;
    }
    if (should_hide_bottom_status(GetDeviceRuntime().getLocalCompanionState())) {
        lv_obj_add_flag(_status_label, LV_OBJ_FLAG_HIDDEN);
        return;
    }
    lv_obj_clear_flag(_status_label, LV_OBJ_FLAG_HIDDEN);
    lv_label_set_text(_status_label, state_to_text());
}

const char* AppLocalCompanion::state_to_text() const
{
    switch (GetDeviceRuntime().getLocalCompanionState()) {
        case LocalCompanionState::Idle:
            return "Idle";
        case LocalCompanionState::Connecting:
            return "Connecting";
        case LocalCompanionState::Connected:
            return "Local";
        case LocalCompanionState::Listening:
            return "Listening";
        case LocalCompanionState::Thinking:
            return "Thinking";
        case LocalCompanionState::Speaking:
            return "Speaking";
        case LocalCompanionState::Sleeping:
            return "Sleeping";
        case LocalCompanionState::PairingFailed:
            return "Pairing Failed";
        case LocalCompanionState::Disconnected:
            return "Disconnected";
        case LocalCompanionState::Error:
        default:
            return "Error";
    }
}

void AppLocalCompanion::handle_head_long_press()
{
    if (!_head_pressed || _long_press_handled) {
        return;
    }

    if (GetDeviceRuntime().millis() - _head_press_started < 1200) {
        return;
    }

    _long_press_handled = true;
    refresh_idle_activity(kCommandQuietMs);
    toggle_pairing_panel();
}

void AppLocalCompanion::sync_mode_visuals()
{
    auto state = GetDeviceRuntime().getLocalCompanionState();
    if (_visual_state_initialized && state == _last_visual_state) {
        return;
    }

    _last_visual_state = state;
    _visual_state_initialized = true;
    apply_mode_visuals(state);
}

void AppLocalCompanion::apply_mode_visuals(LocalCompanionState state)
{
    auto& stackchan = GetStackChan();
    if (!stackchan.hasAvatar()) {
        return;
    }

    auto& current_avatar = stackchan.avatar();
    current_avatar.clearSpeech();
    current_avatar.mouth().setWeight(0);

    switch (state) {
        case LocalCompanionState::Thinking:
            current_avatar.setEmotion(avatar::Emotion::Doubt);
            GetDeviceRuntime().showRgbColor(0, 0, 48);
            if (!is_face_tracking_reserved() && !stackchan.motion().isMoving()) {
                stackchan.motion().moveWithSpeed(0, 260, 180);
            }
            return;
        case LocalCompanionState::Listening:
            current_avatar.setEmotion(avatar::Emotion::Neutral);
            GetDeviceRuntime().showRgbColor(0, 36, 48);
            return;
        case LocalCompanionState::Speaking:
            current_avatar.setEmotion(avatar::Emotion::Happy);
            GetDeviceRuntime().showRgbColor(0, 0, 64);
            stackchan.addModifier(std::make_unique<SpeakingModifier>(2400, 180, false));
            return;
        case LocalCompanionState::Sleeping:
            current_avatar.setEmotion(avatar::Emotion::Sleepy);
            GetDeviceRuntime().showRgbColor(12, 0, 24);
            return;
        case LocalCompanionState::Error:
            current_avatar.setEmotion(avatar::Emotion::Angry);
            GetDeviceRuntime().showRgbColor(64, 0, 0);
            return;
        case LocalCompanionState::Connecting:
            current_avatar.setEmotion(avatar::Emotion::Doubt);
            GetDeviceRuntime().showRgbColor(48, 28, 0);
            return;
        case LocalCompanionState::Idle:
        case LocalCompanionState::Connected:
        case LocalCompanionState::Disconnected:
        case LocalCompanionState::PairingFailed:
        default:
            current_avatar.setEmotion(avatar::Emotion::Neutral);
            GetDeviceRuntime().showRgbColor(0, 0, 0);
            return;
    }
}

void AppLocalCompanion::sync_face_tracking()
{
    auto target = GetDeviceRuntime().getLocalFaceTrackingTarget();
    if (!target.detected) {
        _face_tracking_pid_ready = false;
        _face_tracking_integral_x = 0.0f;
        _face_tracking_integral_y = 0.0f;
        if (!target.recenterOnLost || target.updatedAt == 0 || target.updatedAt == _last_face_tracking_update) {
            if (!target.recenterOnLost) {
                _last_face_tracking_update = target.updatedAt;
            }
            return;
        }
        const auto now = GetDeviceRuntime().millis();
        if (now - _last_face_tracking_apply < kFaceTrackingApplyIntervalMs) {
            return;
        }
        auto& motion = GetStackChan().motion();
        const int yaw_min = std::min(target.control.servoRange.yawMin, target.control.servoRange.yawMax);
        const int yaw_max = std::max(target.control.servoRange.yawMin, target.control.servoRange.yawMax);
        const int pitch_min = std::min(target.control.servoRange.pitchMin, target.control.servoRange.pitchMax);
        const int pitch_max = std::max(target.control.servoRange.pitchMin, target.control.servoRange.pitchMax);
        const int search_yaw = std::max(yaw_min, std::min(yaw_max, kFaceTrackingSearchYaw));
        const int search_pitch = std::max(pitch_min, std::min(pitch_max, kFaceTrackingSearchPitch));
        const int search_speed = std::max(kFaceTrackingSearchSpeedMin, std::min(1000, target.speed));
        motion.moveWithSpeed(search_yaw, search_pitch, search_speed);
        _last_face_tracking_update = target.updatedAt;
        _last_face_tracking_apply = now;
        return;
    }
    if (target.updatedAt == 0 || target.updatedAt == _last_face_tracking_update) {
        return;
    }

    const auto now = GetDeviceRuntime().millis();
    if (now - _last_face_tracking_apply < kFaceTrackingApplyIntervalMs) {
        return;
    }

    const float error_x = target.centerX - 0.5f;
    const float error_y = 0.5f - target.centerY;
    const float deadband = clamp_float(target.control.deadband, 0.0f, 0.3f);
    const float filtered_error_x = std::abs(error_x) < deadband ? 0.0f : error_x;
    const float filtered_error_y = std::abs(error_y) < deadband ? 0.0f : error_y;
    if (filtered_error_x == 0.0f && filtered_error_y == 0.0f) {
        _face_tracking_integral_x *= 0.8f;
        _face_tracking_integral_y *= 0.8f;
        _last_face_tracking_error_x = 0.0f;
        _last_face_tracking_error_y = 0.0f;
        _last_face_tracking_update = target.updatedAt;
        return;
    }

    const float dt = _face_tracking_pid_ready && _last_face_tracking_pid_at > 0
                         ? std::max(0.001f, (now - _last_face_tracking_pid_at) / 1000.0f)
                         : (kFaceTrackingApplyIntervalMs / 1000.0f);
    const float integral_limit = clamp_float(target.control.integralLimit, 0.0f, 2.0f);
    _face_tracking_integral_x = clamp_float(_face_tracking_integral_x + filtered_error_x * dt, -integral_limit, integral_limit);
    _face_tracking_integral_y = clamp_float(_face_tracking_integral_y + filtered_error_y * dt, -integral_limit, integral_limit);

    const float derivative_x = _face_tracking_pid_ready ? (filtered_error_x - _last_face_tracking_error_x) / dt : 0.0f;
    const float derivative_y = _face_tracking_pid_ready ? (filtered_error_y - _last_face_tracking_error_y) / dt : 0.0f;
    const float output_limit_deg = clamp_float(target.control.outputLimitDeg, 1.0f, 45.0f);
    const float yaw_delta_deg = clamp_float(target.control.yaw.kp * filtered_error_x +
                                                target.control.yaw.ki * _face_tracking_integral_x +
                                                target.control.yaw.kd * derivative_x,
                                            -output_limit_deg, output_limit_deg);
    const float pitch_delta_deg = clamp_float(target.control.pitch.kp * filtered_error_y +
                                                  target.control.pitch.ki * _face_tracking_integral_y +
                                                  target.control.pitch.kd * derivative_y,
                                              -output_limit_deg, output_limit_deg);

    auto& motion = GetStackChan().motion();
    auto current = motion.getCurrentAngles();
    const int yaw_delta = static_cast<int>(yaw_delta_deg * 10.0f);
    const int pitch_delta = static_cast<int>(pitch_delta_deg * 10.0f);
    const int yaw_min = std::min(target.control.servoRange.yawMin, target.control.servoRange.yawMax);
    const int yaw_max = std::max(target.control.servoRange.yawMin, target.control.servoRange.yawMax);
    const int pitch_min = std::min(target.control.servoRange.pitchMin, target.control.servoRange.pitchMax);
    const int pitch_max = std::max(target.control.servoRange.pitchMin, target.control.servoRange.pitchMax);
    const int next_yaw = std::max(yaw_min, std::min(yaw_max, current.x + yaw_delta));
    const int next_pitch = std::max(pitch_min, std::min(pitch_max, current.y + pitch_delta));
    const int speed = std::max(0, std::min(1000, target.speed));

    motion.moveWithSpeed(next_yaw, next_pitch, speed);
    _last_face_tracking_error_x = filtered_error_x;
    _last_face_tracking_error_y = filtered_error_y;
    _last_face_tracking_pid_at = now;
    _face_tracking_pid_ready = true;
    _last_face_tracking_update = target.updatedAt;
    _last_face_tracking_apply = now;
}

void AppLocalCompanion::install_base_modifiers()
{
    auto& stackchan = GetStackChan();
    if (_breath_modifier_id < 0) {
        _breath_modifier_id = stackchan.addModifier(std::make_unique<BreathModifier>());
    }
    if (_blink_modifier_id < 0) {
        _blink_modifier_id = stackchan.addModifier(std::make_unique<BlinkModifier>());
    }
    if (_head_pet_modifier_id < 0) {
        _head_pet_modifier_id = stackchan.addModifier(std::make_unique<HeadPetModifier>());
    }
    if (_imu_modifier_id < 0) {
        _imu_modifier_id = stackchan.addModifier(std::make_unique<ImuEventModifier>());
    }
}

void AppLocalCompanion::remove_modifier(int& modifier_id)
{
    if (modifier_id < 0) {
        return;
    }

    GetStackChan().removeModifier(modifier_id);
    modifier_id = -1;
}

void AppLocalCompanion::refresh_idle_activity(uint32_t quiet_ms)
{
    _idle_suppress_until = GetDeviceRuntime().millis() + quiet_ms;
}

void AppLocalCompanion::sync_idle_modifiers()
{
    if (should_run_idle_modifiers()) {
        start_idle_modifiers();
        return;
    }

    stop_idle_modifiers();
}

void AppLocalCompanion::sync_offline_idle_shutdown()
{
    if (_offline_idle_shutdown_requested) {
        return;
    }

    const auto now = GetDeviceRuntime().millis();
    if (!should_count_offline_idle_shutdown()) {
        if (_offline_idle_shutdown_started != 0) {
            mclog::tagInfo(getAppInfo().name, "offline idle shutdown canceled");
        }
        _offline_idle_shutdown_started = 0;
        return;
    }

    if (_offline_idle_shutdown_started == 0) {
        _offline_idle_shutdown_started = now;
        mclog::tagInfo(getAppInfo().name, "desktop offline while idle, power off in {} ms", kOfflineIdleShutdownMs);
        return;
    }

    if (now - _offline_idle_shutdown_started < kOfflineIdleShutdownMs) {
        return;
    }

    _offline_idle_shutdown_requested = true;
    stop_idle_modifiers();
    if (_status_label) {
        lv_obj_clear_flag(_status_label, LV_OBJ_FLAG_HIDDEN);
        lv_label_set_text(_status_label, "Powering Off");
    }
    GetDeviceRuntime().showRgbColor(16, 0, 0);
    mclog::tagWarn(getAppInfo().name, "desktop offline idle timeout reached, powering off");
    GetDeviceRuntime().powerOff();
}

void AppLocalCompanion::start_idle_modifiers()
{
    auto& stackchan = GetStackChan();
    if (_idle_motion_modifier_id < 0) {
        _idle_motion_modifier_id = stackchan.addModifier(std::make_unique<IdleMotionModifier>());
    }
    if (_idle_expression_modifier_id < 0) {
        _idle_expression_modifier_id = stackchan.addModifier(std::make_unique<IdleExpressionModifier>());
    }
}

void AppLocalCompanion::stop_idle_modifiers()
{
    remove_modifier(_idle_motion_modifier_id);
    remove_modifier(_idle_expression_modifier_id);
}

bool AppLocalCompanion::should_run_idle_modifiers() const
{
    if (_pairing_panel || GetDeviceRuntime().millis() < _idle_suppress_until || is_face_tracking_reserved()) {
        return false;
    }

    switch (GetDeviceRuntime().getLocalCompanionState()) {
        case LocalCompanionState::Idle:
        case LocalCompanionState::Connected:
        case LocalCompanionState::Disconnected:
            return true;
        case LocalCompanionState::Connecting:
        case LocalCompanionState::Listening:
        case LocalCompanionState::Thinking:
        case LocalCompanionState::Speaking:
        case LocalCompanionState::Sleeping:
        case LocalCompanionState::PairingFailed:
        case LocalCompanionState::Error:
        default:
            return false;
    }
}

bool AppLocalCompanion::should_count_offline_idle_shutdown() const
{
    if (_pairing_panel || GetDeviceRuntime().millis() < _idle_suppress_until || is_face_tracking_reserved()) {
        return false;
    }

    switch (GetDeviceRuntime().getLocalCompanionState()) {
        case LocalCompanionState::Connecting:
        case LocalCompanionState::PairingFailed:
        case LocalCompanionState::Disconnected:
        case LocalCompanionState::Error:
            return true;
        case LocalCompanionState::Idle:
        case LocalCompanionState::Connected:
        case LocalCompanionState::Listening:
        case LocalCompanionState::Thinking:
        case LocalCompanionState::Speaking:
        case LocalCompanionState::Sleeping:
        default:
            return false;
    }
}

bool AppLocalCompanion::is_face_tracking_reserved() const
{
    return GetDeviceRuntime().getLocalFaceTrackingTarget().reserved;
}

void AppLocalCompanion::toggle_pairing_panel()
{
    refresh_idle_activity(kCommandQuietMs);
    if (_pairing_panel) {
        destroy_pairing_panel();
        return;
    }

    _pairing_panel = lv_obj_create(lv_screen_active());
    lv_obj_set_size(_pairing_panel, 270, 160);
    lv_obj_set_style_radius(_pairing_panel, 8, 0);
    lv_obj_set_style_bg_color(_pairing_panel, lv_color_hex(0xF9FAFB), 0);
    lv_obj_set_style_border_color(_pairing_panel, lv_color_hex(0x111827), 0);
    lv_obj_set_style_border_width(_pairing_panel, 2, 0);
    lv_obj_set_style_pad_all(_pairing_panel, 14, 0);
    lv_obj_align(_pairing_panel, LV_ALIGN_CENTER, 0, 8);

    auto title = lv_label_create(_pairing_panel);
    lv_label_set_text(title, "Local Pairing");
    lv_obj_set_style_text_font(title, &lv_font_montserrat_20, 0);
    lv_obj_set_style_text_color(title, lv_color_hex(0x111827), 0);
    lv_obj_align(title, LV_ALIGN_TOP_LEFT, 0, 0);

    auto body = lv_label_create(_pairing_panel);
    lv_label_set_text(body, "BLE ready\nmDNS: _stackchan-local._tcp\nFallback: NVS url\nHold screen/head to close");
    lv_obj_set_style_text_font(body, &lv_font_montserrat_14, 0);
    lv_obj_set_style_text_color(body, lv_color_hex(0x374151), 0);
    lv_obj_align(body, LV_ALIGN_TOP_LEFT, 0, 38);

    if (_status_label) {
        lv_obj_clear_flag(_status_label, LV_OBJ_FLAG_HIDDEN);
        lv_label_set_text(_status_label, "Pairing");
    }
}

void AppLocalCompanion::destroy_pairing_panel()
{
    if (!_pairing_panel) {
        return;
    }

    lv_obj_del(_pairing_panel);
    _pairing_panel = nullptr;
}

void AppLocalCompanion::destroy_touch_layer()
{
    if (!_touch_layer) {
        return;
    }

    lv_obj_del(_touch_layer);
    _touch_layer = nullptr;
}

void AppLocalCompanion::screen_long_press_event_cb(lv_event_t* event)
{
    auto* app = static_cast<AppLocalCompanion*>(lv_event_get_user_data(event));
    if (!app) {
        return;
    }

    app->toggle_pairing_panel();
}
