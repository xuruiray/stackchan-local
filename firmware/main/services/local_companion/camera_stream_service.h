/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once

#include <ArduinoJson.hpp>
#include <cstdint>
#include <string>

namespace stackchan::hal::local_companion {

struct CameraStreamConfig {
    bool enabled = false;
    uint32_t intervalMs = 250;
    int requestedWidth = 320;
    int requestedHeight = 240;
    int jpegQuality = 20;
    std::string fallbackReason;
};

struct CameraStreamApplyResult {
    bool wasEnabled = false;
    bool isEnabled = false;
};

CameraStreamApplyResult apply_camera_stream_command(CameraStreamConfig& config, ArduinoJson::JsonObject command);

}  // namespace stackchan::hal::local_companion
