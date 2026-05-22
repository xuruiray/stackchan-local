#pragma once

#include <cstddef>
#include <functional>

class WebSocket {
public:
    using DataCallback = std::function<void(const char* data, size_t len, bool binary)>;
    using StateCallback = std::function<void()>;

    virtual ~WebSocket() = default;

    virtual void OnConnected(StateCallback callback) = 0;
    virtual void OnDisconnected(StateCallback callback) = 0;
    virtual void OnData(DataCallback callback) = 0;

    virtual bool Connect(const char* url) = 0;
    virtual bool IsConnected() const = 0;
    virtual bool Send(const char* data) = 0;
    virtual bool Send(const char* data, size_t len) = 0;
    virtual bool SendBinary(const char* data, size_t len) = 0;
    virtual void Close() = 0;
};
