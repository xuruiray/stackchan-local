/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once

#include <functional>
#include <string>

namespace stackchan::hal::local_companion {

using AudioPlaybackFinishedCallback = std::function<void(std::string requestId)>;

bool start_audio_playback_task(std::string requestId, std::string audio, int volume,
                               AudioPlaybackFinishedCallback onFinished);

}  // namespace stackchan::hal::local_companion
