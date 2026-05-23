/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include "audio_playback_service.h"

#include <runtime_compat/embedded_runtime_bridge.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <memory>

namespace stackchan::hal::local_companion {
namespace {

struct PlaybackTaskArg {
    std::string requestId;
    int volume = -1;
    std::string audio;
    AudioPlaybackFinishedCallback onFinished;
};

void playback_task(void* param)
{
    std::unique_ptr<PlaybackTaskArg> arg(static_cast<PlaybackTaskArg*>(param));
    embedded_runtime_bridge::app_play_sound_and_wait(std::string_view(arg->audio.data(), arg->audio.size()), arg->volume);
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

    if (xTaskCreate(&playback_task, "local_audio_playback", 8192, arg.get(), 4, nullptr) != pdPASS) {
        return false;
    }
    arg.release();
    return true;
}

}  // namespace stackchan::hal::local_companion
