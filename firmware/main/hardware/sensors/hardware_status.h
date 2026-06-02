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

enum class ImuAttitudeQuality {
    Unavailable = 0,
    GyroAccel,
    GyroAccelMag,
    MagnetometerRejected,
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
        int direction = 1;
    };

    struct Control {
        float deadband       = 0.08f;
        PidAxis yaw          = {36.0f, 0.0f, 1.2f, 1};
        PidAxis pitch        = {8.0f, 0.0f, 0.15f, 1};
        float integralLimit  = 0.35f;
        float outputLimitDeg = 4.0f;
    };

    bool reserved     = false;
    bool detected     = false;
    float centerX     = 0.5f;
    float centerY     = 0.5f;
    float confidence  = 0.0f;
    int speed         = 300;
    Control control;
    uint32_t updatedAt = 0;
};

enum class LocalFaceTrackingControlAction {
    Applied = 0,
    Deadband,
    Ignored,
};

struct LocalFaceTrackingControlEvent {
    LocalFaceTrackingControlAction action = LocalFaceTrackingControlAction::Ignored;
    uint32_t uptimeMs = 0;
    uint32_t targetAgeMs = 0;
    float centerX = 0.5f;
    float centerY = 0.5f;
    float errorX = 0.0f;
    float errorY = 0.0f;
    int currentYaw = 0;
    int currentPitch = 0;
    int commandYaw = 0;
    int commandPitch = 0;
    int nextYaw = 0;
    int nextPitch = 0;
    int yawDelta = 0;
    int pitchDelta = 0;
    int requestedYawDelta = 0;
    int requestedPitchDelta = 0;
    int appliedYawStep = 0;
    int appliedPitchStep = 0;
    int maxYawStep = 0;
    int maxPitchStep = 0;
    float yawOutputDeg = 0.0f;
    float pitchOutputDeg = 0.0f;
    int yawDirection = 1;
    int pitchDirection = 1;
    int speed = 0;
    bool ackOk = true;
    int ackFailCount = 0;
    const char* reason = "";
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
    bool attitudeAvailable      = false;
    float attitudeQw            = 1.0f;
    float attitudeQx            = 0.0f;
    float attitudeQy            = 0.0f;
    float attitudeQz            = 0.0f;
    float attitudePitchDeg      = 0.0f;
    float attitudeRollDeg       = 0.0f;
    float attitudeYawDeg        = 0.0f;
    bool attitudeMagnetometerUsed = false;
    ImuAttitudeQuality attitudeQuality = ImuAttitudeQuality::Unavailable;
    float attitudeSampleHz      = 0.0f;
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
    std::string nfcReason = "not_detected_i2c_0x50";

    bool powerMonitorAvailable = false;
    float powerMonitorBusVoltage = 0.0f;
    float powerMonitorShuntVoltage = 0.0f;
    float powerMonitorCurrent = 0.0f;
    float powerMonitorPower = 0.0f;
    std::string powerMonitorReason = "not_detected_i2c_0x41";

    bool irAvailable = false;
    std::string irReason;

    bool proximityAvailable = false;
    uint16_t proximityValue = 0;
    uint16_t proximityRaw = 0;
    std::string proximityReason = "not_detected_i2c_0x23";

    bool ambientLightAvailable = false;
    float ambientLightLux = 0.0f;
    uint32_t ambientLightRaw = 0;
    std::string ambientLightReason = "not_detected_i2c_0x23";

    bool magnetometerAvailable = false;
    float magnetometerX = 0.0f;
    float magnetometerY = 0.0f;
    float magnetometerZ = 0.0f;
    int16_t magnetometerRawX = 0;
    int16_t magnetometerRawY = 0;
    int16_t magnetometerRawZ = 0;
    float magnetometerHeadingDeg = 0.0f;
    std::string magnetometerReason = "waiting_for_bmi270_aux";

    std::vector<LocalI2cScanStageSnapshot> i2cScans;
};

struct LocalNfcEvent {
    std::string action;
    uint32_t uptimeMs = 0;
    std::string uid;
    std::string tech;
    std::string atqa;
    int sak = -1;
    std::string reason;
};

struct LocalIrEvent {
    std::string action;
    uint32_t uptimeMs = 0;
    std::string protocol;
    std::string address;
    std::string command;
    std::string code;
    uint16_t bits = 0;
    bool repeat = false;
    std::string requestId;
    uint32_t carrierHz = 0;
    std::string reason;
};

enum class MicTestStatus {
    Starting = 0,
    Recording,
    Playing,
    Done,
    Failed,
};
