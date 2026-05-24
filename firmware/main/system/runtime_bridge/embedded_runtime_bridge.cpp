/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include <system/runtime_bridge/embedded_runtime_bridge.h>
#include <services/display/avatar_display.h>
#include <esp_log.h>
#include <esp_err.h>
#include <nvs.h>
#include <nvs_flash.h>
#include <driver/gpio.h>
#include <esp_event.h>
#include <system/legacy_runtime/board/board.h>
#include <services/display/runtime/display.h>
#include <services/audio/runtime/audio_service.h>
#include <mutex>
#include <memory>
#include <system/core/settings.h>

static const char* _tag = "RUNTIME_BRIDGE";

// Keep the original NVS namespace and keys for persisted power settings. The
// compatibility detail stays here so application code does not carry legacy
// runtime naming.
static constexpr std::string_view kCompatPowerConfigNvsNs                     = "xiaozhi";
static constexpr std::string_view kPowerConfigIdleShutdownTimeKey             = "idle_sec";
static constexpr std::string_view kPowerConfigAllowShutdownWhenChargingKey    = "ext_pwr";
static constexpr std::string_view kPowerConfigIdleRandomMovementKey           = "idle_lv";

namespace embedded_runtime_bridge {

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

void board_init()
{
    // Initialize singleton board instance.
    auto& board = Board::GetInstance();
    (void)board;
}

RuntimePowerConfig get_runtime_power_config()
{
    RuntimePowerConfig config;

    Settings settings(kCompatPowerConfigNvsNs.data(), false);
    config.idleShutdownTimeSeconds = settings.GetInt(kPowerConfigIdleShutdownTimeKey.data(),
                                                     static_cast<int>(config.idleShutdownTimeSeconds));
    config.allowShutdownWhenCharging =
        settings.GetBool(kPowerConfigAllowShutdownWhenChargingKey.data(), config.allowShutdownWhenCharging);
    config.idleRandomMovementLevel =
        settings.GetInt(kPowerConfigIdleRandomMovementKey.data(), config.idleRandomMovementLevel);

    return config;
}

void set_runtime_power_config(const RuntimePowerConfig& config)
{
    Settings settings(kCompatPowerConfigNvsNs.data(), true);
    settings.SetInt(kPowerConfigIdleShutdownTimeKey.data(), config.idleShutdownTimeSeconds);
    settings.SetBool(kPowerConfigAllowShutdownWhenChargingKey.data(), config.allowShutdownWhenCharging);
    settings.SetInt(kPowerConfigIdleRandomMovementKey.data(), config.idleRandomMovementLevel);
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
        const uint8_t playback_volume = static_cast<uint8_t>(volume);
        board_set_speaker_volume(playback_volume, false);
    }
    service->PlaySound(sound);
    service->WaitForPlaybackQueueEmpty();
    if (use_temp_volume) {
        board_set_speaker_volume(previous_volume, false);
    }
}

}  // namespace embedded_runtime_bridge
