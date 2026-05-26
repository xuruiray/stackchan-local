/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include "local_companion_service.h"
#include <system/device_runtime.h>

#include <system/runtime_bridge/embedded_runtime_bridge.h>
#include <hardware/camera/camera_device.h>
#include <hardware/registry.h>
#include "audio_playback_service.h"
#include "camera_stream_service.h"
#include "command_dispatcher.h"
#include "protocol_utils.h"
#include "telemetry_service.h"
#include <ArduinoJson.hpp>
#include <assets/assets.h>
#include <system/legacy_runtime/board/board.h>
#include <esp_app_desc.h>
#include <esp_err.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <mbedtls/base64.h>
#include <mdns.h>
#include <mooncake.h>
#include <mooncake_log.h>
#include <system/core/settings.h>
#include <services/expression_motion/stackchan.h>
#include <web_socket.h>
#include <wifi_manager.h>
#include <jpg/image_to_jpeg.h>
#include <lwip/ip_addr.h>
#include <algorithm>
#include <atomic>
#include <cctype>
#include <cstdint>
#include <ctime>
#include <cstring>
#include <deque>
#include <mutex>
#include <queue>
#include <string>
#include <vector>

static const std::string _tag = "LocalCompanion";
static LocalCompanionState _local_state = LocalCompanionState::Idle;
static std::mutex _face_tracking_mutex;
static LocalFaceTrackingTarget _face_tracking_target;
static uint32_t _face_tracking_hold_until = 0;
static constexpr const char* _default_daemon_url = "ws://192.168.1.254:8787/stackchan/local";
static constexpr const char* _local_service_type = "_stackchan-local";
static constexpr const char* _local_service_proto = "_tcp";

namespace {

struct ReceivedMessage {
    bool binary;
    std::vector<uint8_t> data;
};

struct AudioTransferState {
    bool active = false;
    std::string requestId;
    std::string text;
    size_t totalBytes = 0;
    size_t totalChunks = 0;
    size_t nextChunkIndex = 0;
    int volume = -1;
    std::string audio;
};

struct PlaybackEvent {
    std::string requestId;
    std::string state;
    std::string message;
};

enum class OutboundPriority : uint8_t {
    Critical = 0,
    Normal = 1,
    Camera = 2,
};

struct OutboundMessage {
    OutboundPriority priority = OutboundPriority::Normal;
    bool binary = false;
    bool cameraFrame = false;
    std::string text;
    std::vector<uint8_t> bytes;
    uint32_t cameraTotalStartMs = 0;
    uint32_t cameraJpegBytes = 0;
};

struct PowerTelemetryCache {
    uint8_t batteryLevel = 100;
    bool charging = false;
    uint8_t backlight = 0;
    uint8_t speakerVolume = 0;
};

struct NetworkTelemetryCache {
    std::string wifiStatus = "disconnected";
    int rssi = 0;
    std::string ssid;
    bool bleConnected = false;
};

struct ServoTelemetryCache {
    bool ioExpanderAvailable = false;
    bool servoPower = false;
    float yawAngle = 0.0f;
    bool yawMoving = false;
    bool yawTorque = false;
    float pitchAngle = 0.0f;
    bool pitchMoving = false;
    bool pitchTorque = false;
};

struct SensorTelemetryCacheCopy {
    LocalHeadTouchSnapshot headTouch;
    LocalImuSnapshot imu;
    LocalMicLevelSnapshot mic;
    LocalPeripheralProbeSnapshot peripherals;
    PowerTelemetryCache power;
    NetworkTelemetryCache network;
    ServoTelemetryCache servo;
    bool includeI2cScan = true;
    uint8_t adaptiveLevel = 0;
};

struct CameraTelemetryCopy {
    bool streaming = false;
    int requestedWidth = 0;
    int requestedHeight = 0;
    int actualWidth = 0;
    int actualHeight = 0;
    int jpegQuality = 0;
    uint32_t intervalMs = 0;
    std::string fallbackReason;
    bool binaryFrameEnabled = false;
    uint32_t lastCaptureMs = 0;
    uint32_t lastEncodeMs = 0;
    uint32_t lastSendMs = 0;
    uint32_t lastTotalMs = 0;
    uint32_t lastFrameIntervalMs = 0;
    uint32_t lastJpegBytes = 0;
};

static constexpr size_t kMaxAudioBytes = 262144;
static constexpr size_t kMaxAudioChunkBase64Bytes = 8192;
static constexpr size_t kMaxAudioChunks = 128;
static constexpr uint32_t kImuCacheIntervalMs = 250;
static constexpr uint32_t kHeadTouchCacheIntervalMs = 250;
static constexpr uint32_t kPowerCacheIntervalMs = 1000;
static constexpr uint32_t kNetworkCacheIntervalMs = 1000;
static constexpr uint32_t kServoCacheIntervalMs = 1000;
static constexpr uint32_t kMicCacheIntervalMs = 1000;
static constexpr uint32_t kPeripheralCacheIntervalMs = 1000;
static constexpr uint32_t kDefaultHeartbeatIntervalMs = 15000;
static constexpr uint32_t kMinHeartbeatIntervalMs = 1000;
static constexpr uint32_t kMaxHeartbeatIntervalMs = 60000;
static constexpr uint8_t kBinaryCameraFrameKind = 0x01;
static constexpr int kDefaultCameraCreditFrames = 2;
static constexpr int kMaxCameraCreditFrames = 12;
static constexpr uint32_t kWorkerTickIntervalMs = 10;
static constexpr uint32_t kCameraTaskTickIntervalMs = 20;
static constexpr uint32_t kCameraTaskActiveYieldMs = 20;
static constexpr uint32_t kSensorTaskTickIntervalMs = 20;
static constexpr uint32_t kTxTaskIdleIntervalMs = 20;
static constexpr size_t kCriticalTxQueueMax = 48;
static constexpr size_t kNormalTxQueueMax = 48;
static constexpr size_t kCameraTxQueueMax = 2;
static constexpr int kWebSocketTimeoutSeconds = 3;

using namespace stackchan::hal::local_companion;

TickType_t delay_ticks(uint32_t milliseconds)
{
    return std::max<TickType_t>(1, pdMS_TO_TICKS(milliseconds));
}

bool ensure_mdns_started()
{
    static bool started = false;
    if (started) {
        return true;
    }

    const esp_err_t err = mdns_init();
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        mclog::tagWarn(_tag, "mDNS init failed: {}", esp_err_to_name(err));
        return false;
    }

    std::string hostname = "stackchan-" + GetDeviceRuntime().getFactoryMacString("");
    for (char& ch : hostname) {
        if (ch == ':') {
            ch = '-';
        }
    }
    mdns_hostname_set(hostname.c_str());
    mdns_instance_name_set("StackChan Local Companion");
    started = true;
    return true;
}

std::string discover_daemon_url()
{
    if (!ensure_mdns_started()) {
        return {};
    }

    mdns_result_t* results = nullptr;
    const esp_err_t err = mdns_query_ptr(_local_service_type, _local_service_proto, 1500, 5, &results);
    if (err != ESP_OK || results == nullptr) {
        if (err != ESP_OK && err != ESP_ERR_NOT_FOUND) {
            mclog::tagWarn(_tag, "mDNS daemon query failed: {}", esp_err_to_name(err));
        }
        return {};
    }

    std::string discovered_url;
    for (mdns_result_t* result = results; result != nullptr && discovered_url.empty(); result = result->next) {
        for (mdns_ip_addr_t* addr = result->addr; addr != nullptr; addr = addr->next) {
            if (addr->addr.type != IPADDR_TYPE_V4) {
                continue;
            }

            char ip[16] = {};
            snprintf(ip, sizeof(ip), IPSTR, IP2STR(&addr->addr.u_addr.ip4));

            char url[96] = {};
            snprintf(url, sizeof(url), "ws://%s:%u/stackchan/local", ip, result->port);
            discovered_url = url;
            break;
        }
    }

    mdns_query_results_free(results);
    return discovered_url;
}

uint8_t clamp_percent(int value)
{
    return static_cast<uint8_t>(std::max(0, std::min(100, value)));
}

bool time_due(uint32_t now, uint32_t due_at)
{
    return due_at == 0 || static_cast<int32_t>(now - due_at) >= 0;
}

class LocalCompanionSocket {
public:
    ~LocalCompanionSocket()
    {
        stop_background_tasks();
        clear_tx_queue();
        if (_head_touch_connection >= 0) {
            GetDeviceRuntime().onHeadPetGesture.disconnect(_head_touch_connection);
            _head_touch_connection = -1;
        }
    }

    void init(std::function<void(std::string_view)> onStartLog)
    {
        _on_start_log = std::move(onStartLog);

        Settings settings("stackchan_local", false);
        _fallback_url = settings.GetString("url", _default_daemon_url);
        _token        = settings.GetString("token", "dev-local-token");
        _use_mdns     = settings.GetBool("mdns", true);

        _head_touch_connection = GetDeviceRuntime().onHeadPetGesture.connect([this](HeadPetGesture gesture) {
            std::lock_guard<std::mutex> lock(_sensor_mutex);
            _pending_head_touch     = gesture;
            _has_pending_head_touch = true;
        });

        start_background_tasks();
        connect();
    }

    void update()
    {
        if (!has_websocket()) {
            reconnect_if_needed();
            return;
        }

        if (!websocket_connected()) {
            reconnect_if_needed();
            return;
        }

        process_messages();
        send_pending_playback_events();

        const auto now = GetDeviceRuntime().millis();
        if (now - _last_heartbeat_time > _heartbeat_interval_ms) {
            send_heartbeat();
            _last_heartbeat_time = now;
        }
    }

private:
    std::unique_ptr<WebSocket> _websocket;
    std::string _url;
    std::string _fallback_url;
    std::string _token;
    std::function<void(std::string_view)> _on_start_log;
    std::mutex _websocket_mutex;
    std::mutex _mutex;
    std::mutex _sensor_mutex;
    std::mutex _playback_event_mutex;
    std::mutex _sequence_mutex;
    std::mutex _telemetry_mutex;
    std::mutex _tx_mutex;
    std::queue<ReceivedMessage> _msg_queue;
    std::queue<PlaybackEvent> _playback_events;
    std::deque<OutboundMessage> _tx_critical;
    std::deque<OutboundMessage> _tx_normal;
    std::deque<OutboundMessage> _tx_camera;
    AudioTransferState _audio_transfer;
    uint32_t _last_reconnect_attempt = 0;
    uint32_t _last_heartbeat_time    = 0;
    uint32_t _heartbeat_interval_ms  = kDefaultHeartbeatIntervalMs;
    uint32_t _last_camera_frame_time = 0;
    uint32_t _last_battery_event_time = 0;
    uint32_t _last_wifi_event_time = 0;
    uint32_t _last_imu_event_time = 0;
    uint32_t _last_sensor_snapshot_event_time = 0;
    uint32_t _sensor_snapshot_interval_ms = 1000;
    uint32_t _imu_event_interval_ms = 250;
    uint32_t _last_screen_touch_event_time = 0;
    uint32_t _next_imu_cache_time = 0;
    uint32_t _next_head_touch_cache_time = 0;
    uint32_t _next_power_cache_time = 0;
    uint32_t _next_network_cache_time = 0;
    uint32_t _next_servo_cache_time = 0;
    uint32_t _next_mic_cache_time = 0;
    uint32_t _next_peripheral_cache_time = 0;
    uint32_t _camera_frame_id = 0;
    uint32_t _outgoing_seq = 0;
    std::mutex _camera_mutex;
    std::mutex _camera_hardware_mutex;
    CameraStreamConfig _camera_stream;
    bool _rgb_control_enabled = false;
    std::string _rgb_control_color = "#000000";
    float _rgb_control_brightness = 1.0f;
    embedded_runtime_bridge::TouchPoint_t _last_screen_touch;
    HeadPetGesture _pending_head_touch = HeadPetGesture::None;
    LocalHeadTouchSnapshot _head_touch_cache;
    LocalImuSnapshot _imu_cache;
    LocalMicLevelSnapshot _mic_cache;
    LocalPeripheralProbeSnapshot _peripheral_cache;
    PowerTelemetryCache _power_cache;
    NetworkTelemetryCache _network_cache;
    ServoTelemetryCache _servo_cache;
    int _head_touch_connection = -1;
    bool _use_mdns                   = true;
    bool _last_screen_touch_valid    = false;
    bool _has_pending_head_touch     = false;
    bool _sensor_cache_initialized   = false;
    bool _binary_camera_frame_enabled = false;
    bool _camera_credit_enabled = false;
    int _camera_credit_frames = 0;
    int _camera_max_in_flight = kDefaultCameraCreditFrames;
    uint32_t _last_camera_capture_ms = 0;
    uint32_t _last_camera_encode_ms = 0;
    uint32_t _last_camera_send_ms = 0;
    uint32_t _last_camera_total_ms = 0;
    uint32_t _last_camera_frame_interval_ms = 0;
    uint32_t _last_camera_sent_at_ms = 0;
    uint32_t _last_camera_jpeg_bytes = 0;
    bool _include_i2c_scan = true;
    uint8_t _adaptive_level = 0;
    std::atomic<bool> _tasks_running{false};
    TaskHandle_t _tx_task_handle = nullptr;
    TaskHandle_t _camera_task_handle = nullptr;
    TaskHandle_t _sensor_task_handle = nullptr;

    uint32_t next_outgoing_seq()
    {
        std::lock_guard<std::mutex> lock(_sequence_mutex);
        return _outgoing_seq++;
    }

    uint32_t next_camera_frame_id()
    {
        std::lock_guard<std::mutex> lock(_sequence_mutex);
        return _camera_frame_id++;
    }

    bool has_websocket()
    {
        std::lock_guard<std::mutex> lock(_websocket_mutex);
        return _websocket != nullptr;
    }

    bool websocket_connected()
    {
        std::lock_guard<std::mutex> lock(_websocket_mutex);
        return _websocket && _websocket->IsConnected();
    }

    bool websocket_send_text(const std::string& payload)
    {
        std::lock_guard<std::mutex> lock(_websocket_mutex);
        return _websocket && _websocket->IsConnected() && _websocket->Send(payload.c_str(), payload.size());
    }

    bool websocket_send_binary(const std::vector<uint8_t>& payload)
    {
        std::lock_guard<std::mutex> lock(_websocket_mutex);
        return _websocket && _websocket->IsConnected() &&
               _websocket->SendBinary(reinterpret_cast<const char*>(payload.data()), payload.size());
    }

    static void tx_task_entry(void* arg)
    {
        static_cast<LocalCompanionSocket*>(arg)->tx_task_loop();
    }

    static void camera_task_entry(void* arg)
    {
        static_cast<LocalCompanionSocket*>(arg)->camera_task_loop();
    }

    static void sensor_task_entry(void* arg)
    {
        static_cast<LocalCompanionSocket*>(arg)->sensor_task_loop();
    }

    void start_background_tasks()
    {
        if (_tasks_running.exchange(true)) {
            return;
        }

        const BaseType_t tx_ok = xTaskCreate(tx_task_entry, "lc_tx", 8192, this, 6, &_tx_task_handle);
        const BaseType_t camera_ok = xTaskCreate(camera_task_entry, "lc_camera", 12288, this, 3, &_camera_task_handle);
        const BaseType_t sensor_ok = xTaskCreate(sensor_task_entry, "lc_sensors", 8192, this, 4, &_sensor_task_handle);
        if (tx_ok != pdPASS || camera_ok != pdPASS || sensor_ok != pdPASS) {
            mclog::tagError(_tag, "failed to start local companion tasks tx={} camera={} sensor={}",
                            tx_ok == pdPASS ? "ok" : "fail", camera_ok == pdPASS ? "ok" : "fail",
                            sensor_ok == pdPASS ? "ok" : "fail");
            _tasks_running = false;
            notify_task(_tx_task_handle);
            notify_task(_camera_task_handle);
            notify_task(_sensor_task_handle);
            return;
        }
        mclog::tagInfo(_tag, "local companion tasks started");
    }

    void stop_background_tasks()
    {
        if (!_tasks_running.exchange(false)) {
            return;
        }
        notify_task(_tx_task_handle);
        notify_task(_camera_task_handle);
        notify_task(_sensor_task_handle);
        for (int i = 0; i < 40; ++i) {
            if (_tx_task_handle == nullptr && _camera_task_handle == nullptr && _sensor_task_handle == nullptr) {
                break;
            }
            vTaskDelay(pdMS_TO_TICKS(25));
        }
    }

    void notify_task(TaskHandle_t task)
    {
        if (task != nullptr) {
            xTaskNotifyGive(task);
        }
    }

    void notify_tx_task()
    {
        notify_task(_tx_task_handle);
    }

    void clear_tx_queue()
    {
        std::lock_guard<std::mutex> lock(_tx_mutex);
        _tx_critical.clear();
        _tx_normal.clear();
        _tx_camera.clear();
    }

    bool enqueue_outbound(OutboundMessage message)
    {
        {
            std::lock_guard<std::mutex> lock(_tx_mutex);
            switch (message.priority) {
                case OutboundPriority::Critical:
                    if (_tx_critical.size() >= kCriticalTxQueueMax) {
                        if (!_tx_camera.empty()) {
                            _tx_camera.pop_front();
                        } else if (!_tx_normal.empty()) {
                            _tx_normal.pop_front();
                        } else {
                            _tx_critical.pop_front();
                        }
                    }
                    _tx_critical.push_back(std::move(message));
                    break;
                case OutboundPriority::Camera:
                    while (_tx_camera.size() >= kCameraTxQueueMax) {
                        _tx_camera.pop_front();
                    }
                    _tx_camera.push_back(std::move(message));
                    break;
                case OutboundPriority::Normal:
                default:
                    while (_tx_normal.size() >= kNormalTxQueueMax) {
                        _tx_normal.pop_front();
                    }
                    _tx_normal.push_back(std::move(message));
                    break;
            }
        }
        notify_tx_task();
        return true;
    }

    bool dequeue_outbound(OutboundMessage& message)
    {
        std::lock_guard<std::mutex> lock(_tx_mutex);
        if (!_tx_critical.empty()) {
            message = std::move(_tx_critical.front());
            _tx_critical.pop_front();
            return true;
        }
        if (!_tx_normal.empty()) {
            message = std::move(_tx_normal.front());
            _tx_normal.pop_front();
            return true;
        }
        if (!_tx_camera.empty()) {
            message = std::move(_tx_camera.front());
            _tx_camera.pop_front();
            return true;
        }
        return false;
    }

    void tx_task_loop()
    {
        while (_tasks_running.load()) {
            OutboundMessage message;
            if (!dequeue_outbound(message)) {
                ulTaskNotifyTake(pdTRUE, delay_ticks(kTxTaskIdleIntervalMs));
                continue;
            }

            const uint32_t send_start_ms = GetDeviceRuntime().millis();
            const bool sent = message.binary ? websocket_send_binary(message.bytes) : websocket_send_text(message.text);
            const uint32_t send_end_ms = GetDeviceRuntime().millis();
            if (message.cameraFrame) {
                record_camera_tx_result(message, sent, send_end_ms - send_start_ms, send_end_ms);
            }
        }
        _tx_task_handle = nullptr;
        vTaskDelete(nullptr);
    }

    void camera_task_loop()
    {
        while (_tasks_running.load()) {
            bool captured = false;
            captured = capture_stream_frame_if_needed(GetDeviceRuntime().millis());
            vTaskDelay(delay_ticks(captured ? kCameraTaskActiveYieldMs : kCameraTaskTickIntervalMs));
        }
        _camera_task_handle = nullptr;
        vTaskDelete(nullptr);
    }

    void sensor_task_loop()
    {
        while (_tasks_running.load()) {
            const uint32_t now = GetDeviceRuntime().millis();
            if (websocket_connected()) {
                send_sensor_events_if_needed(now);
            } else {
                refresh_sensor_snapshot_cache_if_needed(now);
            }
            vTaskDelay(delay_ticks(kSensorTaskTickIntervalMs));
        }
        _sensor_task_handle = nullptr;
        vTaskDelete(nullptr);
    }

    void record_camera_tx_result(const OutboundMessage& message, bool sent, uint32_t send_ms, uint32_t send_end_ms)
    {
        std::lock_guard<std::mutex> lock(_camera_mutex);
        _last_camera_send_ms = send_ms;
        _last_camera_total_ms =
            message.cameraTotalStartMs > 0 ? send_end_ms - message.cameraTotalStartMs : send_ms;
        _last_camera_jpeg_bytes = message.cameraJpegBytes;
        if (sent) {
            if (_last_camera_sent_at_ms > 0) {
                _last_camera_frame_interval_ms = send_end_ms - _last_camera_sent_at_ms;
            }
            _last_camera_sent_at_ms = send_end_ms;
            if (_camera_credit_enabled && _camera_credit_frames > 0) {
                _camera_credit_frames--;
            }
        }
    }

    void connect()
    {
        _local_state = LocalCompanionState::Connecting;
        if (_on_start_log) {
            _on_start_log("Connecting");
        }

        clear_tx_queue();
        _url = _fallback_url;
        if (_use_mdns) {
            auto discovered_url = discover_daemon_url();
            if (!discovered_url.empty()) {
                _url = std::move(discovered_url);
                mclog::tagInfo(_tag, "mDNS discovered daemon at {}", _url);
            } else {
                mclog::tagInfo(_tag, "mDNS discovery failed, using fallback {}", _fallback_url);
            }
        }

        auto& board  = Board::GetInstance();
        auto network = board.GetNetwork();
        bool connected = false;
        {
            std::lock_guard<std::mutex> lock(_websocket_mutex);
            _websocket.reset();
            _websocket = network->CreateWebSocket(kWebSocketTimeoutSeconds);

            if (!_websocket) {
                _local_state = LocalCompanionState::Error;
                mclog::tagError(_tag, "failed to create websocket");
                return;
            }

            _websocket->OnConnected([this]() {
                mclog::tagInfo(_tag, "connected to local daemon");
                _local_state          = LocalCompanionState::Connected;
                _last_heartbeat_time = GetDeviceRuntime().millis();
                _heartbeat_interval_ms = kDefaultHeartbeatIntervalMs;
                {
                    std::lock_guard<std::mutex> lock(_camera_mutex);
                    _binary_camera_frame_enabled = false;
                    _camera_credit_enabled = false;
                    _camera_credit_frames = 0;
                    _camera_max_in_flight = kDefaultCameraCreditFrames;
                    _last_camera_sent_at_ms = 0;
                }
                {
                    std::lock_guard<std::mutex> lock(_telemetry_mutex);
                    _adaptive_level = 0;
                }
                clear_tx_queue();
                reset_sensor_cache_schedule(_last_heartbeat_time);
                send_handshake();
            });

            _websocket->OnDisconnected([this]() {
                mclog::tagInfo(_tag, "local daemon disconnected");
                GetDeviceRuntime().releaseMicLevelInput();
                clear_tx_queue();
                reset_sensor_cache_schedule(GetDeviceRuntime().millis());
                {
                    std::lock_guard<std::mutex> lock(_sensor_mutex);
                    _has_pending_head_touch = false;
                }
                if (_local_state != LocalCompanionState::PairingFailed) {
                    _local_state = LocalCompanionState::Disconnected;
                }
            });

            _websocket->OnData([this](const char* data, size_t len, bool binary) {
                std::lock_guard<std::mutex> lock(_mutex);
                _msg_queue.push({binary, std::vector<uint8_t>(data, data + len)});
            });

            connected = _websocket->Connect(_url.c_str());
        }

        if (!connected) {
            _local_state = LocalCompanionState::Disconnected;
            GetDeviceRuntime().releaseMicLevelInput();
            reset_sensor_cache_schedule(GetDeviceRuntime().millis());
            clear_tx_queue();
            mclog::tagWarn(_tag, "failed to connect to {}", _url);
        }
        _last_reconnect_attempt = GetDeviceRuntime().millis();
    }

    void reconnect_if_needed()
    {
        if (_local_state == LocalCompanionState::PairingFailed) {
            return;
        }

        const auto now = GetDeviceRuntime().millis();
        if (now - _last_reconnect_attempt > 5000) {
            connect();
        }
    }

    void process_messages()
    {
        std::vector<ReceivedMessage> messages;
        {
            std::lock_guard<std::mutex> lock(_mutex);
            while (!_msg_queue.empty()) {
                messages.push_back(std::move(_msg_queue.front()));
                _msg_queue.pop();
            }
        }

        for (auto& msg : messages) {
            if (msg.binary) {
                continue;
            }
            ArduinoJson::JsonDocument doc;
            auto error = ArduinoJson::deserializeJson(doc, msg.data.data(), msg.data.size());
            if (error) {
                auto first = std::find_if(msg.data.begin(), msg.data.end(), [](uint8_t ch) {
                    return !std::isspace(static_cast<unsigned char>(ch));
                });
                if (first == msg.data.end() || (*first != '{' && *first != '[')) {
                    mclog::tagInfo(_tag, "ignored non-json daemon frame len={}", msg.data.size());
                    continue;
                }
                mclog::tagWarn(_tag, "invalid json from daemon: {}", error.c_str());
                continue;
            }
            handle_json(doc.as<ArduinoJson::JsonObject>());
        }
    }

    void handle_json(ArduinoJson::JsonObject doc)
    {
        const char* type = doc["type"] | "";
        if (strcmp(type, "daemon.hello") == 0) {
            handle_daemon_hello(doc);
            send_state_event("idle", "daemon hello received");
            return;
        }

        if (strcmp(type, "error") == 0) {
            const char* code = doc["code"] | "";
            if (strcmp(code, "pairing_failed") == 0) {
                _local_state = LocalCompanionState::PairingFailed;
            } else {
                _local_state = LocalCompanionState::Error;
            }
            return;
        }

        if (strcmp(type, "robot.command") == 0) {
            handle_command(doc);
        }
    }

    void handle_daemon_hello(ArduinoJson::JsonObject doc)
    {
        _local_state = LocalCompanionState::Connected;
        const uint32_t requested_heartbeat = doc["heartbeatIntervalMs"] | kDefaultHeartbeatIntervalMs;
        _heartbeat_interval_ms = std::max(kMinHeartbeatIntervalMs, std::min(kMaxHeartbeatIntervalMs, requested_heartbeat));

        bool binary_camera_frame_enabled = false;
        bool camera_credit_enabled = false;
        int camera_max_in_flight = kDefaultCameraCreditFrames;
        auto flags = doc["featureFlags"].as<ArduinoJson::JsonArray>();
        for (auto flag : flags) {
            const char* value = flag | "";
            if (strcmp(value, "binaryCameraFrame") == 0) {
                binary_camera_frame_enabled = true;
            }
            if (strcmp(value, "mediaCredit") == 0) {
                camera_credit_enabled = true;
            }
        }

        auto media_credit = doc["featureParams"]["mediaCredit"].as<ArduinoJson::JsonObject>();
        if (!media_credit.isNull()) {
            camera_max_in_flight = std::max(1, std::min(kMaxCameraCreditFrames,
                                                        media_credit["maxCreditFrames"] | kDefaultCameraCreditFrames));
        }

        {
            std::lock_guard<std::mutex> lock(_camera_mutex);
            _binary_camera_frame_enabled = binary_camera_frame_enabled;
            _camera_credit_enabled = camera_credit_enabled;
            _camera_max_in_flight = camera_max_in_flight;
            _camera_credit_frames = 0;
        }

        mclog::tagInfo(_tag, "daemon hello heartbeat={}ms binaryCameraFrame={} mediaCredit={}",
                       _heartbeat_interval_ms, binary_camera_frame_enabled ? "yes" : "no",
                       camera_credit_enabled ? "yes" : "no");
    }

    void handle_telemetry_config(ArduinoJson::JsonObject command)
    {
        uint32_t sensor_snapshot_interval_ms = 0;
        uint32_t imu_event_interval_ms = 0;
        bool include_i2c_scan = true;
        uint8_t adaptive_level = 0;
        {
            std::lock_guard<std::mutex> lock(_telemetry_mutex);
            if (!command["sensorSnapshotHz"].isNull()) {
                const float hz = command["sensorSnapshotHz"] | 1.0f;
                _sensor_snapshot_interval_ms = hz <= 0.0f ? 0 : static_cast<uint32_t>(1000.0f / hz);
            }

            if (!command["imuHz"].isNull()) {
                const float hz = command["imuHz"] | 4.0f;
                _imu_event_interval_ms = hz <= 0.0f ? 0 : static_cast<uint32_t>(1000.0f / hz);
            }

            if (!command["includeI2cScan"].isNull()) {
                _include_i2c_scan = command["includeI2cScan"] | true;
            }

            _adaptive_level =
                (_sensor_snapshot_interval_ms > 1000 || _imu_event_interval_ms > 250 || !_include_i2c_scan) ? 1 : 0;
            _sensor_cache_initialized = false;
            sensor_snapshot_interval_ms = _sensor_snapshot_interval_ms;
            imu_event_interval_ms = _imu_event_interval_ms;
            include_i2c_scan = _include_i2c_scan;
            adaptive_level = _adaptive_level;
        }
        mclog::tagInfo(_tag, "telemetry config snapshot={}ms imu={}ms i2cScan={} adaptiveLevel={}",
                       sensor_snapshot_interval_ms, imu_event_interval_ms, include_i2c_scan ? "yes" : "no",
                       static_cast<int>(adaptive_level));
    }

    void handle_media_flow_control(ArduinoJson::JsonObject command)
    {
        const char* stream = command["stream"] | "";
        if (strcmp(stream, "camera") != 0) {
            return;
        }

        const int credit = std::max(0, std::min(kMaxCameraCreditFrames, command["creditFrames"] | 0));
        std::lock_guard<std::mutex> lock(_camera_mutex);
        const int max_in_flight = std::max(1, std::min(kMaxCameraCreditFrames, command["maxInFlight"] | _camera_max_in_flight));
        _camera_max_in_flight = max_in_flight;
        _camera_credit_frames = std::min(_camera_credit_frames + credit, _camera_max_in_flight);
    }

    void handle_command(ArduinoJson::JsonObject doc)
    {
        auto command = doc["command"].as<ArduinoJson::JsonObject>();
        const char* command_id = doc["commandId"] | "";
        const char* kind       = command["kind"] | "";
        if (command_updates_activity(kind)) {
            GetDeviceRuntime().onLocalCompanionActivity.emit(kind);
        }

        if (strcmp(kind, "say") == 0) {
            WsTextMessage_t message;
            message.name    = "Codex";
            message.content = command["text"].as<std::string>();
            GetDeviceRuntime().onWsTextMessage.emit(message);
            send_command_ack(command_id, kind, nullptr, true, "accepted");
            send_state_event("speaking", "say command");
            send_command_status(command_id, kind, nullptr, "completed", "text displayed", 1.0f);
            return;
        }

        if (strcmp(kind, "react") == 0) {
            WsReactMessage_t message;
            message.emotion    = command["emotion"].as<std::string>();
            message.durationMs = command["durationMs"] | 2000;

            if (!command["avatarJson"].isNull()) {
                ArduinoJson::serializeJson(command["avatarJson"], message.avatarJson);
            }
            if (!command["rgbJson"].isNull()) {
                ArduinoJson::serializeJson(command["rgbJson"], message.rgbJson);
            }
            GetDeviceRuntime().onWsReactMessage.emit(message);
            send_command_ack(command_id, kind, nullptr, true, "accepted");
            send_command_status(command_id, kind, nullptr, "completed", "reaction applied", 1.0f);
            return;
        }

        if (strcmp(kind, "setRgb") == 0) {
            const bool enabled = command["enabled"] | false;
            const char* requested_color = command["color"] | "#000000";
            std::string color = requested_color && strlen(requested_color) == 7 ? requested_color : "#000000";
            if (!enabled) {
                color = "#000000";
            }

            ArduinoJson::JsonDocument rgb;
            rgb["leftRgbDuration"] = 0.12f;
            rgb["rightRgbDuration"] = 0.12f;
            rgb["leftRgbColor"] = color;
            rgb["rightRgbColor"] = color;
            std::string rgb_json;
            ArduinoJson::serializeJson(rgb, rgb_json);
            GetStackChan().updateNeonLightFromJson(rgb_json.c_str());

            _rgb_control_enabled = enabled;
            _rgb_control_color = color;
            _rgb_control_brightness = clamp_float(command["brightness"] | 1.0f, 0.0f, 1.0f);
            send_command_ack(command_id, kind, nullptr, true, "accepted");
            send_command_status(command_id, kind, nullptr, "completed", "rgb applied", 1.0f);
            return;
        }

        if (strcmp(kind, "moveHead") == 0) {
            ArduinoJson::JsonDocument motion;
            motion["yawServo"]["angle"]   = command["yaw"] | 0;
            motion["pitchServo"]["angle"] = command["pitch"] | 0;
            if (!command["speed"].isNull()) {
                motion["yawServo"]["speed"]   = command["speed"];
                motion["pitchServo"]["speed"] = command["speed"];
            }
            std::string motion_json;
            ArduinoJson::serializeJson(motion, motion_json);
            GetStackChan().updateMotionFromJson(motion_json.c_str());
            send_command_ack(command_id, kind, nullptr, true, "accepted");
            send_command_status(command_id, kind, nullptr, "completed", "motion command applied", 1.0f);
            return;
        }

        if (strcmp(kind, "cameraStream") == 0) {
            CameraStreamApplyResult camera_result;
            {
                std::lock_guard<std::mutex> lock(_camera_mutex);
                camera_result = apply_camera_stream_command(_camera_stream, command);
                if (!camera_result.isEnabled) {
                    _last_camera_frame_time = 0;
                }
            }
            if (camera_result.isEnabled && !camera_result.wasEnabled) {
                std::lock_guard<std::mutex> lock(_face_tracking_mutex);
                _face_tracking_target.updatedAt = GetDeviceRuntime().millis();
                _face_tracking_target.detected = false;
                _face_tracking_target.reserved = true;
                _face_tracking_target.recenterOnLost = true;
                _face_tracking_target.speed = std::max(_face_tracking_target.speed, 420);
                _face_tracking_hold_until = GetDeviceRuntime().millis() + 3500;
            }
            send_command_ack(command_id, kind, nullptr, true, "accepted");
            send_command_status(command_id, kind, nullptr, "completed", "camera stream configured", 1.0f);
            return;
        }

        if (strcmp(kind, "telemetryConfig") == 0) {
            handle_telemetry_config(command);
            send_command_ack(command_id, kind, nullptr, true, "accepted");
            send_command_status(command_id, kind, nullptr, "completed", "telemetry configured", 1.0f);
            return;
        }

        if (strcmp(kind, "mediaFlowControl") == 0) {
            handle_media_flow_control(command);
            return;
        }

        if (strcmp(kind, "trackFace") == 0) {
            handle_track_face(command);
            return;
        }

        if (strcmp(kind, "playAnimation") == 0) {
            std::string sequence_json;
            ArduinoJson::serializeJson(command["sequence"], sequence_json);
            GetDeviceRuntime().onWsDanceData.emit(sequence_json);
            send_command_ack(command_id, kind, nullptr, true, "accepted");
            send_command_status(command_id, kind, nullptr, "started", "animation started", 0.0f);
            return;
        }

        if (strcmp(kind, "playAudioStart") == 0) {
            handle_play_audio_start(command, command_id);
            return;
        }

        if (strcmp(kind, "playAudioChunk") == 0) {
            handle_play_audio_chunk(command, command_id);
            return;
        }

        if (strcmp(kind, "playAudioEnd") == 0) {
            handle_play_audio_end(command, command_id);
            return;
        }

        if (strcmp(kind, "captureImage") == 0) {
            const char* request_id = command["requestId"] | "";
            if (handle_capture_image(command_id, request_id)) {
                send_command_ack(command_id, kind, request_id, true, "accepted");
                send_command_status(command_id, kind, request_id, "completed", "image captured", 1.0f);
            } else {
                send_command_ack(command_id, kind, request_id, false, "capture failed");
                send_command_status(command_id, kind, request_id, "failed", "capture failed", 1.0f);
            }
            return;
        }

        if (strcmp(kind, "setMode") == 0) {
            const char* mode = command["mode"] | "idle";
            _local_state = mode_from_string(mode);
            send_command_ack(command_id, kind, nullptr, true, "accepted");
            send_state_event(mode, command["reason"] | "setMode command");
            send_command_status(command_id, kind, nullptr, "completed", "mode applied", 1.0f);
            return;
        }

        send_command_ack(command_id, kind, nullptr, false, "unsupported robot command");
        send_command_status(command_id, kind, nullptr, "failed", "unsupported robot command", 1.0f);
        send_error("unknown_command", "unsupported robot command", true, command_id);
    }

    void handle_track_face(ArduinoJson::JsonObject command)
    {
        const bool detected = command["detected"] | false;
        std::lock_guard<std::mutex> lock(_face_tracking_mutex);
        _face_tracking_target.updatedAt = GetDeviceRuntime().millis();
        _face_tracking_target.speed     = std::max(0, std::min(1000, command["speed"] | 420));
        update_tracking_control(_face_tracking_target.control, command["control"].as<ArduinoJson::JsonObject>());

        if (!detected) {
            const char* reason = command["reason"] | "";
            _face_tracking_target.detected = false;
            _face_tracking_target.reserved = true;
            _face_tracking_target.recenterOnLost =
                strcmp(reason, "face_lost") == 0 || strcmp(reason, "tracking_enabled") == 0;
            _face_tracking_hold_until      = GetDeviceRuntime().millis() + 3500;
            return;
        }

        _face_tracking_target.reserved    = true;
        _face_tracking_target.detected    = true;
        _face_tracking_target.recenterOnLost = false;
        _face_tracking_target.centerX     = clamp_float(command["centerX"] | 0.5f, 0.0f, 1.0f);
        _face_tracking_target.centerY     = clamp_float(command["centerY"] | 0.5f, 0.0f, 1.0f);
        _face_tracking_target.confidence  = clamp_float(command["confidence"] | 0.0f, 0.0f, 1.0f);
        _face_tracking_hold_until         = 0;
    }

    void handle_play_audio_start(ArduinoJson::JsonObject command, const char* command_id)
    {
        const char* request_id = command["requestId"] | "";
        const char* format     = command["format"] | "";
        if (strlen(request_id) == 0 || strcmp(format, "ogg_opus") != 0) {
            reject_audio_command(command_id, "playAudioStart", request_id, "invalid audio start command");
            return;
        }

        const size_t total_bytes  = command["totalBytes"] | 0;
        const size_t total_chunks = command["totalChunks"] | 0;
        if (total_bytes == 0 || total_bytes > kMaxAudioBytes || total_chunks == 0 || total_chunks > kMaxAudioChunks) {
            reject_audio_command(command_id, "playAudioStart", request_id, "audio transfer is too large");
            return;
        }

        _audio_transfer.active         = true;
        _audio_transfer.requestId      = request_id;
        _audio_transfer.text           = command["text"] | "";
        _audio_transfer.totalBytes     = total_bytes;
        _audio_transfer.totalChunks    = total_chunks;
        _audio_transfer.nextChunkIndex = 0;
        _audio_transfer.volume         = command["volume"].isNull()
                                             ? -1
                                             : std::max(0, std::min(100, static_cast<int>(command["volume"] | -1)));
        _audio_transfer.audio.clear();
        _audio_transfer.audio.reserve(total_bytes);
        send_command_ack(command_id, "playAudioStart", request_id, true, "accepted");
        send_command_status(command_id, "playAudioStart", request_id, "completed", "audio transfer opened", 1.0f);
    }

    void handle_play_audio_chunk(ArduinoJson::JsonObject command, const char* command_id)
    {
        const char* request_id = command["requestId"] | "";
        if (!_audio_transfer.active || _audio_transfer.requestId != request_id) {
            reject_audio_command(command_id, "playAudioChunk", request_id, "audio transfer is not active");
            return;
        }

        const size_t chunk_index = command["chunkIndex"] | kMaxAudioChunks;
        if (chunk_index != _audio_transfer.nextChunkIndex) {
            reject_audio_command(command_id, "playAudioChunk", request_id, "unexpected audio chunk index");
            return;
        }

        const char* encoded      = command["dataBase64"] | "";
        const size_t encoded_len = strlen(encoded);
        if (encoded_len == 0 || encoded_len > kMaxAudioChunkBase64Bytes) {
            reject_audio_command(command_id, "playAudioChunk", request_id, "invalid audio chunk size");
            return;
        }

        std::string decoded;
        if (!decode_base64_to_string(encoded, encoded_len, decoded)) {
            reject_audio_command(command_id, "playAudioChunk", request_id, "audio chunk base64 decode failed");
            return;
        }
        if (_audio_transfer.audio.size() + decoded.size() > _audio_transfer.totalBytes) {
            reject_audio_command(command_id, "playAudioChunk", request_id, "audio transfer exceeds declared size");
            return;
        }

        _audio_transfer.audio.append(decoded);
        _audio_transfer.nextChunkIndex++;
        send_command_ack(command_id, "playAudioChunk", request_id, true, "accepted");
        send_command_status(command_id, "playAudioChunk", request_id, "completed", "audio chunk accepted", 1.0f);
    }

    void handle_play_audio_end(ArduinoJson::JsonObject command, const char* command_id)
    {
        const char* request_id = command["requestId"] | "";
        if (!_audio_transfer.active || _audio_transfer.requestId != request_id) {
            reject_audio_command(command_id, "playAudioEnd", request_id, "audio transfer is not active");
            return;
        }
        if (_audio_transfer.nextChunkIndex != _audio_transfer.totalChunks ||
            _audio_transfer.audio.size() != _audio_transfer.totalBytes) {
            reject_audio_command(command_id, "playAudioEnd", request_id, "audio transfer is incomplete");
            _audio_transfer = {};
            return;
        }

        std::string audio;
        std::string text;
        int volume = _audio_transfer.volume;
        audio.swap(_audio_transfer.audio);
        text = std::move(_audio_transfer.text);
        _audio_transfer = {};

        if (!text.empty()) {
            WsTextMessage_t message;
            message.name    = "Codex";
            message.content = text;
            GetDeviceRuntime().onWsTextMessage.emit(message);
        }

        send_command_ack(command_id, "playAudioEnd", request_id, true, "accepted");
        send_state_event("speaking", "playAudio command");
        send_playback_event(request_id, "started", "");
        send_command_status(command_id, "playAudioEnd", request_id, "started", "playback started", 0.0f);
        start_playback_task(request_id, std::move(audio), volume);
    }

    void reject_audio_command(const char* command_id, const char* kind, const char* request_id, const char* message)
    {
        send_command_ack(command_id, kind, request_id, false, message);
        send_command_status(command_id, kind, request_id, "failed", message, 1.0f);
        send_error("invalid_audio_command", message, true, command_id);
    }

    void start_playback_task(const char* request_id, std::string audio, int volume)
    {
        std::string playback_request_id = request_id ? request_id : "";
        const bool started = start_audio_playback_task(playback_request_id, std::move(audio), volume,
                                                       [this](std::string finished_request_id) {
                                                           queue_playback_event(std::move(finished_request_id), "finished", "");
                                                       });
        if (!started) {
            send_playback_event(playback_request_id.c_str(), "failed", "failed to create playback task");
        }
    }

    void queue_playback_event(std::string request_id, std::string state, std::string message)
    {
        std::lock_guard<std::mutex> lock(_playback_event_mutex);
        _playback_events.push({std::move(request_id), std::move(state), std::move(message)});
    }

    void send_pending_playback_events()
    {
        std::vector<PlaybackEvent> events;
        {
            std::lock_guard<std::mutex> lock(_playback_event_mutex);
            while (!_playback_events.empty()) {
                events.push_back(std::move(_playback_events.front()));
                _playback_events.pop();
            }
        }

        for (const auto& event : events) {
            send_playback_event(event.requestId.c_str(), event.state.c_str(), event.message.c_str());
            if (event.state == "finished") {
                send_state_event("idle", "playback finished");
            }
        }
    }

    bool capture_stream_frame_if_needed(uint32_t now)
    {
        CameraStreamConfig stream_config;
        {
            std::lock_guard<std::mutex> lock(_camera_mutex);
            if (!_camera_stream.enabled || now - _last_camera_frame_time < _camera_stream.intervalMs) {
                return false;
            }
            if (_camera_credit_enabled && _camera_credit_frames <= 0) {
                return false;
            }
            stream_config = _camera_stream;
        }

        if (!websocket_connected()) {
            return false;
        }
        const uint32_t total_start_ms = GetDeviceRuntime().millis();

        auto camera = stackchan::hal::hardware::GetHardwareRegistry().camera();
        if (!camera) {
            return false;
        }

        uint8_t* jpeg_data = nullptr;
        size_t jpeg_len    = 0;
        int frame_width    = 0;
        int frame_height   = 0;
        std::string capture_timestamp;
        {
            std::lock_guard<std::mutex> lock(_camera_mutex);
            _last_camera_frame_time = now;
            capture_timestamp = iso_now();
        }

        const uint32_t capture_start_ms = GetDeviceRuntime().millis();
        {
            std::lock_guard<std::mutex> hardware_lock(_camera_hardware_mutex);
            if (!camera->StreamCaptures(false) || camera->GetFrameData() == nullptr || camera->GetFrameSize() == 0) {
                std::lock_guard<std::mutex> lock(_camera_mutex);
                _last_camera_capture_ms = GetDeviceRuntime().millis() - capture_start_ms;
                return true;
            }
            const uint32_t capture_end_ms = GetDeviceRuntime().millis();
            {
                std::lock_guard<std::mutex> lock(_camera_mutex);
                _last_camera_capture_ms = capture_end_ms - capture_start_ms;
            }
            frame_width  = camera->GetFrameWidth();
            frame_height = camera->GetFrameHeight();
            const uint32_t encode_start_ms = GetDeviceRuntime().millis();
            if (!image_to_jpeg((uint8_t*)camera->GetFrameData(), camera->GetFrameSize(), frame_width, frame_height,
                               (v4l2_pix_fmt_t)camera->GetFrameFormat(), stream_config.jpegQuality, &jpeg_data,
                               &jpeg_len)) {
                if (jpeg_data) {
                    free(jpeg_data);
                }
                std::lock_guard<std::mutex> lock(_camera_mutex);
                _last_camera_encode_ms = GetDeviceRuntime().millis() - encode_start_ms;
                return true;
            }
            {
                std::lock_guard<std::mutex> lock(_camera_mutex);
                _last_camera_encode_ms = GetDeviceRuntime().millis() - encode_start_ms;
            }
        }

        send_camera_frame(jpeg_data, jpeg_len, frame_width, frame_height, capture_timestamp, total_start_ms);
        free(jpeg_data);
        return true;
    }

    void send_sensor_events_if_needed(uint32_t now)
    {
        refresh_sensor_snapshot_cache_if_needed(now);
        send_pending_head_touch();
        send_screen_touch_if_needed(now);

        uint32_t imu_event_interval_ms = 0;
        uint32_t sensor_snapshot_interval_ms = 0;
        {
            std::lock_guard<std::mutex> lock(_telemetry_mutex);
            imu_event_interval_ms = _imu_event_interval_ms;
            sensor_snapshot_interval_ms = _sensor_snapshot_interval_ms;
        }

        if (imu_event_interval_ms > 0 && now - _last_imu_event_time >= imu_event_interval_ms) {
            send_imu_event();
            _last_imu_event_time = now;
        }

        if (now - _last_battery_event_time >= 1000) {
            send_battery_event();
            _last_battery_event_time = now;
        }

        if (now - _last_wifi_event_time >= 1000) {
            send_wifi_event();
            _last_wifi_event_time = now;
        }

        if (sensor_snapshot_interval_ms > 0 &&
            now - _last_sensor_snapshot_event_time >= sensor_snapshot_interval_ms) {
            send_sensor_snapshot_event(now);
            _last_sensor_snapshot_event_time = now;
        }
    }

    void reset_sensor_cache_schedule(uint32_t now)
    {
        std::lock_guard<std::mutex> lock(_telemetry_mutex);
        _sensor_cache_initialized = false;
        _next_imu_cache_time = now;
        _next_head_touch_cache_time = now;
        _next_power_cache_time = now;
        _next_network_cache_time = now;
        _next_servo_cache_time = now;
        _next_mic_cache_time = now;
        _next_peripheral_cache_time = now;
    }

    uint32_t active_imu_cache_interval_ms() const
    {
        return _imu_event_interval_ms > 0 ? _imu_event_interval_ms : kImuCacheIntervalMs;
    }

    void refresh_sensor_snapshot_cache_if_needed(uint32_t now)
    {
        std::lock_guard<std::mutex> lock(_telemetry_mutex);
        if (!_sensor_cache_initialized) {
            refresh_imu_cache();
            refresh_head_touch_cache();
            refresh_power_cache();
            refresh_network_cache();
            refresh_servo_cache();
            refresh_mic_cache();
            refresh_peripheral_cache();
            _sensor_cache_initialized = true;

            _next_imu_cache_time = now + active_imu_cache_interval_ms();
            _next_head_touch_cache_time = now + kHeadTouchCacheIntervalMs;
            _next_power_cache_time = now + kPowerCacheIntervalMs;
            _next_network_cache_time = now + kNetworkCacheIntervalMs + 100;
            _next_servo_cache_time = now + kServoCacheIntervalMs + 200;
            _next_mic_cache_time = now + kMicCacheIntervalMs + 300;
            _next_peripheral_cache_time = now + kPeripheralCacheIntervalMs + 400;
            return;
        }

        if (time_due(now, _next_imu_cache_time)) {
            refresh_imu_cache();
            _next_imu_cache_time = now + active_imu_cache_interval_ms();
        }
        if (time_due(now, _next_head_touch_cache_time)) {
            refresh_head_touch_cache();
            _next_head_touch_cache_time = now + kHeadTouchCacheIntervalMs;
        }
        if (time_due(now, _next_power_cache_time)) {
            refresh_power_cache();
            _next_power_cache_time = now + kPowerCacheIntervalMs;
        }
        if (time_due(now, _next_network_cache_time)) {
            refresh_network_cache();
            _next_network_cache_time = now + kNetworkCacheIntervalMs;
        }
        if (time_due(now, _next_servo_cache_time)) {
            refresh_servo_cache();
            _next_servo_cache_time = now + kServoCacheIntervalMs;
        }
        if (time_due(now, _next_mic_cache_time)) {
            refresh_mic_cache();
            _next_mic_cache_time = now + kMicCacheIntervalMs;
        }
        if (time_due(now, _next_peripheral_cache_time)) {
            refresh_peripheral_cache();
            _next_peripheral_cache_time = now + kPeripheralCacheIntervalMs;
        }
    }

    void refresh_imu_cache()
    {
        _imu_cache = GetDeviceRuntime().getLocalImuSnapshot();
    }

    void refresh_head_touch_cache()
    {
        _head_touch_cache = GetDeviceRuntime().getLocalHeadTouchSnapshot();
    }

    void refresh_power_cache()
    {
        _power_cache.batteryLevel = clamp_percent(GetDeviceRuntime().getBatteryLevel());
        _power_cache.charging = GetDeviceRuntime().isBatteryCharging();
        _power_cache.backlight = clamp_percent(GetDeviceRuntime().getBackLightBrightness());
        _power_cache.speakerVolume = clamp_percent(GetDeviceRuntime().getSpeakerVolume());
    }

    void refresh_network_cache()
    {
        auto& wifi = WifiManager::GetInstance();
        _network_cache.rssi = 0;
        _network_cache.ssid.clear();
        if (wifi.IsConnected()) {
            _network_cache.wifiStatus = "connected";
            _network_cache.rssi = wifi.GetRssi();
            _network_cache.ssid = wifi.GetSsid();
        } else if (wifi.IsConfigMode()) {
            _network_cache.wifiStatus = "connecting";
        } else {
            _network_cache.wifiStatus = "disconnected";
        }
        _network_cache.bleConnected = GetDeviceRuntime().isBleConnected();
    }

    void refresh_servo_cache()
    {
        _servo_cache.ioExpanderAvailable = GetDeviceRuntime().isIoExpanderAvailable();
        _servo_cache.servoPower = GetDeviceRuntime().isServoPowerEnabled();
        auto& motion = GetStackChan().motion();
        _servo_cache.yawAngle = motion.yawServo().getCurrentAngle() / 10.0f;
        _servo_cache.yawMoving = motion.yawServo().isMoving();
        _servo_cache.yawTorque = motion.yawServo().getTorqueEnabled();
        _servo_cache.pitchAngle = motion.pitchServo().getCurrentAngle() / 10.0f;
        _servo_cache.pitchMoving = motion.pitchServo().isMoving();
        _servo_cache.pitchTorque = motion.pitchServo().getTorqueEnabled();
    }

    void refresh_mic_cache()
    {
        _mic_cache = GetDeviceRuntime().getMicLevelSnapshot();
    }

    void refresh_peripheral_cache()
    {
        _peripheral_cache = GetDeviceRuntime().getLocalPeripheralProbeSnapshot();
    }

    SensorTelemetryCacheCopy copy_sensor_cache()
    {
        std::lock_guard<std::mutex> lock(_telemetry_mutex);
        SensorTelemetryCacheCopy copy;
        copy.headTouch = _head_touch_cache;
        copy.imu = _imu_cache;
        copy.mic = _mic_cache;
        copy.peripherals = _peripheral_cache;
        copy.power = _power_cache;
        copy.network = _network_cache;
        copy.servo = _servo_cache;
        copy.includeI2cScan = _include_i2c_scan;
        copy.adaptiveLevel = _adaptive_level;
        return copy;
    }

    CameraTelemetryCopy copy_camera_telemetry(StackChanCamera* camera)
    {
        std::lock_guard<std::mutex> lock(_camera_mutex);
        CameraTelemetryCopy copy;
        copy.streaming = _camera_stream.enabled;
        copy.requestedWidth = _camera_stream.requestedWidth;
        copy.requestedHeight = _camera_stream.requestedHeight;
        copy.jpegQuality = _camera_stream.jpegQuality;
        copy.intervalMs = _camera_stream.intervalMs;
        copy.fallbackReason = _camera_stream.fallbackReason;
        copy.binaryFrameEnabled = _binary_camera_frame_enabled;
        copy.lastCaptureMs = _last_camera_capture_ms;
        copy.lastEncodeMs = _last_camera_encode_ms;
        copy.lastSendMs = _last_camera_send_ms;
        copy.lastTotalMs = _last_camera_total_ms;
        copy.lastFrameIntervalMs = _last_camera_frame_interval_ms;
        copy.lastJpegBytes = _last_camera_jpeg_bytes;
        if (camera) {
            copy.actualWidth = camera->GetFrameWidth();
            copy.actualHeight = camera->GetFrameHeight();
        }
        return copy;
    }

    void prepare_event_doc(ArduinoJson::JsonDocument& doc, const char* kind)
    {
        prepare_robot_event(doc, kind, next_outgoing_seq());
    }

    void send_battery_event()
    {
        const auto cache = copy_sensor_cache();
        ArduinoJson::JsonDocument doc;
        prepare_event_doc(doc, "battery");
        doc["event"]["level"]    = cache.power.batteryLevel;
        doc["event"]["charging"] = cache.power.charging;
        send_json(doc);
    }

    void send_wifi_event()
    {
        const auto cache = copy_sensor_cache();
        ArduinoJson::JsonDocument doc;
        prepare_event_doc(doc, "wifi");
        if (cache.network.wifiStatus == "connected") {
            doc["event"]["status"] = "connected";
            doc["event"]["rssi"]   = cache.network.rssi;
            if (!cache.network.ssid.empty()) {
                doc["event"]["ssid"] = cache.network.ssid;
            }
        } else if (cache.network.wifiStatus == "connecting") {
            doc["event"]["status"] = "connecting";
        } else {
            doc["event"]["status"] = "disconnected";
        }
        send_json(doc);
    }

    void send_imu_event()
    {
        const auto cache = copy_sensor_cache();
        const auto& imu = cache.imu;
        if (!imu.available) {
            return;
        }

        ArduinoJson::JsonDocument doc;
        prepare_event_doc(doc, "imu");
        doc["event"]["motion"] = motion_event_to_string(imu.motion);
        doc["event"]["x"]      = imu.x;
        doc["event"]["y"]      = imu.y;
        doc["event"]["z"]      = imu.z;
        doc["event"]["gyroX"]  = imu.gyroX;
        doc["event"]["gyroY"]  = imu.gyroY;
        doc["event"]["gyroZ"]  = imu.gyroZ;
        doc["event"]["uptimeMs"] = imu.updatedAt;
        send_json(doc);
    }

    void send_sensor_snapshot_event(uint32_t now)
    {
        auto camera = stackchan::hal::hardware::GetHardwareRegistry().camera();
        const auto cache = copy_sensor_cache();
        const auto camera_state = copy_camera_telemetry(camera);
        const auto touch = embedded_runtime_bridge::get_touch_point();
        const auto& head_touch = cache.headTouch;
        const auto& imu = cache.imu;
        const auto& mic = cache.mic;
        const auto& peripherals = cache.peripherals;

        ArduinoJson::JsonDocument doc;
        prepare_event_doc(doc, "sensorSnapshot");
        doc["event"]["uptimeMs"] = now;

        doc["event"]["power"]["batteryLevel"] = cache.power.batteryLevel;
        doc["event"]["power"]["charging"] = cache.power.charging;
        doc["event"]["power"]["backlight"] = cache.power.backlight;
        doc["event"]["power"]["speakerVolume"] = cache.power.speakerVolume;
        doc["event"]["power"]["servoPower"] = cache.servo.servoPower;

        if (cache.network.wifiStatus == "connected") {
            doc["event"]["network"]["wifi"]["status"] = "connected";
            doc["event"]["network"]["wifi"]["rssi"] = cache.network.rssi;
            if (!cache.network.ssid.empty()) {
                doc["event"]["network"]["wifi"]["ssid"] = cache.network.ssid;
            }
        } else if (cache.network.wifiStatus == "connecting") {
            doc["event"]["network"]["wifi"]["status"] = "connecting";
        } else {
            doc["event"]["network"]["wifi"]["status"] = "disconnected";
        }
        doc["event"]["network"]["ble"]["available"] = true;
        doc["event"]["network"]["ble"]["connected"] = cache.network.bleConnected;
        doc["event"]["network"]["ble"]["provisioning"] = true;

        doc["event"]["motion"]["imu"]["available"] = imu.available;
        if (imu.available) {
            doc["event"]["motion"]["imu"]["motion"] = motion_event_to_string(imu.motion);
            doc["event"]["motion"]["imu"]["x"] = imu.x;
            doc["event"]["motion"]["imu"]["y"] = imu.y;
            doc["event"]["motion"]["imu"]["z"] = imu.z;
            doc["event"]["motion"]["imu"]["gyroX"] = imu.gyroX;
            doc["event"]["motion"]["imu"]["gyroY"] = imu.gyroY;
            doc["event"]["motion"]["imu"]["gyroZ"] = imu.gyroZ;
            doc["event"]["motion"]["imu"]["uptimeMs"] = imu.updatedAt;
        } else {
            doc["event"]["motion"]["imu"]["reason"] = "driver_unavailable";
        }

        doc["event"]["motion"]["servos"]["available"] = true;
        doc["event"]["motion"]["servos"]["power"] = cache.servo.servoPower;
        doc["event"]["motion"]["servos"]["yaw"]["angle"] = cache.servo.yawAngle;
        doc["event"]["motion"]["servos"]["yaw"]["moving"] = cache.servo.yawMoving;
        doc["event"]["motion"]["servos"]["yaw"]["torque"] = cache.servo.yawTorque;
        doc["event"]["motion"]["servos"]["pitch"]["angle"] = cache.servo.pitchAngle;
        doc["event"]["motion"]["servos"]["pitch"]["moving"] = cache.servo.pitchMoving;
        doc["event"]["motion"]["servos"]["pitch"]["torque"] = cache.servo.pitchTorque;

        doc["event"]["interaction"]["screenTouch"]["available"] = true;
        doc["event"]["interaction"]["screenTouch"]["pressed"] = touch.num > 0;
        doc["event"]["interaction"]["screenTouch"]["points"] = std::max(0, std::min(5, touch.num));
        if (touch.num > 0) {
            doc["event"]["interaction"]["screenTouch"]["x"] = std::max(0, std::min(320, touch.x));
            doc["event"]["interaction"]["screenTouch"]["y"] = std::max(0, std::min(240, touch.y));
        }

        doc["event"]["interaction"]["headTouch"]["available"] = head_touch.available;
        doc["event"]["interaction"]["headTouch"]["pressed"] = head_touch.pressed;
        if (head_touch.gesture != HeadPetGesture::None) {
            doc["event"]["interaction"]["headTouch"]["gesture"] = head_touch_gesture_to_string(head_touch.gesture);
        }
        auto zones = doc["event"]["interaction"]["headTouch"]["zones"].to<ArduinoJson::JsonArray>();
        for (size_t i = 0; i < head_touch.intensity.size(); i++) {
            if (head_touch.intensity[i] > 0) {
                zones.add(static_cast<int>(i));
            }
        }
        if (!head_touch.available) {
            doc["event"]["interaction"]["headTouch"]["reason"] = "driver_unavailable";
        }

        doc["event"]["interaction"]["wakeWord"]["available"] = true;
        doc["event"]["interaction"]["wakeWord"]["text"] = "Hi, Stack Chan";

        const bool io_expander_available = cache.servo.ioExpanderAvailable;
        doc["event"]["peripherals"]["ioExpander"]["available"] = io_expander_available;
        if (!io_expander_available) {
            doc["event"]["peripherals"]["ioExpander"]["reason"] = "driver_unavailable";
        }

        doc["event"]["peripherals"]["camera"]["available"] = camera != nullptr;
        doc["event"]["peripherals"]["camera"]["streaming"] = camera_state.streaming;
        doc["event"]["peripherals"]["camera"]["requestedWidth"] = camera_state.requestedWidth;
        doc["event"]["peripherals"]["camera"]["requestedHeight"] = camera_state.requestedHeight;
        doc["event"]["peripherals"]["camera"]["quality"] = camera_state.jpegQuality;
        doc["event"]["peripherals"]["camera"]["transport"] =
            camera_state.binaryFrameEnabled ? "binary" : "jsonBase64";
        doc["event"]["peripherals"]["camera"]["adaptiveLevel"] = cache.adaptiveLevel;
        doc["event"]["peripherals"]["camera"]["lastCaptureMs"] = camera_state.lastCaptureMs;
        doc["event"]["peripherals"]["camera"]["lastEncodeMs"] = camera_state.lastEncodeMs;
        doc["event"]["peripherals"]["camera"]["lastSendMs"] = camera_state.lastSendMs;
        doc["event"]["peripherals"]["camera"]["lastTotalMs"] = camera_state.lastTotalMs;
        doc["event"]["peripherals"]["camera"]["lastFrameIntervalMs"] = camera_state.lastFrameIntervalMs;
        doc["event"]["peripherals"]["camera"]["lastJpegBytes"] = camera_state.lastJpegBytes;
        if (camera) {
            if (camera_state.actualWidth > 0) {
                doc["event"]["peripherals"]["camera"]["width"] = camera_state.actualWidth;
                doc["event"]["peripherals"]["camera"]["actualWidth"] = camera_state.actualWidth;
            }
            if (camera_state.actualHeight > 0) {
                doc["event"]["peripherals"]["camera"]["height"] = camera_state.actualHeight;
                doc["event"]["peripherals"]["camera"]["actualHeight"] = camera_state.actualHeight;
            }
            doc["event"]["peripherals"]["camera"]["fps"] =
                camera_state.intervalMs > 0 ? (1000.0f / static_cast<float>(camera_state.intervalMs)) : 0.0f;
            if (!camera_state.fallbackReason.empty()) {
                doc["event"]["peripherals"]["camera"]["fallbackReason"] = camera_state.fallbackReason.c_str();
            }
        } else {
            doc["event"]["peripherals"]["camera"]["reason"] = "driver_unavailable";
            doc["event"]["peripherals"]["camera"]["fallbackReason"] = "driver_unavailable";
        }

        doc["event"]["peripherals"]["rgb"]["available"] = io_expander_available;
        doc["event"]["peripherals"]["rgb"]["count"] = io_expander_available ? 12 : 0;
        doc["event"]["peripherals"]["rgb"]["enabled"] = _rgb_control_enabled;
        doc["event"]["peripherals"]["rgb"]["color"] = _rgb_control_color.c_str();
        doc["event"]["peripherals"]["rgb"]["brightness"] = _rgb_control_brightness;
        doc["event"]["peripherals"]["rgb"]["driver"] = "neon-light";
        if (!io_expander_available) {
            doc["event"]["peripherals"]["rgb"]["reason"] = "io_expander_unavailable";
        }
        const auto rtc_status = stackchan::hal::hardware::GetHardwareRegistry().module_status("rtc-pcf8563");
        doc["event"]["peripherals"]["rtc"]["available"] = rtc_status.available;
        if (rtc_status.available) {
            doc["event"]["peripherals"]["rtc"]["timestamp"] = iso_now();
            doc["event"]["peripherals"]["rtc"]["timezone"] = GetDeviceRuntime().getTimezone();
        } else if (!rtc_status.reason.empty()) {
            doc["event"]["peripherals"]["rtc"]["reason"] = rtc_status.reason.c_str();
        }

        doc["event"]["peripherals"]["nfc"]["available"] = peripherals.nfcAvailable;
        doc["event"]["peripherals"]["nfc"]["driver"] = peripherals.nfcDriver.c_str();
        doc["event"]["peripherals"]["nfc"]["address"] = peripherals.nfcAddress;
        if (!peripherals.nfcStatus.empty()) {
            doc["event"]["peripherals"]["nfc"]["status"] = peripherals.nfcStatus.c_str();
        }
        if (!peripherals.nfcAvailable && !peripherals.nfcReason.empty()) {
            doc["event"]["peripherals"]["nfc"]["reason"] = peripherals.nfcReason.c_str();
        }

        doc["event"]["peripherals"]["powerMonitor"]["available"] = peripherals.powerMonitorAvailable;
        doc["event"]["peripherals"]["powerMonitor"]["driver"] = peripherals.powerMonitorDriver.c_str();
        doc["event"]["peripherals"]["powerMonitor"]["address"] = peripherals.powerMonitorAddress;
        if (peripherals.powerMonitorAvailable) {
            doc["event"]["peripherals"]["powerMonitor"]["busVoltage"] = peripherals.powerMonitorBusVoltage;
            doc["event"]["peripherals"]["powerMonitor"]["shuntVoltage"] = peripherals.powerMonitorShuntVoltage;
            doc["event"]["peripherals"]["powerMonitor"]["current"] = peripherals.powerMonitorCurrent;
            doc["event"]["peripherals"]["powerMonitor"]["power"] = peripherals.powerMonitorPower;
        } else if (!peripherals.powerMonitorReason.empty()) {
            doc["event"]["peripherals"]["powerMonitor"]["reason"] = peripherals.powerMonitorReason.c_str();
        }

        doc["event"]["peripherals"]["ir"]["available"] = peripherals.irAvailable;
        doc["event"]["peripherals"]["ir"]["driver"] = peripherals.irDriver.c_str();
        doc["event"]["peripherals"]["ir"]["txPin"] = peripherals.irTxPin;
        doc["event"]["peripherals"]["ir"]["rxPin"] = peripherals.irRxPin;
        if (!peripherals.irAvailable && !peripherals.irReason.empty()) {
            doc["event"]["peripherals"]["ir"]["reason"] = peripherals.irReason.c_str();
        }

        doc["event"]["peripherals"]["proximity"]["available"] = peripherals.proximityAvailable;
        doc["event"]["peripherals"]["proximity"]["driver"] = peripherals.proximityDriver.c_str();
        if (peripherals.proximityAvailable) {
            doc["event"]["peripherals"]["proximity"]["value"] = peripherals.proximityValue;
            doc["event"]["peripherals"]["proximity"]["raw"] = peripherals.proximityRaw;
        } else if (!peripherals.proximityReason.empty()) {
            doc["event"]["peripherals"]["proximity"]["reason"] = peripherals.proximityReason.c_str();
        }

        doc["event"]["peripherals"]["ambientLight"]["available"] = peripherals.ambientLightAvailable;
        doc["event"]["peripherals"]["ambientLight"]["driver"] = peripherals.ambientLightDriver.c_str();
        if (peripherals.ambientLightAvailable) {
            doc["event"]["peripherals"]["ambientLight"]["lux"] = peripherals.ambientLightLux;
            doc["event"]["peripherals"]["ambientLight"]["raw"] = peripherals.ambientLightRaw;
        } else if (!peripherals.ambientLightReason.empty()) {
            doc["event"]["peripherals"]["ambientLight"]["reason"] = peripherals.ambientLightReason.c_str();
        }

        const bool mag_available = imu.magnetometerAvailable || peripherals.magnetometerAvailable;
        doc["event"]["peripherals"]["magnetometer"]["available"] = mag_available;
        doc["event"]["peripherals"]["magnetometer"]["driver"] = imu.magnetometerAvailable ? "bmi270-aux-bmm150" : peripherals.magnetometerDriver.c_str();
        if (imu.magnetometerAvailable) {
            doc["event"]["peripherals"]["magnetometer"]["x"] = imu.magnetometerX;
            doc["event"]["peripherals"]["magnetometer"]["y"] = imu.magnetometerY;
            doc["event"]["peripherals"]["magnetometer"]["z"] = imu.magnetometerZ;
            doc["event"]["peripherals"]["magnetometer"]["rawX"] = imu.magnetometerRawX;
            doc["event"]["peripherals"]["magnetometer"]["rawY"] = imu.magnetometerRawY;
            doc["event"]["peripherals"]["magnetometer"]["rawZ"] = imu.magnetometerRawZ;
            doc["event"]["peripherals"]["magnetometer"]["headingDeg"] = imu.magnetometerHeadingDeg;
        } else if (peripherals.magnetometerAvailable) {
            doc["event"]["peripherals"]["magnetometer"]["x"] = peripherals.magnetometerX;
            doc["event"]["peripherals"]["magnetometer"]["y"] = peripherals.magnetometerY;
            doc["event"]["peripherals"]["magnetometer"]["z"] = peripherals.magnetometerZ;
            doc["event"]["peripherals"]["magnetometer"]["rawX"] = peripherals.magnetometerRawX;
            doc["event"]["peripherals"]["magnetometer"]["rawY"] = peripherals.magnetometerRawY;
            doc["event"]["peripherals"]["magnetometer"]["rawZ"] = peripherals.magnetometerRawZ;
            doc["event"]["peripherals"]["magnetometer"]["headingDeg"] = peripherals.magnetometerHeadingDeg;
        } else if (!peripherals.magnetometerReason.empty()) {
            doc["event"]["peripherals"]["magnetometer"]["reason"] = peripherals.magnetometerReason.c_str();
        }

        if (cache.includeI2cScan) {
            auto i2c_scans = doc["event"]["peripherals"]["i2cScan"].to<ArduinoJson::JsonArray>();
            for (const auto& scan : peripherals.i2cScans) {
                auto scan_doc = i2c_scans.add<ArduinoJson::JsonObject>();
                scan_doc["stage"] = scan.stage.data();
                scan_doc["uptimeMs"] = scan.uptimeMs;
                auto addresses = scan_doc["addresses"].to<ArduinoJson::JsonArray>();
                for (const auto address : scan.addresses) {
                    addresses.add(static_cast<int>(address));
                }
                scan_doc["targets"]["ltr553"] = scan.foundLtr553;
                scan_doc["targets"]["ina226"] = scan.foundIna226;
                scan_doc["targets"]["nfc"] = scan.foundNfc;
                if (!scan.reason.empty()) {
                    scan_doc["reason"] = scan.reason.c_str();
                }
            }
        }

        doc["event"]["peripherals"]["mic"]["available"] = mic.available;
        if (mic.channels > 0) {
            doc["event"]["peripherals"]["mic"]["channels"] = mic.channels;
        }
        doc["event"]["peripherals"]["mic"]["mode"] = "mono_opus";
        doc["event"]["peripherals"]["mic"]["localization"] = "abandoned";
        doc["event"]["peripherals"]["mic"]["driver"] = "es7210-level-meter";
        if (mic.available) {
            doc["event"]["peripherals"]["mic"]["level"] = mic.level;
            doc["event"]["peripherals"]["mic"]["rms"] = mic.rms;
            doc["event"]["peripherals"]["mic"]["peak"] = mic.peak;
            doc["event"]["peripherals"]["mic"]["dbfs"] = mic.dbfs;
            doc["event"]["peripherals"]["mic"]["updatedAt"] = mic.updatedAt;
            if (!mic.reason.empty()) {
                doc["event"]["peripherals"]["mic"]["reason"] = mic.reason.c_str();
            }
        } else if (!mic.reason.empty()) {
            doc["event"]["peripherals"]["mic"]["reason"] = mic.reason.c_str();
        }

        send_json(doc);
    }

    void send_pending_head_touch()
    {
        HeadPetGesture gesture = HeadPetGesture::None;
        {
            std::lock_guard<std::mutex> lock(_sensor_mutex);
            if (!_has_pending_head_touch) {
                return;
            }
            gesture                 = _pending_head_touch;
            _has_pending_head_touch = false;
        }

        ArduinoJson::JsonDocument doc;
        prepare_event_doc(doc, "touch");
        doc["event"]["surface"] = "head";
        doc["event"]["gesture"] = head_touch_gesture_to_string(gesture);
        doc["event"]["pressed"] = gesture != HeadPetGesture::Release;
        send_json(doc);
    }

    void send_screen_touch_if_needed(uint32_t now)
    {
        if (now - _last_screen_touch_event_time < 100) {
            return;
        }

        auto touch = embedded_runtime_bridge::get_touch_point();
        const bool changed = !_last_screen_touch_valid || touch.num != _last_screen_touch.num ||
                             touch.x != _last_screen_touch.x || touch.y != _last_screen_touch.y;
        if (!changed) {
            return;
        }

        _last_screen_touch_event_time = now;
        _last_screen_touch            = touch;
        _last_screen_touch_valid      = true;

        ArduinoJson::JsonDocument doc;
        prepare_event_doc(doc, "touch");
        doc["event"]["surface"] = "screen";
        doc["event"]["gesture"] = touch.num > 0 ? "press" : "release";
        doc["event"]["pressed"] = touch.num > 0;
        doc["event"]["points"]  = std::max(0, std::min(5, touch.num));
        if (touch.num > 0) {
            doc["event"]["x"] = std::max(0, std::min(320, touch.x));
            doc["event"]["y"] = std::max(0, std::min(240, touch.y));
        }
        send_json(doc);
    }

    bool send_camera_frame(const uint8_t* jpeg_data, size_t jpeg_len, int width, int height,
                           const std::string& capture_timestamp, uint32_t total_start_ms)
    {
        const uint32_t frame_id = next_camera_frame_id();
        const uint32_t seq = next_outgoing_seq();
        bool binary_camera_frame_enabled = false;
        {
            std::lock_guard<std::mutex> lock(_camera_mutex);
            binary_camera_frame_enabled = _binary_camera_frame_enabled;
        }
        if (binary_camera_frame_enabled &&
            send_binary_camera_frame(jpeg_data, jpeg_len, width, height, frame_id, seq, capture_timestamp,
                                     total_start_ms)) {
            return true;
        }

        size_t encoded_len = 0;
        mbedtls_base64_encode(nullptr, 0, &encoded_len, jpeg_data, jpeg_len);

        std::string encoded(encoded_len, '\0');
        if (mbedtls_base64_encode((unsigned char*)encoded.data(), encoded.size(), &encoded_len, jpeg_data, jpeg_len) != 0) {
            return false;
        }
        encoded.resize(encoded_len);

        const std::string sent_at = iso_now();
        ArduinoJson::JsonDocument doc;
        doc["seq"]                 = seq;
        doc["type"]                = "robot.event";
        doc["eventId"]             = GetDeviceRuntime().getFactoryMacString("") + "-frame-" + std::to_string(frame_id);
        doc["deviceId"]            = GetDeviceRuntime().getFactoryMacString(":");
        doc["timestamp"]           = capture_timestamp;
        doc["event"]["kind"]       = "cameraFrame";
        doc["event"]["frameId"]    = std::to_string(frame_id);
        doc["event"]["mimeType"]   = "image/jpeg";
        doc["event"]["width"]      = width;
        doc["event"]["height"]     = height;
        doc["event"]["dataBase64"] = encoded;
        doc["event"]["seq"]        = seq;
        doc["event"]["captureTimestamp"] = capture_timestamp;
        doc["event"]["sentAt"]     = sent_at;
        doc["event"]["trace"]["deviceCapturedAt"] = capture_timestamp;
        doc["event"]["trace"]["deviceSentAt"] = sent_at;
        return send_json(doc, OutboundPriority::Camera, true, total_start_ms,
                         static_cast<uint32_t>(std::min<size_t>(jpeg_len, UINT32_MAX)));
    }

    bool send_binary_camera_frame(const uint8_t* jpeg_data, size_t jpeg_len, int width, int height, uint32_t frame_id,
                                  uint32_t seq, const std::string& capture_timestamp, uint32_t total_start_ms)
    {
        if (jpeg_data == nullptr || jpeg_len == 0) {
            return false;
        }

        ArduinoJson::JsonDocument header_doc;
        header_doc["frameId"] = std::to_string(frame_id);
        header_doc["deviceId"] = GetDeviceRuntime().getFactoryMacString(":");
        const std::string sent_at = iso_now();
        header_doc["timestamp"] = capture_timestamp;
        header_doc["mimeType"] = "image/jpeg";
        header_doc["width"] = width;
        header_doc["height"] = height;
        header_doc["byteLength"] = jpeg_len;
        header_doc["transport"] = "binary";
        header_doc["seq"] = seq;
        header_doc["captureTimestamp"] = capture_timestamp;
        header_doc["sentAt"] = sent_at;

        std::string header;
        ArduinoJson::serializeJson(header_doc, header);
        if (header.empty() || header.size() > 0xffff) {
            return false;
        }

        std::vector<uint8_t> envelope;
        envelope.resize(8 + header.size() + jpeg_len);
        envelope[0] = 'S';
        envelope[1] = 'C';
        envelope[2] = 'L';
        envelope[3] = '1';
        envelope[4] = kBinaryCameraFrameKind;
        envelope[5] = 0;
        envelope[6] = static_cast<uint8_t>((header.size() >> 8) & 0xff);
        envelope[7] = static_cast<uint8_t>(header.size() & 0xff);
        memcpy(envelope.data() + 8, header.data(), header.size());
        memcpy(envelope.data() + 8 + header.size(), jpeg_data, jpeg_len);
        OutboundMessage message;
        message.priority = OutboundPriority::Camera;
        message.binary = true;
        message.cameraFrame = true;
        message.cameraTotalStartMs = total_start_ms;
        message.cameraJpegBytes = static_cast<uint32_t>(std::min<size_t>(jpeg_len, UINT32_MAX));
        message.bytes = std::move(envelope);
        return enqueue_outbound(std::move(message));
    }

    void send_handshake()
    {
        ArduinoJson::JsonDocument doc;
        auto app_desc = esp_app_get_description();

        doc["type"]            = "handshake";
        doc["deviceId"]        = GetDeviceRuntime().getFactoryMacString(":");
        doc["firmwareVersion"] = app_desc ? app_desc->version : "local-unknown";
        doc["pairingToken"]    = _token;

        auto capabilities = doc["capabilities"].to<ArduinoJson::JsonArray>();
        capabilities.add("audio");
        capabilities.add("camera");
        capabilities.add("motion");
        capabilities.add("face");
        capabilities.add("rgb");
        capabilities.add("touch");
        capabilities.add("imu");
        capabilities.add("battery");
        capabilities.add("wifi");
        capabilities.add("ble");
        capabilities.add("rtc");
        capabilities.add("servos");
        capabilities.add("nfc");
        capabilities.add("ir");
        capabilities.add("proximity");
        capabilities.add("ambientLight");
        capabilities.add("magnetometer");
        capabilities.add("mic");
        capabilities.add("display");
        capabilities.add("bleProvisioning");
        capabilities.add("mediaCredit");

        doc["audioParams"]["format"]          = "opus";
        doc["audioParams"]["sampleRate"]      = 16000;
        doc["audioParams"]["channels"]        = 1;
        doc["audioParams"]["frameDurationMs"] = 30;

        send_json(doc, OutboundPriority::Critical);
    }

    void send_heartbeat()
    {
        ArduinoJson::JsonDocument doc;
        doc["type"]      = "heartbeat";
        doc["seq"]       = next_outgoing_seq();
        doc["deviceId"]  = GetDeviceRuntime().getFactoryMacString(":");
        doc["timestamp"] = iso_now();
        send_json(doc, OutboundPriority::Critical);
    }

    void send_state_event(const char* mode, const char* detail)
    {
        ArduinoJson::JsonDocument doc;
        prepare_event_doc(doc, "state");
        doc["event"]["kind"]   = "state";
        doc["event"]["mode"]   = mode;
        doc["event"]["detail"] = detail;
        send_json(doc);
    }

    void send_command_ack(const char* command_id, const char* command_kind, const char* request_id, bool accepted,
                          const char* message)
    {
        ArduinoJson::JsonDocument doc;
        prepare_event_doc(doc, "commandAck");
        doc["event"]["commandId"]   = command_id ? command_id : "";
        doc["event"]["commandKind"] = known_command_kind_or_unknown(command_kind);
        doc["event"]["status"]      = accepted ? "accepted" : "rejected";
        if (request_id && strlen(request_id) > 0) {
            doc["event"]["requestId"] = request_id;
        }
        if (message && strlen(message) > 0) {
            doc["event"]["message"] = message;
        }
        send_json(doc, OutboundPriority::Critical);
    }

    void send_command_status(const char* command_id, const char* command_kind, const char* request_id, const char* status,
                             const char* message, float progress)
    {
        ArduinoJson::JsonDocument doc;
        prepare_event_doc(doc, "commandStatus");
        doc["event"]["commandId"]   = command_id ? command_id : "";
        doc["event"]["commandKind"] = known_command_kind_or_unknown(command_kind);
        doc["event"]["status"]      = status ? status : "completed";
        doc["event"]["progress"]    = clamp_float(progress, 0.0f, 1.0f);
        if (request_id && strlen(request_id) > 0) {
            doc["event"]["requestId"] = request_id;
        }
        if (message && strlen(message) > 0) {
            doc["event"]["message"] = message;
        }
        send_json(doc, OutboundPriority::Critical);
    }

    void send_playback_event(const char* request_id, const char* state, const char* message)
    {
        ArduinoJson::JsonDocument doc;
        prepare_event_doc(doc, "playback");
        doc["event"]["requestId"] = request_id ? request_id : "";
        doc["event"]["state"]     = state ? state : "failed";
        if (message && strlen(message) > 0) {
            doc["event"]["message"] = message;
        }
        send_json(doc, OutboundPriority::Critical);
    }

    bool handle_capture_image(const char* command_id, const char* request_id)
    {
        auto camera = stackchan::hal::hardware::GetHardwareRegistry().camera();
        if (!camera) {
            send_error("capture_failed", "camera capture failed", true, command_id);
            return false;
        }

        embedded_runtime_bridge::app_play_sound(OGG_CAMERA_SHUTTER);

        std::string encoded;
        {
            std::lock_guard<std::mutex> hardware_lock(_camera_hardware_mutex);
            if (!camera->Capture() || camera->GetFrameData() == nullptr || camera->GetFrameSize() == 0) {
                send_error("capture_failed", "camera capture failed", true, command_id);
                return false;
            }

            size_t encoded_len = 0;
            auto frame_data    = camera->GetFrameData();
            auto frame_size    = camera->GetFrameSize();
            mbedtls_base64_encode(nullptr, 0, &encoded_len, frame_data, frame_size);

            encoded.assign(encoded_len, '\0');
            if (mbedtls_base64_encode((unsigned char*)encoded.data(), encoded.size(), &encoded_len, frame_data, frame_size) != 0) {
                send_error("capture_encode_failed", "camera frame base64 encode failed", true, command_id);
                return false;
            }
            encoded.resize(encoded_len);
        }

        ArduinoJson::JsonDocument doc;
        prepare_event_doc(doc, "image");
        doc["event"]["kind"]     = "image";
        doc["event"]["requestId"] = request_id;
        doc["event"]["mimeType"] = "image/jpeg";
        doc["event"]["dataBase64"] = encoded;
        send_json(doc);
        return true;
    }

    void send_error(const char* code, const char* message, bool recoverable, const char* command_id)
    {
        ArduinoJson::JsonDocument doc;
        doc["type"]        = "error";
        doc["code"]        = code;
        doc["message"]     = message;
        doc["recoverable"] = recoverable;
        if (command_id && strlen(command_id) > 0) {
            doc["commandId"] = command_id;
        }
        send_json(doc, OutboundPriority::Critical);
    }

    bool send_json(ArduinoJson::JsonDocument& doc, OutboundPriority priority = OutboundPriority::Normal,
                   bool camera_frame = false, uint32_t camera_total_start_ms = 0, uint32_t camera_jpeg_bytes = 0)
    {
        std::string payload;
        ArduinoJson::serializeJson(doc, payload);
        OutboundMessage message;
        message.priority = priority;
        message.binary = false;
        message.cameraFrame = camera_frame;
        message.cameraTotalStartMs = camera_total_start_ms;
        message.cameraJpegBytes = camera_jpeg_bytes;
        message.text = std::move(payload);
        return enqueue_outbound(std::move(message));
    }
};

class LocalCompanionWorker : public mooncake::BasicAbility {
public:
    explicit LocalCompanionWorker(std::function<void(std::string_view)> onStartLog)
    {
        _service = std::make_unique<LocalCompanionSocket>();
        _service->init(std::move(onStartLog));
    }

    void onRunning() override
    {
        if (GetDeviceRuntime().millis() - _last_tick < kWorkerTickIntervalMs) {
            return;
        }
        _last_tick = GetDeviceRuntime().millis();
        _service->update();
    }

    void onDestroy() override
    {
        _service.reset();
        _local_state = LocalCompanionState::Idle;
    }

private:
    std::unique_ptr<LocalCompanionSocket> _service;
    uint32_t _last_tick = 0;
};

}  // namespace

void DeviceRuntime::startLocalCompanionService(std::function<void(std::string_view)> onStartLog)
{
    mclog::tagInfo(_tag, "start local companion service");
    startNetwork(onStartLog);
    mooncake::GetMooncake().extensionManager()->createAbility(std::make_unique<LocalCompanionWorker>(std::move(onStartLog)));
}

LocalCompanionState DeviceRuntime::getLocalCompanionState()
{
    return _local_state;
}

LocalFaceTrackingTarget DeviceRuntime::getLocalFaceTrackingTarget()
{
    std::lock_guard<std::mutex> lock(_face_tracking_mutex);
    const auto now = millis();
    if (!_face_tracking_target.detected && _face_tracking_target.reserved && _face_tracking_hold_until > 0 &&
        now > _face_tracking_hold_until) {
        _face_tracking_target.reserved = false;
        _face_tracking_hold_until      = 0;
    }
    return _face_tracking_target;
}
