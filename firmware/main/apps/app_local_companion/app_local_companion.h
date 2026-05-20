/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once

#include <hal/hal.h>
#include <lvgl.h>
#include <mooncake.h>
#include <mutex>

class AppLocalCompanion : public mooncake::AppAbility {
public:
    AppLocalCompanion();

    void onCreate() override;
    void onOpen() override;
    void onRunning() override;
    void onClose() override;

private:
    struct HandlerData {
        bool update_flag = false;
        char* data_ptr   = nullptr;
    };

    std::mutex _mutex;
    HandlerData _ble_avatar_data;
    HandlerData _ble_motion_data;
    HandlerData _ble_rgb_data;
    lv_obj_t* _touch_layer = nullptr;
    lv_obj_t* _status_label = nullptr;
    lv_obj_t* _pairing_panel = nullptr;
    uint32_t _last_status_update = 0;
    uint32_t _head_press_started = 0;
    uint32_t _idle_suppress_until = 0;
    uint32_t _last_face_tracking_update = 0;
    uint32_t _last_face_tracking_apply = 0;
    uint32_t _last_face_tracking_pid_at = 0;
    uint32_t _offline_idle_shutdown_started = 0;
    float _face_tracking_integral_x = 0.0f;
    float _face_tracking_integral_y = 0.0f;
    float _last_face_tracking_error_x = 0.0f;
    float _last_face_tracking_error_y = 0.0f;
    LocalCompanionState _last_visual_state = LocalCompanionState::Idle;
    int _breath_modifier_id = -1;
    int _blink_modifier_id = -1;
    int _head_pet_modifier_id = -1;
    int _imu_modifier_id = -1;
    int _idle_motion_modifier_id = -1;
    int _idle_expression_modifier_id = -1;
    int _dance_modifier_id = -1;
    size_t _head_gesture_connection = 0;
    size_t _local_activity_connection = 0;
    bool _head_pressed = false;
    bool _long_press_handled = false;
    bool _visual_state_initialized = false;
    bool _face_tracking_pid_ready = false;
    bool _offline_idle_shutdown_requested = false;

    void update_status_label();
    const char* state_to_text() const;
    void handle_head_long_press();
    void sync_mode_visuals();
    void apply_mode_visuals(LocalCompanionState state);
    void sync_face_tracking();
    void install_base_modifiers();
    void remove_modifier(int& modifier_id);
    void refresh_idle_activity(uint32_t quiet_ms);
    void sync_idle_modifiers();
    void sync_offline_idle_shutdown();
    void start_idle_modifiers();
    void stop_idle_modifiers();
    bool is_face_tracking_reserved() const;
    bool should_run_idle_modifiers() const;
    bool should_count_offline_idle_shutdown() const;
    void toggle_pairing_panel();
    void destroy_pairing_panel();
    void destroy_touch_layer();
    static void screen_long_press_event_cb(lv_event_t* event);
};
