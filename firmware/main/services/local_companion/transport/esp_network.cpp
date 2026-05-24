#include "esp_network.h"

#include <esp_log.h>
#include <esp_websocket_client.h>
#include <cstring>
#include <mutex>
#include <vector>

namespace {

constexpr const char* TAG = "LocalEspNetwork";
constexpr int kDefaultTimeoutMs = 5000;
constexpr int kWebSocketBufferSize = 8192;
constexpr int kMaxIncomingMessageBytes = 512 * 1024;
constexpr int kWsOpcodeContinuation = 0x0;
constexpr int kWsOpcodeText = 0x1;
constexpr int kWsOpcodeBinary = 0x2;

class DisabledHttp final : public Http {
public:
    void SetHeader(const std::string& key, const std::string& value) override
    {
        (void)key;
        (void)value;
    }

    bool Open(const std::string& method, const std::string& url) override
    {
        ESP_LOGW(TAG, "HTTP disabled in local-only firmware: %s %s", method.c_str(), url.c_str());
        return false;
    }

    int GetStatusCode() const override { return 0; }
    size_t GetBodyLength() const override { return 0; }
    int Read(void* buffer, size_t len) override
    {
        (void)buffer;
        (void)len;
        return -1;
    }
    bool Write(const char* data, size_t len) override
    {
        (void)data;
        (void)len;
        return false;
    }
    std::string ReadAll() override { return {}; }
    void Close() override {}
};

class DisabledMqtt final : public Mqtt {
};

class DisabledUdp final : public Udp {
};

class EspWebSocket final : public WebSocket {
public:
    explicit EspWebSocket(int timeout_seconds)
        : timeout_ms_(timeout_seconds > 0 ? timeout_seconds * 1000 : kDefaultTimeoutMs)
    {
    }

    ~EspWebSocket() override
    {
        Close();
        destroy_client();
    }

    void OnConnected(StateCallback callback) override
    {
        std::lock_guard<std::mutex> lock(callback_mutex_);
        on_connected_ = std::move(callback);
    }

    void OnDisconnected(StateCallback callback) override
    {
        std::lock_guard<std::mutex> lock(callback_mutex_);
        on_disconnected_ = std::move(callback);
    }

    void OnData(DataCallback callback) override
    {
        std::lock_guard<std::mutex> lock(callback_mutex_);
        on_data_ = std::move(callback);
    }

    bool Connect(const char* url) override
    {
        if (url == nullptr || url[0] == '\0') {
            ESP_LOGE(TAG, "WebSocket URL is empty");
            return false;
        }

        Close();
        destroy_client();

        esp_websocket_client_config_t config = {};
        config.uri = url;
        config.buffer_size = kWebSocketBufferSize;
        config.network_timeout_ms = timeout_ms_;

        client_ = esp_websocket_client_init(&config);
        if (client_ == nullptr) {
            ESP_LOGE(TAG, "failed to init WebSocket client");
            return false;
        }

        esp_websocket_register_events(client_, WEBSOCKET_EVENT_ANY, &EspWebSocket::handle_event, this);
        const esp_err_t err = esp_websocket_client_start(client_);
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "failed to start WebSocket client: %s", esp_err_to_name(err));
            destroy_client();
            return false;
        }

        return true;
    }

    bool IsConnected() const override
    {
        return client_ != nullptr && esp_websocket_client_is_connected(client_);
    }

    bool Send(const char* data) override
    {
        if (data == nullptr) {
            return false;
        }
        return Send(data, strlen(data));
    }

    bool Send(const char* data, size_t len) override
    {
        if (!IsConnected() || data == nullptr) {
            return false;
        }
        const int sent = esp_websocket_client_send_text(client_, data, len, pdMS_TO_TICKS(timeout_ms_));
        return sent == static_cast<int>(len);
    }

    bool SendBinary(const char* data, size_t len) override
    {
        if (!IsConnected() || data == nullptr) {
            return false;
        }
        const int sent = esp_websocket_client_send_bin(client_, data, len, pdMS_TO_TICKS(timeout_ms_));
        return sent == static_cast<int>(len);
    }

    void Close() override
    {
        if (client_ != nullptr && esp_websocket_client_is_connected(client_)) {
            esp_websocket_client_close(client_, pdMS_TO_TICKS(timeout_ms_));
        }
    }

private:
    esp_websocket_client_handle_t client_ = nullptr;
    int timeout_ms_ = kDefaultTimeoutMs;
    mutable std::mutex callback_mutex_;
    StateCallback on_connected_;
    StateCallback on_disconnected_;
    DataCallback on_data_;
    std::vector<char> incoming_message_;
    bool incoming_message_binary_ = false;
    bool incoming_message_active_ = false;

    void destroy_client()
    {
        if (client_ == nullptr) {
            return;
        }
        esp_websocket_client_stop(client_);
        esp_websocket_client_destroy(client_);
        client_ = nullptr;
    }

    static void handle_event(void* handler_args, esp_event_base_t event_base, int32_t event_id, void* event_data)
    {
        (void)event_base;
        auto* self = static_cast<EspWebSocket*>(handler_args);
        if (self == nullptr) {
            return;
        }

        switch (event_id) {
            case WEBSOCKET_EVENT_CONNECTED:
                self->emit_connected();
                break;
            case WEBSOCKET_EVENT_DISCONNECTED:
                self->emit_disconnected();
                break;
            case WEBSOCKET_EVENT_DATA:
                self->emit_data(static_cast<esp_websocket_event_data_t*>(event_data));
                break;
            case WEBSOCKET_EVENT_ERROR:
                ESP_LOGW(TAG, "WebSocket transport error");
                break;
            default:
                break;
        }
    }

    void emit_connected()
    {
        incoming_message_.clear();
        incoming_message_binary_ = false;
        incoming_message_active_ = false;

        StateCallback callback;
        {
            std::lock_guard<std::mutex> lock(callback_mutex_);
            callback = on_connected_;
        }
        if (callback) {
            callback();
        }
    }

    void emit_disconnected()
    {
        incoming_message_.clear();
        incoming_message_active_ = false;

        StateCallback callback;
        {
            std::lock_guard<std::mutex> lock(callback_mutex_);
            callback = on_disconnected_;
        }
        if (callback) {
            callback();
        }
    }

    void emit_data(esp_websocket_event_data_t* data)
    {
        if (data == nullptr || data->data_ptr == nullptr || data->data_len <= 0) {
            return;
        }

        const int payload_len = data->payload_len > 0 ? data->payload_len : data->data_len;
        const int payload_offset = data->payload_offset;
        if (payload_offset == 0 && data->op_code != kWsOpcodeText && data->op_code != kWsOpcodeBinary) {
            return;
        }
        if (payload_offset > 0 && data->op_code != kWsOpcodeContinuation && data->op_code != kWsOpcodeText &&
            data->op_code != kWsOpcodeBinary) {
            return;
        }
        const bool payload_fragmented = payload_len > data->data_len || payload_offset > 0;
        const bool message_binary = payload_offset > 0 ? incoming_message_binary_ : data->op_code == kWsOpcodeBinary;

        if (!payload_fragmented) {
            deliver_data(data->data_ptr, static_cast<size_t>(data->data_len), message_binary);
            return;
        }

        if (payload_len <= 0 || payload_len > kMaxIncomingMessageBytes) {
            ESP_LOGW(TAG, "dropping oversized WebSocket message: %d bytes", payload_len);
            incoming_message_.clear();
            incoming_message_active_ = false;
            return;
        }

        if (payload_offset == 0) {
            incoming_message_.assign(static_cast<size_t>(payload_len), 0);
            incoming_message_binary_ = data->op_code == kWsOpcodeBinary;
            incoming_message_active_ = true;
        }

        if (!incoming_message_active_ || payload_offset < 0 || payload_offset + data->data_len > static_cast<int>(incoming_message_.size())) {
            ESP_LOGW(TAG, "dropping invalid WebSocket fragment offset=%d len=%d total=%d", payload_offset, data->data_len, payload_len);
            incoming_message_.clear();
            incoming_message_active_ = false;
            return;
        }

        memcpy(incoming_message_.data() + payload_offset, data->data_ptr, static_cast<size_t>(data->data_len));
        if (payload_offset + data->data_len < payload_len) {
            return;
        }

        deliver_data(incoming_message_.data(), incoming_message_.size(), incoming_message_binary_);
        incoming_message_.clear();
        incoming_message_active_ = false;
    }

    void deliver_data(const char* data, size_t len, bool binary)
    {
        DataCallback callback;
        {
            std::lock_guard<std::mutex> lock(callback_mutex_);
            callback = on_data_;
        }
        if (callback) {
            callback(data, len, binary);
        }
    }
};

}  // namespace

std::unique_ptr<Http> EspNetwork::CreateHttp(int timeout_seconds)
{
    (void)timeout_seconds;
    return std::make_unique<DisabledHttp>();
}

std::unique_ptr<WebSocket> EspNetwork::CreateWebSocket(int timeout_seconds)
{
    return std::make_unique<EspWebSocket>(timeout_seconds);
}

std::unique_ptr<Mqtt> EspNetwork::CreateMqtt(int timeout_seconds)
{
    (void)timeout_seconds;
    return std::make_unique<DisabledMqtt>();
}

std::unique_ptr<Udp> EspNetwork::CreateUdp(int timeout_seconds)
{
    (void)timeout_seconds;
    return std::make_unique<DisabledUdp>();
}
