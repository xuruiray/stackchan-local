/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include "hal_bridge.h"
#include "stackchan_display.h"
#include <esp_log.h>
#include <esp_err.h>
#include <nvs.h>
#include <nvs_flash.h>
#include <driver/gpio.h>
#include <esp_event.h>
#include <board.h>
#include <display.h>
#include <audio/audio_service.h>
#include <mutex>
#include <memory>
#include <assets.h>
#include <settings.h>

static const char* _tag = "HAL_BRIDGE";

static constexpr std::string_view _xiaozhi_config_nvs_ns                           = "xiaozhi";
static constexpr std::string_view _xiaozhi_config_idle_shutdown_time_key           = "idle_sec";
static constexpr std::string_view _xiaozhi_config_allow_shutdown_when_charging_key = "ext_pwr";
static constexpr std::string_view _xiaozhi_config_idle_random_movement_key         = "idle_lv";

namespace hal_bridge {

/* -------------------------------------------------------------------------- */
/*                            State and touch point                           */
/* -------------------------------------------------------------------------- */

static std::mutex _mutex;
static std::mutex _audio_mutex;
static Data_t _data;
static std::unique_ptr<AudioService> _local_audio_service;

AudioService* get_playback_audio_service()
{
    if (_local_audio_service) {
        return _local_audio_service.get();
    }

    auto codec = Board::GetInstance().GetAudioCodec();
    if (codec == nullptr) {
        ESP_LOGE(_tag, "audio codec is unavailable");
        return nullptr;
    }

    _local_audio_service = std::make_unique<AudioService>();
    _local_audio_service->Initialize(codec);
    _local_audio_service->Start();
    ESP_LOGI(_tag, "local audio service initialized for companion playback");
    return _local_audio_service.get();
}

void lock()
{
    _mutex.lock();
}

void unlock()
{
    _mutex.unlock();
}

Data_t& get_data()
{
    return _data;
}

void set_touch_point(int num, int x, int y)
{
    std::lock_guard<std::mutex> lock(_mutex);
    _data.touchPoint.num = num;
    _data.touchPoint.x   = x;
    _data.touchPoint.y   = y;
}

TouchPoint_t get_touch_point()
{
    std::lock_guard<std::mutex> lock(_mutex);
    return _data.touchPoint;
}

bool is_xiaozhi_mode()
{
    std::lock_guard<std::mutex> lock(_mutex);
    return _data.isXiaozhiMode;
}

void set_xiaozhi_mode(bool mode)
{
    std::lock_guard<std::mutex> lock(_mutex);
    _data.isXiaozhiMode = mode;
}

/* -------------------------------------------------------------------------- */
/*                                   Display                                  */
/* -------------------------------------------------------------------------- */
#define DISPLAY_TYPE StackChanAvatarDisplay

lv_disp_t* display_get_lvgl_display()
{
    auto display = static_cast<DISPLAY_TYPE*>(Board::GetInstance().GetDisplay());
    return display->GetLvglDisplay();
}

void disply_lvgl_lock()
{
    auto display = static_cast<DISPLAY_TYPE*>(Board::GetInstance().GetDisplay());
    display->LvglLock();
}

void disply_lvgl_unlock()
{
    auto display = static_cast<DISPLAY_TYPE*>(Board::GetInstance().GetDisplay());
    display->LvglUnlock();
}

/* -------------------------------------------------------------------------- */
/*                                 Application                                */
/* -------------------------------------------------------------------------- */

void xiaozhi_board_init()
{
    // Init board
    auto& board = Board::GetInstance();
}

void start_xiaozhi_app()
{
    ESP_LOGW(_tag, "legacy xiaozhi app start ignored in StackChan Local");
}

XiaozhiConfig_t get_xiaozhi_config()
{
    XiaozhiConfig_t config;

    Settings settings(_xiaozhi_config_nvs_ns.data(), false);
    config.idleShutdownTimeSeconds = settings.GetInt(_xiaozhi_config_idle_shutdown_time_key.data(),
                                                     static_cast<int>(config.idleShutdownTimeSeconds));
    config.allowShutdownWhenCharging =
        settings.GetBool(_xiaozhi_config_allow_shutdown_when_charging_key.data(), config.allowShutdownWhenCharging);
    config.idleRandomMovementLevel =
        settings.GetInt(_xiaozhi_config_idle_random_movement_key.data(), config.idleRandomMovementLevel);

    return config;
}

void set_xiaozhi_config(const XiaozhiConfig_t& config)
{
    Settings settings(_xiaozhi_config_nvs_ns.data(), true);
    settings.SetInt(_xiaozhi_config_idle_shutdown_time_key.data(), config.idleShutdownTimeSeconds);
    settings.SetBool(_xiaozhi_config_allow_shutdown_when_charging_key.data(), config.allowShutdownWhenCharging);
    settings.SetInt(_xiaozhi_config_idle_random_movement_key.data(), config.idleRandomMovementLevel);
}

void app_play_sound(const std::string_view& sound)
{
    std::lock_guard<std::mutex> lock(_audio_mutex);
    auto* service = get_playback_audio_service();
    if (service == nullptr) {
        return;
    }
    service->PlaySound(sound);
}

void app_play_sound_and_wait(const std::string_view& sound, int volume)
{
    std::lock_guard<std::mutex> lock(_audio_mutex);
    auto* service = get_playback_audio_service();
    if (service == nullptr) {
        return;
    }
    const bool use_temp_volume = volume >= 0;
    const uint8_t previous_volume = use_temp_volume ? board_get_speaker_volume() : 0;
    if (use_temp_volume) {
        if (volume > 100) {
            volume = 100;
        }
        uint8_t playback_volume = static_cast<uint8_t>(volume);
        if (playback_volume < previous_volume) {
            playback_volume = previous_volume;
        }
        board_set_speaker_volume(playback_volume, false);
    }
    service->PlaySound(sound);
    service->WaitForPlaybackQueueEmpty();
    if (use_temp_volume) {
        board_set_speaker_volume(previous_volume, false);
    }
}

}  // namespace hal_bridge
