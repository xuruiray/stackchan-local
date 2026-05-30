/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include "protocol_utils.h"

#include <algorithm>
#include <cstdio>
#include <ctime>
#include <cstring>
#include <mbedtls/base64.h>
#include <sys/time.h>

namespace stackchan::hal::local_companion {

bool decode_base64_to_string(const char* encoded, size_t encoded_len, std::string& decoded)
{
    if (encoded == nullptr || encoded_len == 0) {
        return false;
    }

    decoded.assign((encoded_len * 3) / 4 + 4, '\0');
    size_t decoded_len = 0;
    const int ret = mbedtls_base64_decode(reinterpret_cast<unsigned char*>(decoded.data()), decoded.size(),
                                          &decoded_len, reinterpret_cast<const unsigned char*>(encoded), encoded_len);
    if (ret != 0 || decoded_len == 0) {
        decoded.clear();
        return false;
    }
    decoded.resize(decoded_len);
    return true;
}

const char* known_command_kind_or_unknown(const char* kind)
{
    if (kind == nullptr) {
        return "unknown";
    }
    static constexpr const char* known[] = {
        "say",
        "react",
        "moveHead",
        "cameraStream",
        "trackFace",
        "playAnimation",
        "playAudioStart",
        "playAudioChunk",
        "playAudioEnd",
        "captureImage",
        "setMode",
        "setRgb",
        "telemetryConfig",
        "mediaFlowControl",
    };
    for (const auto* value : known) {
        if (strcmp(kind, value) == 0) {
            return kind;
        }
    }
    return "unknown";
}

std::string iso_now()
{
    timeval tv {};
    gettimeofday(&tv, nullptr);

    struct tm timeinfo;
    gmtime_r(&tv.tv_sec, &timeinfo);

    char buffer[32];
    const size_t date_len = strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%S", &timeinfo);
    if (date_len == 0 || date_len + 5 >= sizeof(buffer)) {
        return "1970-01-01T00:00:00.000Z";
    }
    std::snprintf(buffer + date_len, sizeof(buffer) - date_len, ".%03dZ", static_cast<int>(tv.tv_usec / 1000));
    return std::string(buffer);
}

LocalCompanionState mode_from_string(const char* mode)
{
    if (mode == nullptr) {
        return LocalCompanionState::Connected;
    }
    std::string value(mode);
    if (value == "idle") {
        return LocalCompanionState::Idle;
    }
    if (value == "connecting") {
        return LocalCompanionState::Connecting;
    }
    if (value == "listening") {
        return LocalCompanionState::Listening;
    }
    if (value == "thinking") {
        return LocalCompanionState::Thinking;
    }
    if (value == "speaking") {
        return LocalCompanionState::Speaking;
    }
    if (value == "sleeping") {
        return LocalCompanionState::Sleeping;
    }
    if (value == "pairing") {
        return LocalCompanionState::PairingFailed;
    }
    if (value == "error") {
        return LocalCompanionState::Error;
    }
    return LocalCompanionState::Connected;
}

const char* motion_event_to_string(ImuMotionEvent motion)
{
    switch (motion) {
        case ImuMotionEvent::Shake:
            return "shake";
        case ImuMotionEvent::PickUp:
            return "tilt";
        case ImuMotionEvent::None:
        default:
            return "none";
    }
}

const char* attitude_quality_to_string(ImuAttitudeQuality quality)
{
    switch (quality) {
        case ImuAttitudeQuality::GyroAccel:
            return "gyroAccel";
        case ImuAttitudeQuality::GyroAccelMag:
            return "gyroAccelMag";
        case ImuAttitudeQuality::MagnetometerRejected:
            return "magnetometerRejected";
        case ImuAttitudeQuality::Unavailable:
        default:
            return "unavailable";
    }
}

const char* head_touch_gesture_to_string(HeadPetGesture gesture)
{
    switch (gesture) {
        case HeadPetGesture::Press:
            return "press";
        case HeadPetGesture::Release:
            return "release";
        case HeadPetGesture::SwipeForward:
            return "swipeForward";
        case HeadPetGesture::SwipeBackward:
            return "swipeBackward";
        case HeadPetGesture::None:
        default:
            return "tap";
    }
}

float clamp_float(float value, float min_value, float max_value)
{
    return std::max(min_value, std::min(max_value, value));
}

int clamp_int(int value, int min_value, int max_value)
{
    return std::max(min_value, std::min(max_value, value));
}

static void update_pid_axis(LocalFaceTrackingTarget::PidAxis& axis, ArduinoJson::JsonObject source)
{
    if (source.isNull()) {
        return;
    }
    axis.kp = clamp_float(source["kp"] | axis.kp, 0.0f, 150.0f);
    axis.ki = clamp_float(source["ki"] | axis.ki, 0.0f, 50.0f);
    axis.kd = clamp_float(source["kd"] | axis.kd, 0.0f, 80.0f);
}

static void update_servo_range(LocalFaceTrackingTarget::ServoRange& range, ArduinoJson::JsonObject source)
{
    if (source.isNull()) {
        return;
    }
    range.yawMin   = clamp_int(source["yawMin"] | range.yawMin, -1800, 0);
    range.yawMax   = clamp_int(source["yawMax"] | range.yawMax, 0, 1800);
    range.pitchMin = clamp_int(source["pitchMin"] | range.pitchMin, -900, 1200);
    range.pitchMax = clamp_int(source["pitchMax"] | range.pitchMax, -900, 1200);
    if (range.yawMin > range.yawMax) {
        std::swap(range.yawMin, range.yawMax);
    }
    if (range.pitchMin > range.pitchMax) {
        std::swap(range.pitchMin, range.pitchMax);
    }
}

void update_tracking_control(LocalFaceTrackingTarget::Control& control, ArduinoJson::JsonObject source)
{
    if (source.isNull()) {
        return;
    }
    control.deadband       = clamp_float(source["deadband"] | control.deadband, 0.0f, 0.3f);
    control.integralLimit  = clamp_float(source["integralLimit"] | control.integralLimit, 0.0f, 2.0f);
    control.outputLimitDeg = clamp_float(source["outputLimitDeg"] | control.outputLimitDeg, 1.0f, 45.0f);
    update_pid_axis(control.yaw, source["yaw"].as<ArduinoJson::JsonObject>());
    update_pid_axis(control.pitch, source["pitch"].as<ArduinoJson::JsonObject>());
    update_servo_range(control.servoRange, source["servoRange"].as<ArduinoJson::JsonObject>());
}

}  // namespace stackchan::hal::local_companion
