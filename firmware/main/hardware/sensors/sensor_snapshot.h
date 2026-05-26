/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once

#include <array>
#include <cstdint>
#include <string>
#include <vector>

enum class HeadPetGesture { None, Press, Release, SwipeForward, SwipeBackward };

enum class ImuMotionEvent {
    None = 0,
    Shake,
    PickUp,
};

enum class LocalCompanionState {
    Idle = 0,
    Connecting,
    Connected,
    Listening,
    Thinking,
    Speaking,
    Sleeping,
    PairingFailed,
    Disconnected,
    Error,
};

struct LocalFaceTrackingTarget {
    struct PidAxis {
        float kp = 0.0f;
        float ki = 0.0f;
        float kd = 0.0f;
    };

    struct ServoRange {
        int yawMin   = -1280;
        int yawMax   = 1280;
        int pitchMin = 0;
        int pitchMax = 900;
    };

    struct Control {
        float deadband       = 0.045f;
        PidAxis yaw          = {42.0f, 0.0f, 8.0f};
        PidAxis pitch        = {30.0f, 0.0f, 6.0f};
        float integralLimit  = 0.35f;
        float outputLimitDeg = 20.0f;
        ServoRange servoRange;
    };

    bool reserved       = false;
    bool detected       = false;
    bool recenterOnLost = false;
    float centerX       = 0.5f;
    float centerY       = 0.5f;
    float confidence    = 0.0f;
    int speed           = 420;
    Control control;
    uint32_t updatedAt = 0;
};

struct LocalImuSnapshot {
    bool available              = false;
    float x                     = 0.0f;
    float y                     = 0.0f;
    float z                     = 0.0f;
    float gyroX                 = 0.0f;
    float gyroY                 = 0.0f;
    float gyroZ                 = 0.0f;
    bool magnetometerAvailable  = false;
    float magnetometerX         = 0.0f;
    float magnetometerY         = 0.0f;
    float magnetometerZ         = 0.0f;
    int16_t magnetometerRawX    = 0;
    int16_t magnetometerRawY    = 0;
    int16_t magnetometerRawZ    = 0;
    float magnetometerHeadingDeg = 0.0f;
    ImuMotionEvent motion       = ImuMotionEvent::None;
    uint32_t updatedAt          = 0;
};

struct LocalHeadTouchSnapshot {
    bool available = false;
    bool pressed = false;
    std::array<uint8_t, 3> intensity = {0, 0, 0};
    HeadPetGesture gesture = HeadPetGesture::None;
    uint32_t updatedAt = 0;
};

struct LocalMicLevelSnapshot {
    bool available = false;
    uint8_t channels = 0;
    float level = 0.0f;
    float rms = 0.0f;
    float peak = 0.0f;
    float dbfs = -96.0f;
    uint32_t updatedAt = 0;
    std::string reason;
};

struct LocalI2cScanStageSnapshot {
    std::array<char, 32> stage = {};
    uint32_t uptimeMs = 0;
    std::vector<uint8_t> addresses;
    bool foundLtr553 = false;
    bool foundIna226 = false;
    bool foundNfc = false;
    std::string reason;
};

struct LocalPeripheralProbeSnapshot {
    bool nfcAvailable = false;
    uint8_t nfcAddress = 0x50;
    std::string nfcDriver = "st25r3916-probe";
    std::string nfcStatus;
    std::string nfcReason = "not_detected_i2c_0x50";

    bool powerMonitorAvailable = false;
    uint8_t powerMonitorAddress = 0x41;
    float powerMonitorBusVoltage = 0.0f;
    float powerMonitorShuntVoltage = 0.0f;
    float powerMonitorCurrent = 0.0f;
    float powerMonitorPower = 0.0f;
    std::string powerMonitorDriver = "ina226";
    std::string powerMonitorReason = "not_detected_i2c_0x41";

    bool irAvailable = false;
    int irTxPin = 5;
    int irRxPin = 10;
    std::string irDriver = "gpio-ir-basic";
    std::string irReason;

    bool proximityAvailable = false;
    uint16_t proximityValue = 0;
    uint16_t proximityRaw = 0;
    std::string proximityDriver = "ltr553";
    std::string proximityReason = "not_detected_i2c_0x23";

    bool ambientLightAvailable = false;
    float ambientLightLux = 0.0f;
    uint32_t ambientLightRaw = 0;
    std::string ambientLightDriver = "ltr553";
    std::string ambientLightReason = "not_detected_i2c_0x23";

    bool magnetometerAvailable = false;
    float magnetometerX = 0.0f;
    float magnetometerY = 0.0f;
    float magnetometerZ = 0.0f;
    int16_t magnetometerRawX = 0;
    int16_t magnetometerRawY = 0;
    int16_t magnetometerRawZ = 0;
    float magnetometerHeadingDeg = 0.0f;
    std::string magnetometerDriver = "bmi270-aux-bmm150";
    std::string magnetometerReason = "waiting_for_bmi270_aux";

    std::vector<LocalI2cScanStageSnapshot> i2cScans;
};

enum class MicTestStatus {
    Starting = 0,
    Recording,
    Playing,
    Done,
    Failed,
};
