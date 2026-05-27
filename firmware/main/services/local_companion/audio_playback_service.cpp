/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include "audio_playback_service.h"

#include <system/runtime_bridge/embedded_runtime_bridge.h>
#include <services/audio/runtime/demuxer/ogg_demuxer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <algorithm>
#include <cstdint>
#include <memory>

namespace stackchan::hal::local_companion {
namespace {

constexpr uint32_t kFallbackPlaybackMs = 1800;
constexpr uint32_t kPlaybackTailMs = 250;
constexpr uint32_t kMaxPlaybackWaitMs = 30000;
constexpr uint32_t kPlaybackTaskStackBytes = 12288;

struct PlaybackTaskArg {
    std::string requestId;
    int volume = -1;
    std::string audio;
    AudioPlaybackFinishedCallback onFinished;
};

uint32_t estimate_ogg_opus_duration_ms(const std::string& audio)
{
    if (audio.empty()) {
        return kFallbackPlaybackMs;
    }

    uint32_t duration_ms = 0;
    auto demuxer = std::make_unique<OggDemuxer>();
    if (!demuxer) {
        return kFallbackPlaybackMs;
    }
    demuxer->OnDemuxerFinished([&duration_ms](const uint8_t*, int, int frame_duration_ms, size_t) {
        duration_ms += static_cast<uint32_t>(std::max(5, std::min(120, frame_duration_ms)));
    });
    demuxer->Reset();
    demuxer->Process(reinterpret_cast<const uint8_t*>(audio.data()), audio.size());

    if (duration_ms == 0) {
        return kFallbackPlaybackMs;
    }
    return std::min(kMaxPlaybackWaitMs, duration_ms + kPlaybackTailMs);
}

void playback_task(void* param)
{
    std::unique_ptr<PlaybackTaskArg> arg(static_cast<PlaybackTaskArg*>(param));
    const uint32_t playback_ms = estimate_ogg_opus_duration_ms(arg->audio);
    const bool use_temp_volume = arg->volume >= 0;
    const uint8_t previous_volume = use_temp_volume ? embedded_runtime_bridge::board_get_speaker_volume() : 0;
    if (use_temp_volume) {
        embedded_runtime_bridge::board_set_speaker_volume(
            static_cast<uint8_t>(std::max(0, std::min(100, arg->volume))),
            false
        );
    }
    embedded_runtime_bridge::app_play_sound(std::string_view(arg->audio.data(), arg->audio.size()));
    vTaskDelay(pdMS_TO_TICKS(playback_ms));
    if (use_temp_volume) {
        embedded_runtime_bridge::board_set_speaker_volume(previous_volume, false);
    }
    if (arg->onFinished) {
        arg->onFinished(arg->requestId);
    }
    vTaskDelete(nullptr);
}

}  // namespace

bool start_audio_playback_task(std::string requestId, std::string audio, int volume,
                               AudioPlaybackFinishedCallback onFinished)
{
    auto arg = std::make_unique<PlaybackTaskArg>();
    arg->requestId = std::move(requestId);
    arg->volume = volume;
    arg->audio = std::move(audio);
    arg->onFinished = std::move(onFinished);

    if (xTaskCreate(&playback_task, "local_audio_playback", kPlaybackTaskStackBytes, arg.get(), 4, nullptr) != pdPASS) {
        return false;
    }
    arg.release();
    return true;
}

}  // namespace stackchan::hal::local_companion
