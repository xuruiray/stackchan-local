/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once
#include <memory>
#include <cstdint>
#include <string>
#include <lvgl.h>
#include <functional>
#include <smooth_ui_toolkit.hpp>
#include <uitk/short_namespace.hpp>
#include <smooth_lvgl.hpp>
#include <array>
#include <vector>
#include <lvgl_image.h>
#include <string_view>

/**
 * @brief
 *
 */
enum class HeadPetGesture { None, Press, Release, SwipeForward, SwipeBackward };

/**
 * @brief
 *
 */
enum class WsSignalSource {
    Local = 0,
    Remote,
};

/**
 * @brief
 *
 */
struct WsTextMessage_t {
    std::string name;
    std::string content;
};

struct WsReactMessage_t {
    std::string emotion;
    uint32_t durationMs = 2000;
    std::string avatarJson;
    std::string rgbJson;
};

/**
 * @brief
 *
 */
enum class ImuMotionEvent {
    None = 0,
    Shake,
    PickUp,
};

/**
 * @brief
 *
 */
enum class AppConfigEvent {
    None = 0,
    AppConnected,
    AppDisconnected,
    TryWifiConnect,
    WifiConnectFailed,
    WifiConnected,
};

/**
 * @brief
 *
 */
enum class CommonLogLevel {
    Info = 0,
    Warning,
    Error,
};

/**
 * @brief
 *
 */
namespace app_center {

struct AppInfo_t {
    std::string name;
    std::string iconUrl;
    std::string description;
    std::string firmwareUrl;
};

using AppInfoList_t = std::vector<AppInfo_t>;

};  // namespace app_center

/**
 * @brief
 *
 */
enum class WifiStatus {
    None = 0,
    Low,
    Medium,
    High,
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

    bool reserved     = false;
    bool detected     = false;
    bool recenterOnLost = false;
    float centerX     = 0.5f;
    float centerY     = 0.5f;
    float confidence  = 0.0f;
    int speed         = 420;
    Control control;
    uint32_t updatedAt = 0;
};

struct LocalImuSnapshot {
    bool available       = false;
    float x              = 0.0f;
    float y              = 0.0f;
    float z              = 0.0f;
    float gyroX          = 0.0f;
    float gyroY          = 0.0f;
    float gyroZ          = 0.0f;
    bool magnetometerAvailable = false;
    float magnetometerX = 0.0f;
    float magnetometerY = 0.0f;
    float magnetometerZ = 0.0f;
    int16_t magnetometerRawX = 0;
    int16_t magnetometerRawY = 0;
    int16_t magnetometerRawZ = 0;
    float magnetometerHeadingDeg = 0.0f;
    ImuMotionEvent motion = ImuMotionEvent::None;
    uint32_t updatedAt   = 0;
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
    std::string stage;
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

/**
 * @brief
 *
 */
struct UserAccountInfo_t {
    std::string username;
    std::string deviceName;
};

/**
 * @brief
 *
 */
struct XiaozhiConfig_t {
    uint32_t idleShutdownTimeSeconds = 600;
    bool allowShutdownWhenCharging   = false;
    uint8_t idleRandomMovementLevel  = 2;
};

/**
 * @brief
 *
 */
enum class MicTestStatus {
    Starting = 0,
    Recording,
    Playing,
    Done,
    Failed,
};

/**
 * @brief
 *
 */
class BootLogo {
public:
    BootLogo()
    {
        _panel = std::make_unique<uitk::lvgl_cpp::Container>(lv_screen_active());
        _panel->setSize(320, 240);
        _panel->setAlign(LV_ALIGN_CENTER);
        _panel->setBorderWidth(0);
        _panel->setBgOpa(0);
        _panel->setPaddingAll(0);

        _label_logo = std::make_unique<uitk::lvgl_cpp::Label>(_panel->get());
        _label_logo->setTextFont(&lv_font_montserrat_24);
        _label_logo->setTextColor(lv_color_hex(0xFFFFFF));
        _label_logo->align(LV_ALIGN_CENTER, 0, -14);
        _label_logo->setText("STACKCHAN");

        _label_msg = std::make_unique<uitk::lvgl_cpp::Label>(_panel->get());
        _label_msg->setTextFont(&lv_font_montserrat_16);
        _label_msg->setTextColor(lv_color_hex(0xBFBFBF));
        _label_msg->align(LV_ALIGN_CENTER, 0, 14);
        _label_msg->setText("Starting up ...");

        _label_version = std::make_unique<uitk::lvgl_cpp::Label>(_panel->get());
        _label_version->setTextFont(&lv_font_montserrat_14);
        _label_version->setTextColor(lv_color_hex(0x8B8B8B));
        _label_version->align(LV_ALIGN_BOTTOM_RIGHT, -7, -6);
        _label_version->setText("V" FIRMWARE_VERSION);
    }

private:
    std::unique_ptr<uitk::lvgl_cpp::Container> _panel;
    std::unique_ptr<uitk::lvgl_cpp::Label> _label_logo;
    std::unique_ptr<uitk::lvgl_cpp::Label> _label_msg;
    std::unique_ptr<uitk::lvgl_cpp::Label> _label_version;
};

/**
 * @brief
 *
 */
class Hal {
public:
    void init();

    /* --------------------------------- System --------------------------------- */
    void delay(std::uint32_t ms);
    std::uint32_t millis();
    void feedTheDog();
    std::array<uint8_t, 6> getFactoryMac();
    std::string getFactoryMacString(std::string divider = "");
    void reboot();
    void powerOff();
    void updateHeapStatusLog();
    uint8_t getBatteryLevel();
    bool isBatteryCharging();
    void factoryReset();

    /* --------------------------------- Display -------------------------------- */
    lv_indev_t* lvTouchpad = nullptr;
    std::unique_ptr<BootLogo> bootLogo;
    void lvglLock();
    void lvglUnlock();
    void setBackLightBrightness(uint8_t brightness, bool permanent = false);
    uint8_t getBackLightBrightness();

    /* --------------------------------- Xiaozhi -------------------------------- */
    void requestXiaozhiStart()
    {
        // Legacy cloud runtime is disabled in StackChan Local.
    }
    bool isXiaozhiStartRequested()
    {
        return false;
    }
    void startXiaozhi();
    XiaozhiConfig_t getXiaozhiConfig();
    void setXiaozhiConfig(XiaozhiConfig_t config);

    /* ----------------------------------- BLE ---------------------------------- */
    uitk::Signal<const char*> onBleMotionData;
    uitk::Signal<const char*> onBleAvatarData;
    uitk::Signal<const char*> onBleConfigData;
    uitk::Signal<const char*> onBleRgbData;
    uitk::Signal<AppConfigEvent> onAppConfigEvent;

    void startBleServer();
    bool isBleConnected();
    void startAppConfigServer();
    bool isAppConfiged();
    void resetAppConfiged();

    /* --------------------------------- HeadPet -------------------------------- */
    uitk::Signal<HeadPetGesture> onHeadPetGesture;
    LocalHeadTouchSnapshot getLocalHeadTouchSnapshot();

    /* ----------------------------------- RGB ---------------------------------- */
    void setRgbColor(uint8_t index, uint8_t r, uint8_t g, uint8_t b);
    void showRgbColor(uint8_t r, uint8_t g, uint8_t b);
    void refreshRgb();

    /* ---------------------------------- Power --------------------------------- */
    void setServoPowerEnabled(bool enabled);
    bool isServoPowerEnabled();
    bool isIoExpanderAvailable();

    /* -------------------------------- Websocket ------------------------------- */
    uitk::Signal<std::string_view> onWsMotionData;
    uitk::Signal<std::string_view> onWsAvatarData;
    uitk::Signal<std::string> onWsCallRequest;
    uitk::Signal<bool> onWsCallResponse;
    uitk::Signal<WsSignalSource> onWsCallEnd;
    uitk::Signal<const WsTextMessage_t&> onWsTextMessage;
    uitk::Signal<const WsReactMessage_t&> onWsReactMessage;
    uitk::Signal<bool> onWsVideoModeChange;
    uitk::Signal<std::shared_ptr<LvglImage>> onWsVideoFrame;
    uitk::Signal<std::string_view> onWsDanceData;
    uitk::Signal<CommonLogLevel, std::string_view> onWsLog;
    uitk::Signal<const char*> onLocalCompanionActivity;

    void startWebSocketAvatarService(std::function<void(std::string_view)> onStartLog);

    /* ---------------------------- Local Companion ---------------------------- */
    void startLocalCompanionService(std::function<void(std::string_view)> onStartLog);
    LocalCompanionState getLocalCompanionState();
    LocalFaceTrackingTarget getLocalFaceTrackingTarget();

    /* ----------------------------------- IMU ---------------------------------- */
    uitk::Signal<ImuMotionEvent> onImuMotionEvent;
    LocalImuSnapshot getLocalImuSnapshot();

    /* ---------------------------------- Time ---------------------------------- */
    void syncRtcTimeToSystem();
    void syncSystemTimeToRtc();
    void setTimezone(std::string_view tz);
    std::string getTimezone();

    /* --------------------------------- EspNow --------------------------------- */
    uitk::Signal<const std::vector<uint8_t>&> onEspNowData;
    void startEspNow(int channel);
    bool espNowSend(const std::vector<uint8_t>& data, const uint8_t* destAddr = nullptr);
    void setLaserEnabled(bool enabled);

    /* ------------------------------- Warm Reboot ------------------------------ */
    void requestWarmReboot(int appIndex);
    int getWarmRebootTarget();
    void clearWarmRebootRequest();

    /* --------------------------------- Network -------------------------------- */
    void startNetwork(std::function<void(std::string_view)> onLog);
    WifiStatus getWifiStatus();
    void startSntp();

    /* -------------------------------- App center ------------------------------- */
    app_center::AppInfoList_t fetchAppList();
    void launchApp(std::string_view url, std::function<void(int)> onProgress);

    /* --------------------------------- EzData --------------------------------- */
    void startEzDataService(std::function<void(std::string_view)> onStartLog);
    uitk::Signal<std::string_view> onEzdataPairCode;

    /* ------------------------------- User Acount ------------------------------ */
    UserAccountInfo_t getUserAccountInfo();
    bool updateAccountInfo(std::function<void(std::string_view)> onLog);
    bool unbindAccount(std::function<void(std::string_view)> onLog);

    /* ----------------------------------- OTA ---------------------------------- */
    bool updateFirmware(std::function<void(std::string_view)> onLog);

    /* ---------------------------------- Audio --------------------------------- */
    void setSpeakerVolume(uint8_t volume, bool permanent = false);
    uint8_t getSpeakerVolume();
    std::string startMicTest(std::function<void(MicTestStatus)> onStatusUpdate);
    void getMicWaveformFrame(std::vector<int16_t>& data);
    LocalMicLevelSnapshot getMicLevelSnapshot();
    void clearupMicTest();
    LocalPeripheralProbeSnapshot getLocalPeripheralProbeSnapshot();

private:
    void xiaozhi_board_init();
    void lvgl_init();
    void ble_init(bool useAltUuid);
    void servo_init();
    void head_touch_init();
    void io_expander_init();
    void imu_init();
    void rtc_init();
    void peripheral_probe_init();
    void recordI2cDiagnosticScan(std::string_view stage);
};

Hal& GetHAL();

/**
 * @brief
 *
 */
class LvglLockGuard {
public:
    LvglLockGuard()
    {
        GetHAL().lvglLock();
    }
    ~LvglLockGuard()
    {
        GetHAL().lvglUnlock();
    }
};
