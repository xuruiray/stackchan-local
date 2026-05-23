/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include "head_touch_sensor.h"
#include <hal/hal.h>
#include "drivers/Si12T/Si12T.h"
#include <runtime_compat/embedded_runtime_bridge.h>
#include <esp_err.h>
#include <esp_timer.h>
#include <mooncake_log.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <mutex>

static const std::string_view _tag = "HAL-HeadTouch";
static std::mutex _head_touch_snapshot_mutex;
static LocalHeadTouchSnapshot _head_touch_snapshot;

// 触摸状态
enum class TouchState { IDLE, TOUCHED, SWIPING };

// 配置参数
struct TouchConfig {
    uint8_t touch_threshold = 1;
    int16_t swipe_threshold = 40;  // 使用百分比，范围-100到100
};

// 触摸数据
struct TouchData {
    uint8_t intensity[3];
    uint32_t timestamp;

    // 计算位置（返回-100到100的整数）
    int16_t get_position() const
    {
        uint16_t total = intensity[0] + intensity[1] + intensity[2];
        if (total == 0) return 0;

        int32_t weighted = intensity[0] * (-100) + intensity[1] * 0 + intensity[2] * 100;
        return static_cast<int16_t>(weighted / total);
    }

    uint8_t get_max_intensity() const
    {
        uint8_t max_val = intensity[0];
        if (intensity[1] > max_val) max_val = intensity[1];
        if (intensity[2] > max_val) max_val = intensity[2];
        return max_val;
    }

    bool is_touched() const
    {
        return get_max_intensity() >= 1;
    }
};

// 手势识别器类
class GestureRecognizer {
public:
    GestureRecognizer() : current_state(TouchState::IDLE), initial_position(0)
    {
    }

    // 更新状态机，返回识别到的手势
    HeadPetGesture update(const TouchData& data)
    {
        HeadPetGesture gesture = HeadPetGesture::None;

        switch (current_state) {
            case TouchState::IDLE:
                if (data.is_touched()) {
                    current_state    = TouchState::TOUCHED;
                    initial_position = data.get_position();
                    gesture          = HeadPetGesture::Press;
                    // mclog::tagInfo(_tag, "Touch detected at position: {}", initial_position);
                }
                break;

            case TouchState::TOUCHED:
                if (!data.is_touched()) {
                    current_state = TouchState::IDLE;
                    gesture       = HeadPetGesture::Release;
                } else {
                    // Check for swipe
                    int16_t current_pos = data.get_position();
                    int16_t delta       = current_pos - initial_position;

                    if (delta > config.swipe_threshold) {
                        current_state = TouchState::SWIPING;
                        gesture       = HeadPetGesture::SwipeForward;
                        // mclog::tagInfo(_tag, "Swipe forward detected, delta: {}", delta);
                    } else if (delta < -config.swipe_threshold) {
                        current_state = TouchState::SWIPING;
                        gesture       = HeadPetGesture::SwipeBackward;
                        // mclog::tagInfo(_tag, "Swipe backward detected, delta: {}", delta);
                    }
                }
                break;

            case TouchState::SWIPING:
                if (!data.is_touched()) {
                    current_state = TouchState::IDLE;
                    gesture       = HeadPetGesture::Release;
                }
                break;
        }

        return gesture;
    }

    void set_config(const TouchConfig& cfg)
    {
        config = cfg;
    }

private:
    TouchConfig config;
    TouchState current_state;
    int16_t initial_position;
};

static void _head_touch_update_task(void* param)
{
    mclog::tagInfo(_tag, "start update task");

    si12t_handle_t si12t = (si12t_handle_t)param;
    uint8_t touch_result = 0;
    TouchData data;

    GestureRecognizer recognizer;
    HeadPetGesture gesture;
    int64_t last_error_log_ms = 0;

    vTaskDelay(pdMS_TO_TICKS(200));

    while (1) {
        const esp_err_t read_err = si12t_read_touch_result(si12t, &touch_result);
        if (read_err != ESP_OK) {
            const int64_t now_ms = esp_timer_get_time() / 1000;
            if (now_ms - last_error_log_ms >= 2000) {
                last_error_log_ms = now_ms;
                mclog::tagWarn(_tag, "read failed: {}", esp_err_to_name(read_err));
            }
            {
                std::lock_guard<std::mutex> lock(_head_touch_snapshot_mutex);
                _head_touch_snapshot.available = false;
                _head_touch_snapshot.pressed = false;
                _head_touch_snapshot.intensity = {0, 0, 0};
                _head_touch_snapshot.gesture = HeadPetGesture::None;
                _head_touch_snapshot.updatedAt = GetHAL().millis();
            }
            vTaskDelay(pdMS_TO_TICKS(100));
            continue;
        }
        si12t_parse_touch_result_to(touch_result, data.intensity);
        data.timestamp = xTaskGetTickCount();

        // Update and fire event
        gesture = recognizer.update(data);
        {
            std::lock_guard<std::mutex> lock(_head_touch_snapshot_mutex);
            _head_touch_snapshot.available = true;
            _head_touch_snapshot.pressed = data.is_touched();
            _head_touch_snapshot.intensity = {data.intensity[0], data.intensity[1], data.intensity[2]};
            if (gesture != HeadPetGesture::None) {
                _head_touch_snapshot.gesture = gesture;
            }
            _head_touch_snapshot.updatedAt = GetHAL().millis();
        }
        if (gesture != HeadPetGesture::None) {
            GetHAL().onHeadPetGesture.emit(gesture);
        }

        vTaskDelay(pdMS_TO_TICKS(50));
    }
}

void Hal::head_touch_init()
{
    mclog::tagInfo(_tag, "init");

    auto i2c_bus = embedded_runtime_bridge::board_get_i2c_bus();

    si12t_config_t si12t_cfg = {
        .i2c_bus  = i2c_bus,
        .dev_addr = SI12T_GND_ADDRESS,
    };
    static si12t_handle_t si12t;
    esp_err_t err = si12t_init(&si12t_cfg, &si12t);
    if (err != ESP_OK) {
        mclog::tagError(_tag, "init failed: {}", esp_err_to_name(err));
        std::lock_guard<std::mutex> lock(_head_touch_snapshot_mutex);
        _head_touch_snapshot.available = false;
        _head_touch_snapshot.updatedAt = GetHAL().millis();
        return;
    }

    err = si12t_setup(si12t, SI12T_TYPE_LOW, SI12T_SENSITIVITY_LEVEL_3);
    if (err != ESP_OK) {
        mclog::tagError(_tag, "setup failed: {}", esp_err_to_name(err));
        si12t_delete(si12t);
        si12t = nullptr;
        std::lock_guard<std::mutex> lock(_head_touch_snapshot_mutex);
        _head_touch_snapshot.available = false;
        _head_touch_snapshot.updatedAt = GetHAL().millis();
        return;
    }

    // xTaskCreateWithCaps(_head_touch_update_task, "headtouch", 1024 * 6, si12t, 2, NULL, MALLOC_CAP_SPIRAM);
    const BaseType_t task_result = xTaskCreatePinnedToCoreWithCaps(_head_touch_update_task, "headtouch", 1024 * 6,
                                                                   si12t, 2, NULL, 1, MALLOC_CAP_SPIRAM);
    if (task_result != pdPASS) {
        mclog::tagError(_tag, "failed to create update task");
        si12t_delete(si12t);
        si12t = nullptr;
        std::lock_guard<std::mutex> lock(_head_touch_snapshot_mutex);
        _head_touch_snapshot.available = false;
        _head_touch_snapshot.updatedAt = GetHAL().millis();
    }
}

LocalHeadTouchSnapshot Hal::getLocalHeadTouchSnapshot()
{
    std::lock_guard<std::mutex> lock(_head_touch_snapshot_mutex);
    return _head_touch_snapshot;
}
