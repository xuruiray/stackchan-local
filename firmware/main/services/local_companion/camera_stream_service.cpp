/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include "camera_stream_service.h"

#include <runtime_compat/embedded_runtime_bridge.h>
#include <algorithm>

namespace stackchan::hal::local_companion {

CameraStreamApplyResult apply_camera_stream_command(CameraStreamConfig& config, ArduinoJson::JsonObject command)
{
    CameraStreamApplyResult result;
    result.wasEnabled = config.enabled;

    const bool stream_enabled = command["enabled"] | false;
    int fps = command["fps"] | 4;
    fps = std::max(1, std::min(10, fps));

    config.requestedWidth = std::max(1, command["width"] | config.requestedWidth);
    config.requestedHeight = std::max(1, command["height"] | config.requestedHeight);
    config.jpegQuality = std::max(1, std::min(100, command["quality"] | config.jpegQuality));
    config.fallbackReason.clear();

    const bool unsupported_resolution = config.requestedWidth * config.requestedHeight > 320 * 240;
    if (unsupported_resolution) {
        config.requestedWidth = 320;
        config.requestedHeight = 240;
        config.jpegQuality = std::min(config.jpegQuality, 35);
        config.fallbackReason = "vga_disabled_for_stability";
    }

    config.intervalMs = 1000 / fps;
    config.enabled = false;

    auto camera = embedded_runtime_bridge::board_get_camera();
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
