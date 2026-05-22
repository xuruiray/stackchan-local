/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include "hal.h"

#include "board/hal_bridge.h"
#include "local_companion/protocol_utils.h"
#include <ArduinoJson.hpp>
#include <board.h>
#include <esp_app_desc.h>
#include <esp_err.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <mbedtls/base64.h>
#include <mdns.h>
#include <mooncake.h>
#include <mooncake_log.h>
#include <settings.h>
#include <robot_expression_motion_runtime/stackchan.h>
#include <web_socket.h>
#include <wifi_manager.h>
#include <jpg/image_to_jpeg.h>
#include <lwip/ip_addr.h>
#include <algorithm>
#include <ctime>
#include <cstring>
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

struct PlaybackTaskArg {
    class LocalCompanionSocket* owner = nullptr;
    std::string requestId;
    int volume = -1;
    std::string audio;
};

static constexpr size_t kMaxAudioBytes = 262144;
static constexpr size_t kMaxAudioChunkBase64Bytes = 8192;
static constexpr size_t kMaxAudioChunks = 128;

using namespace stackchan::hal::local_companion;

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

    std::string hostname = "stackchan-" + GetHAL().getFactoryMacString("");
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
        if (err != ESP_ERR_NOT_FOUND) {
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

class LocalCompanionSocket {
public:
    ~LocalCompanionSocket()
    {
        if (_head_touch_connection >= 0) {
            GetHAL().onHeadPetGesture.disconnect(_head_touch_connection);
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

        _head_touch_connection = GetHAL().onHeadPetGesture.connect([this](HeadPetGesture gesture) {
            std::lock_guard<std::mutex> lock(_sensor_mutex);
            _pending_head_touch     = gesture;
            _has_pending_head_touch = true;
        });

        connect();
    }

    void update()
    {
        if (!_websocket) {
            reconnect_if_needed();
            return;
        }

        if (!_websocket->IsConnected()) {
            reconnect_if_needed();
            return;
        }

        process_messages();
        send_pending_playback_events();

        const auto now = GetHAL().millis();
        if (now - _last_heartbeat_time > 5000) {
            send_heartbeat();
            _last_heartbeat_time = now;
        }

        capture_stream_frame_if_needed(now);
        send_sensor_events_if_needed(now);
    }

private:
    std::unique_ptr<WebSocket> _websocket;
    std::string _url;
    std::string _fallback_url;
    std::string _token;
    std::function<void(std::string_view)> _on_start_log;
    std::mutex _mutex;
    std::mutex _sensor_mutex;
    std::mutex _playback_event_mutex;
    std::queue<ReceivedMessage> _msg_queue;
    std::queue<PlaybackEvent> _playback_events;
    AudioTransferState _audio_transfer;
    uint32_t _last_reconnect_attempt = 0;
    uint32_t _last_heartbeat_time    = 0;
    uint32_t _last_camera_frame_time = 0;
    uint32_t _last_battery_event_time = 0;
    uint32_t _last_wifi_event_time = 0;
    uint32_t _last_imu_event_time = 0;
    uint32_t _last_sensor_snapshot_event_time = 0;
    uint32_t _last_screen_touch_event_time = 0;
    uint32_t _camera_stream_interval_ms = 250;
    uint32_t _camera_frame_id = 0;
    uint32_t _event_counter = 0;
    std::mutex _camera_mutex;
    int _camera_requested_width = 320;
    int _camera_requested_height = 240;
    int _camera_jpeg_quality = 20;
    std::string _camera_fallback_reason;
    bool _rgb_control_enabled = false;
    std::string _rgb_control_color = "#000000";
    float _rgb_control_brightness = 1.0f;
    hal_bridge::TouchPoint_t _last_screen_touch;
    HeadPetGesture _pending_head_touch = HeadPetGesture::None;
    int _head_touch_connection = -1;
    bool _use_mdns                   = true;
    bool _camera_stream_enabled      = false;
    bool _last_screen_touch_valid    = false;
    bool _has_pending_head_touch     = false;

    void connect()
    {
        _local_state = LocalCompanionState::Connecting;
        if (_on_start_log) {
            _on_start_log("Connecting");
        }

        _websocket.reset();
        _url = _fallback_url;
        if (_use_mdns) {
            auto discovered_url = discover_daemon_url();
            if (!discovered_url.empty()) {
                _url = std::move(discovered_url);
                mclog::tagInfo(_tag, "mDNS discovered daemon at {}", _url);
            } else {
                mclog::tagWarn(_tag, "mDNS discovery failed, using fallback {}", _fallback_url);
            }
        }

        auto& board  = Board::GetInstance();
        auto network = board.GetNetwork();
        _websocket   = network->CreateWebSocket(1);

        if (!_websocket) {
            _local_state = LocalCompanionState::Error;
            mclog::tagError(_tag, "failed to create websocket");
            return;
        }

        _websocket->OnConnected([this]() {
            mclog::tagInfo(_tag, "connected to local daemon");
            _local_state          = LocalCompanionState::Connected;
            _last_heartbeat_time = GetHAL().millis();
            send_handshake();
        });

        _websocket->OnDisconnected([this]() {
            mclog::tagWarn(_tag, "local daemon disconnected");
            if (_local_state != LocalCompanionState::PairingFailed) {
                _local_state = LocalCompanionState::Disconnected;
            }
        });

        _websocket->OnData([this](const char* data, size_t len, bool binary) {
            std::lock_guard<std::mutex> lock(_mutex);
            _msg_queue.push({binary, std::vector<uint8_t>(data, data + len)});
        });

        if (!_websocket->Connect(_url.c_str())) {
            _local_state = LocalCompanionState::Disconnected;
            mclog::tagWarn(_tag, "failed to connect to {}", _url);
        }
        _last_reconnect_attempt = GetHAL().millis();
    }

    void reconnect_if_needed()
    {
        if (_local_state == LocalCompanionState::PairingFailed) {
            return;
        }

        const auto now = GetHAL().millis();
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
            _local_state = LocalCompanionState::Connected;
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

    void handle_command(ArduinoJson::JsonObject doc)
    {
        auto command = doc["command"].as<ArduinoJson::JsonObject>();
        const char* command_id = doc["commandId"] | "";
        const char* kind       = command["kind"] | "";
        if (strcmp(kind, "trackFace") != 0 && strcmp(kind, "cameraStream") != 0) {
            GetHAL().onLocalCompanionActivity.emit(kind);
        }

        if (strcmp(kind, "say") == 0) {
            WsTextMessage_t message;
            message.name    = "Codex";
            message.content = command["text"].as<std::string>();
            GetHAL().onWsTextMessage.emit(message);
            send_command_ack(command_id, kind, nullptr, true, "accepted");
            send_state_event("speaking", "say command");
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
            GetHAL().onWsReactMessage.emit(message);
            send_command_ack(command_id, kind, nullptr, true, "accepted");
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
            return;
        }

        if (strcmp(kind, "cameraStream") == 0) {
            const bool stream_enabled = command["enabled"] | false;
            bool was_stream_enabled = false;
            int fps = command["fps"] | 4;
            fps = std::max(1, std::min(10, fps));
            _camera_requested_width = std::max(1, command["width"] | _camera_requested_width);
            _camera_requested_height = std::max(1, command["height"] | _camera_requested_height);
            _camera_jpeg_quality = std::max(1, std::min(100, command["quality"] | _camera_jpeg_quality));
            _camera_fallback_reason.clear();
            const bool unsupported_resolution = _camera_requested_width * _camera_requested_height > 320 * 240;
            if (unsupported_resolution) {
                _camera_requested_width = 320;
                _camera_requested_height = 240;
                _camera_jpeg_quality = std::min(_camera_jpeg_quality, 35);
                _camera_fallback_reason = "vga_disabled_for_stability";
            }
            _camera_stream_interval_ms = 1000 / fps;

            {
                std::lock_guard<std::mutex> lock(_camera_mutex);
                was_stream_enabled = _camera_stream_enabled;
                _camera_stream_enabled = false;
                auto camera = hal_bridge::board_get_camera();
                if (camera) {
                    const bool width_matches =
                        camera->GetFrameWidth() <= 0 || camera->GetFrameWidth() == _camera_requested_width;
                    const bool height_matches =
                        camera->GetFrameHeight() <= 0 || camera->GetFrameHeight() == _camera_requested_height;
                    if (!width_matches || !height_matches) {
                        const bool resized = camera->SetFrameSize(_camera_requested_width, _camera_requested_height);
                        const bool resized_width_matches =
                            camera->GetFrameWidth() <= 0 || camera->GetFrameWidth() == _camera_requested_width;
                        const bool resized_height_matches =
                            camera->GetFrameHeight() <= 0 || camera->GetFrameHeight() == _camera_requested_height;
                        if (!resized || !resized_width_matches || !resized_height_matches) {
                            _camera_fallback_reason = "runtime_resolution_change_failed";
                        }
                    }
                } else if (stream_enabled) {
                    _camera_fallback_reason = "driver_unavailable";
                }
                _camera_stream_enabled = stream_enabled;
            }
            if (!_camera_stream_enabled) {
                _last_camera_frame_time = 0;
            }
            if (_camera_stream_enabled && !was_stream_enabled) {
                std::lock_guard<std::mutex> lock(_face_tracking_mutex);
                _face_tracking_target.updatedAt = GetHAL().millis();
                _face_tracking_target.detected = false;
                _face_tracking_target.reserved = true;
                _face_tracking_target.recenterOnLost = true;
                _face_tracking_target.speed = std::max(_face_tracking_target.speed, 420);
                _face_tracking_hold_until = GetHAL().millis() + 3500;
            }
            send_command_ack(command_id, kind, nullptr, true, "accepted");
            return;
        }

        if (strcmp(kind, "trackFace") == 0) {
            handle_track_face(command);
            send_command_ack(command_id, kind, nullptr, true, "accepted");
            return;
        }

        if (strcmp(kind, "playAnimation") == 0) {
            std::string sequence_json;
            ArduinoJson::serializeJson(command["sequence"], sequence_json);
            GetHAL().onWsDanceData.emit(sequence_json);
            send_command_ack(command_id, kind, nullptr, true, "accepted");
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
            } else {
                send_command_ack(command_id, kind, request_id, false, "capture failed");
            }
            return;
        }

        if (strcmp(kind, "setMode") == 0) {
            const char* mode = command["mode"] | "idle";
            _local_state = mode_from_string(mode);
            send_command_ack(command_id, kind, nullptr, true, "accepted");
            send_state_event(mode, command["reason"] | "setMode command");
            return;
        }

        send_command_ack(command_id, kind, nullptr, false, "unsupported robot command");
        send_error("unknown_command", "unsupported robot command", true, command_id);
    }

    void handle_track_face(ArduinoJson::JsonObject command)
    {
        const bool detected = command["detected"] | false;
        std::lock_guard<std::mutex> lock(_face_tracking_mutex);
        _face_tracking_target.updatedAt = GetHAL().millis();
        _face_tracking_target.speed     = std::max(0, std::min(1000, command["speed"] | 420));
        update_tracking_control(_face_tracking_target.control, command["control"].as<ArduinoJson::JsonObject>());

        if (!detected) {
            const char* reason = command["reason"] | "";
            _face_tracking_target.detected = false;
            _face_tracking_target.reserved = true;
            _face_tracking_target.recenterOnLost =
                strcmp(reason, "face_lost") == 0 || strcmp(reason, "tracking_enabled") == 0;
            _face_tracking_hold_until      = GetHAL().millis() + 3500;
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
            GetHAL().onWsTextMessage.emit(message);
        }

        send_command_ack(command_id, "playAudioEnd", request_id, true, "accepted");
        send_state_event("speaking", "playAudio command");
        send_playback_event(request_id, "started", "");
        start_playback_task(request_id, std::move(audio), volume);
    }

    void reject_audio_command(const char* command_id, const char* kind, const char* request_id, const char* message)
    {
        send_command_ack(command_id, kind, request_id, false, message);
        send_error("invalid_audio_command", message, true, command_id);
    }

    void start_playback_task(const char* request_id, std::string audio, int volume)
    {
        auto* arg     = new PlaybackTaskArg();
        arg->owner    = this;
        arg->requestId = request_id ? request_id : "";
        arg->volume   = volume;
        arg->audio    = std::move(audio);
        const BaseType_t created =
            xTaskCreate(&LocalCompanionSocket::playback_task, "local_audio_playback", 8192, arg, 4, nullptr);
        if (created != pdPASS) {
            std::string failed_request = arg->requestId;
            delete arg;
            send_playback_event(failed_request.c_str(), "failed", "failed to create playback task");
        }
    }

    static void playback_task(void* param)
    {
        std::unique_ptr<PlaybackTaskArg> arg(static_cast<PlaybackTaskArg*>(param));
        hal_bridge::app_play_sound_and_wait(std::string_view(arg->audio.data(), arg->audio.size()), arg->volume);
        if (arg->owner) {
            arg->owner->queue_playback_event(arg->requestId, "finished", "");
        }
        vTaskDelete(nullptr);
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

    void capture_stream_frame_if_needed(uint32_t now)
    {
        if (!_camera_stream_enabled || now - _last_camera_frame_time < _camera_stream_interval_ms) {
            return;
        }
        _last_camera_frame_time = now;

        auto camera = hal_bridge::board_get_camera();
        if (!camera) {
            return;
        }

        uint8_t* jpeg_data = nullptr;
        size_t jpeg_len    = 0;
        int frame_width    = 0;
        int frame_height   = 0;
        {
            std::lock_guard<std::mutex> lock(_camera_mutex);
            if (!_camera_stream_enabled) {
                return;
            }
            if (!camera->StreamCaptures() || camera->GetFrameData() == nullptr || camera->GetFrameSize() == 0) {
                return;
            }
            frame_width  = camera->GetFrameWidth();
            frame_height = camera->GetFrameHeight();
            if (!image_to_jpeg((uint8_t*)camera->GetFrameData(), camera->GetFrameSize(), frame_width, frame_height,
                               (v4l2_pix_fmt_t)camera->GetFrameFormat(), _camera_jpeg_quality, &jpeg_data, &jpeg_len)) {
                if (jpeg_data) {
                    free(jpeg_data);
                }
                return;
            }
        }

        send_camera_frame(jpeg_data, jpeg_len, frame_width, frame_height);
        free(jpeg_data);
    }

    void send_sensor_events_if_needed(uint32_t now)
    {
        send_pending_head_touch();
        send_screen_touch_if_needed(now);

        if (now - _last_imu_event_time >= 250) {
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

        if (now - _last_sensor_snapshot_event_time >= 1000) {
            send_sensor_snapshot_event(now);
            _last_sensor_snapshot_event_time = now;
        }
    }

    void prepare_event_doc(ArduinoJson::JsonDocument& doc, const char* kind)
    {
        doc["type"]          = "robot.event";
        doc["eventId"]       = GetHAL().getFactoryMacString("") + "-" + kind + "-" + std::to_string(_event_counter++);
        doc["deviceId"]      = GetHAL().getFactoryMacString(":");
        doc["timestamp"]     = iso_now();
        doc["event"]["kind"] = kind;
    }

    void send_battery_event()
    {
        ArduinoJson::JsonDocument doc;
        prepare_event_doc(doc, "battery");
        doc["event"]["level"]    = std::min<uint8_t>(100, GetHAL().getBatteryLevel());
        doc["event"]["charging"] = GetHAL().isBatteryCharging();
        send_json(doc);
    }

    void send_wifi_event()
    {
        auto& wifi = WifiManager::GetInstance();

        ArduinoJson::JsonDocument doc;
        prepare_event_doc(doc, "wifi");
        if (wifi.IsConnected()) {
            doc["event"]["status"] = "connected";
            doc["event"]["rssi"]   = wifi.GetRssi();
            auto ssid              = wifi.GetSsid();
            if (!ssid.empty()) {
                doc["event"]["ssid"] = ssid;
            }
        } else if (wifi.IsConfigMode()) {
            doc["event"]["status"] = "connecting";
        } else {
            doc["event"]["status"] = "disconnected";
        }
        send_json(doc);
    }

    void send_imu_event()
    {
        const auto imu = GetHAL().getLocalImuSnapshot();
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
        auto& wifi = WifiManager::GetInstance();
        auto camera = hal_bridge::board_get_camera();
        const auto touch = hal_bridge::get_touch_point();
        const auto head_touch = GetHAL().getLocalHeadTouchSnapshot();
        const auto imu = GetHAL().getLocalImuSnapshot();
        const auto mic = GetHAL().getMicLevelSnapshot();
        const auto peripherals = GetHAL().getLocalPeripheralProbeSnapshot();

        ArduinoJson::JsonDocument doc;
        prepare_event_doc(doc, "sensorSnapshot");
        doc["event"]["uptimeMs"] = now;

        doc["event"]["power"]["batteryLevel"] = std::min<uint8_t>(100, GetHAL().getBatteryLevel());
        doc["event"]["power"]["charging"] = GetHAL().isBatteryCharging();
        doc["event"]["power"]["backlight"] = std::min<uint8_t>(100, GetHAL().getBackLightBrightness());
        doc["event"]["power"]["speakerVolume"] = std::min<uint8_t>(100, GetHAL().getSpeakerVolume());
        doc["event"]["power"]["servoPower"] = GetHAL().isServoPowerEnabled();

        if (wifi.IsConnected()) {
            doc["event"]["network"]["wifi"]["status"] = "connected";
            doc["event"]["network"]["wifi"]["rssi"] = wifi.GetRssi();
            auto ssid = wifi.GetSsid();
            if (!ssid.empty()) {
                doc["event"]["network"]["wifi"]["ssid"] = ssid;
            }
        } else if (wifi.IsConfigMode()) {
            doc["event"]["network"]["wifi"]["status"] = "connecting";
        } else {
            doc["event"]["network"]["wifi"]["status"] = "disconnected";
        }
        doc["event"]["network"]["ble"]["available"] = true;
        doc["event"]["network"]["ble"]["connected"] = GetHAL().isBleConnected();
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
        doc["event"]["motion"]["servos"]["power"] = GetHAL().isServoPowerEnabled();
        auto& motion = GetStackChan().motion();
        doc["event"]["motion"]["servos"]["yaw"]["angle"] = motion.yawServo().getCurrentAngle() / 10.0f;
        doc["event"]["motion"]["servos"]["yaw"]["moving"] = motion.yawServo().isMoving();
        doc["event"]["motion"]["servos"]["yaw"]["torque"] = motion.yawServo().getTorqueEnabled();
        doc["event"]["motion"]["servos"]["pitch"]["angle"] = motion.pitchServo().getCurrentAngle() / 10.0f;
        doc["event"]["motion"]["servos"]["pitch"]["moving"] = motion.pitchServo().isMoving();
        doc["event"]["motion"]["servos"]["pitch"]["torque"] = motion.pitchServo().getTorqueEnabled();

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

        const bool io_expander_available = GetHAL().isIoExpanderAvailable();
        doc["event"]["peripherals"]["ioExpander"]["available"] = io_expander_available;
        if (!io_expander_available) {
            doc["event"]["peripherals"]["ioExpander"]["reason"] = "driver_unavailable";
        }

        doc["event"]["peripherals"]["camera"]["available"] = camera != nullptr;
        doc["event"]["peripherals"]["camera"]["streaming"] = _camera_stream_enabled;
        doc["event"]["peripherals"]["camera"]["requestedWidth"] = _camera_requested_width;
        doc["event"]["peripherals"]["camera"]["requestedHeight"] = _camera_requested_height;
        doc["event"]["peripherals"]["camera"]["quality"] = _camera_jpeg_quality;
        if (camera) {
            if (camera->GetFrameWidth() > 0) {
                doc["event"]["peripherals"]["camera"]["width"] = camera->GetFrameWidth();
                doc["event"]["peripherals"]["camera"]["actualWidth"] = camera->GetFrameWidth();
            }
            if (camera->GetFrameHeight() > 0) {
                doc["event"]["peripherals"]["camera"]["height"] = camera->GetFrameHeight();
                doc["event"]["peripherals"]["camera"]["actualHeight"] = camera->GetFrameHeight();
            }
            doc["event"]["peripherals"]["camera"]["fps"] =
                _camera_stream_interval_ms > 0 ? (1000.0f / static_cast<float>(_camera_stream_interval_ms)) : 0.0f;
            if (!_camera_fallback_reason.empty()) {
                doc["event"]["peripherals"]["camera"]["fallbackReason"] = _camera_fallback_reason.c_str();
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
        doc["event"]["peripherals"]["rtc"]["available"] = true;
        doc["event"]["peripherals"]["rtc"]["timestamp"] = iso_now();
        doc["event"]["peripherals"]["rtc"]["timezone"] = GetHAL().getTimezone();

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

        auto i2c_scans = doc["event"]["peripherals"]["i2cScan"].to<ArduinoJson::JsonArray>();
        for (const auto& scan : peripherals.i2cScans) {
            auto scan_doc = i2c_scans.add<ArduinoJson::JsonObject>();
            scan_doc["stage"] = scan.stage.c_str();
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

        auto touch = hal_bridge::get_touch_point();
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

    void send_camera_frame(const uint8_t* jpeg_data, size_t jpeg_len, int width, int height)
    {
        size_t encoded_len = 0;
        mbedtls_base64_encode(nullptr, 0, &encoded_len, jpeg_data, jpeg_len);

        std::string encoded(encoded_len, '\0');
        if (mbedtls_base64_encode((unsigned char*)encoded.data(), encoded.size(), &encoded_len, jpeg_data, jpeg_len) != 0) {
            return;
        }
        encoded.resize(encoded_len);

        ArduinoJson::JsonDocument doc;
        doc["type"]                = "robot.event";
        doc["eventId"]             = GetHAL().getFactoryMacString("") + "-frame-" + std::to_string(_camera_frame_id);
        doc["deviceId"]            = GetHAL().getFactoryMacString(":");
        doc["timestamp"]           = iso_now();
        doc["event"]["kind"]       = "cameraFrame";
        doc["event"]["frameId"]    = std::to_string(_camera_frame_id++);
        doc["event"]["mimeType"]   = "image/jpeg";
        doc["event"]["width"]      = width;
        doc["event"]["height"]     = height;
        doc["event"]["dataBase64"] = encoded;
        send_json(doc);
    }

    void send_handshake()
    {
        ArduinoJson::JsonDocument doc;
        auto app_desc = esp_app_get_description();

        doc["type"]            = "handshake";
        doc["deviceId"]        = GetHAL().getFactoryMacString(":");
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

        doc["audioParams"]["format"]          = "opus";
        doc["audioParams"]["sampleRate"]      = 16000;
        doc["audioParams"]["channels"]        = 1;
        doc["audioParams"]["frameDurationMs"] = 30;

        send_json(doc);
    }

    void send_heartbeat()
    {
        ArduinoJson::JsonDocument doc;
        doc["type"]      = "heartbeat";
        doc["deviceId"]  = GetHAL().getFactoryMacString(":");
        doc["timestamp"] = iso_now();
        send_json(doc);
    }

    void send_state_event(const char* mode, const char* detail)
    {
        ArduinoJson::JsonDocument doc;
        doc["type"]        = "robot.event";
        doc["eventId"]     = GetHAL().getFactoryMacString("") + "-" + std::to_string(GetHAL().millis());
        doc["deviceId"]    = GetHAL().getFactoryMacString(":");
        doc["timestamp"]   = iso_now();
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
        send_json(doc);
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
        send_json(doc);
    }

    bool handle_capture_image(const char* command_id, const char* request_id)
    {
        auto camera = hal_bridge::board_get_camera();
        if (!camera) {
            send_error("capture_failed", "camera capture failed", true, command_id);
            return false;
        }

        std::string encoded;
        {
            std::lock_guard<std::mutex> lock(_camera_mutex);
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
        doc["type"]              = "robot.event";
        doc["eventId"]           = GetHAL().getFactoryMacString("") + "-" + std::to_string(GetHAL().millis());
        doc["deviceId"]          = GetHAL().getFactoryMacString(":");
        doc["timestamp"]         = iso_now();
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
        send_json(doc);
    }

    void send_json(ArduinoJson::JsonDocument& doc)
    {
        if (!_websocket || !_websocket->IsConnected()) {
            return;
        }
        std::string payload;
        ArduinoJson::serializeJson(doc, payload);
        _websocket->Send(payload.c_str());
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
        if (GetHAL().millis() - _last_tick < 20) {
            return;
        }
        _last_tick = GetHAL().millis();
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

void Hal::startLocalCompanionService(std::function<void(std::string_view)> onStartLog)
{
    mclog::tagInfo(_tag, "start local companion service");
    startNetwork(onStartLog);
    mooncake::GetMooncake().extensionManager()->createAbility(std::make_unique<LocalCompanionWorker>(std::move(onStartLog)));
}

LocalCompanionState Hal::getLocalCompanionState()
{
    return _local_state;
}

LocalFaceTrackingTarget Hal::getLocalFaceTrackingTarget()
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
