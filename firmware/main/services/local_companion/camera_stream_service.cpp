/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include "camera_stream_service.h"

#include <hardware/camera/camera_device.h>
#include <hardware/registry.h>
#include <algorithm>

namespace stackchan::hal::local_companion {

namespace {
constexpr int kSupportedCameraWidth = 320;
constexpr int kSupportedCameraHeight = 240;
}  // namespace

CameraStreamApplyResult apply_camera_stream_command(CameraStreamConfig& config, ArduinoJson::JsonObject command)
{
    CameraStreamApplyResult result;
    result.wasEnabled = config.enabled;

    const bool stream_enabled = command["enabled"] | false;
    int fps = command["fps"] | 4;
    fps = std::max(1, std::min(15, fps));

    const int requested_width = std::max(1, command["width"] | kSupportedCameraWidth);
    const int requested_height = std::max(1, command["height"] | kSupportedCameraHeight);
    const bool unsupported_resolution = requested_width != kSupportedCameraWidth || requested_height != kSupportedCameraHeight;
    config.requestedWidth = kSupportedCameraWidth;
    config.requestedHeight = kSupportedCameraHeight;
    config.jpegQuality = std::max(1, std::min(100, command["quality"] | config.jpegQuality));
    config.fallbackReason.clear();
    if (unsupported_resolution) {
        config.fallbackReason = "unsupported_resolution";
    }

    config.intervalMs = 1000 / fps;
    config.enabled = false;

    auto camera = stackchan::hal::hardware::GetHardwareRegistry().camera();
    if (camera) {
        const bool width_matches =
            camera->GetFrameWidth() <= 0 || camera->GetFrameWidth() == config.requestedWidth;
        const bool height_matches =
            camera->GetFrameHeight() <= 0 || camera->GetFrameHeight() == config.requestedHeight;
        if (!width_matches || !height_matches) {
            const bool resized = camera->SetFrameSize(config.requestedWidth, config.requestedHeight);
            const bool actual_width_matches =
                camera->GetFrameWidth() <= 0 || camera->GetFrameWidth() == config.requestedWidth;
            const bool actual_height_matches =
                camera->GetFrameHeight() <= 0 || camera->GetFrameHeight() == config.requestedHeight;
            if (!resized || !actual_width_matches || !actual_height_matches) {
                config.fallbackReason = "runtime_resolution_change_failed";
            }
        }
    } else {
        config.fallbackReason = "driver_unavailable";
    }

    config.enabled = stream_enabled;
    result.isEnabled = config.enabled;
    return result;
}

}  // namespace stackchan::hal::local_companion
