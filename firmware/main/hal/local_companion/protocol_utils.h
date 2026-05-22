/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once

#include "../sensors/sensor_types.h"

#include <ArduinoJson.hpp>
#include <cstddef>
#include <string>

namespace stackchan::hal::local_companion {

bool decode_base64_to_string(const char* encoded, size_t encoded_len, std::string& decoded);
const char* known_command_kind_or_unknown(const char* kind);
std::string iso_now();
LocalCompanionState mode_from_string(const char* mode);
const char* motion_event_to_string(ImuMotionEvent motion);
const char* head_touch_gesture_to_string(HeadPetGesture gesture);
float clamp_float(float value, float min_value, float max_value);
int clamp_int(int value, int min_value, int max_value);
void update_tracking_control(LocalFaceTrackingTarget::Control& control, ArduinoJson::JsonObject source);

}  // namespace stackchan::hal::local_companion
