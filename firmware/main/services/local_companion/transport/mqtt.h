#pragma once

#include <cstddef>
#include <functional>
#include <string>

class Mqtt {
public:
    using MessageCallback = std::function<void(const std::string& topic, const std::string& payload)>;
    using StateCallback = std::function<void()>;

    virtual ~Mqtt() = default;

    virtual void OnConnected(StateCallback callback) { (void)callback; }
    virtual void OnDisconnected(StateCallback callback) { (void)callback; }
    virtual void OnMessage(MessageCallback callback) { (void)callback; }
    virtual bool Connect(const std::string& endpoint,
                         const std::string& client_id,
                         const std::string& username,
                         const std::string& password)
    {
        (void)endpoint;
        (void)client_id;
        (void)username;
        (void)password;
        return false;
    }
    virtual bool Publish(const std::string& topic, const char* data, size_t len, int qos = 0)
    {
        (void)topic;
        (void)data;
        (void)len;
        (void)qos;
        return false;
    }
    virtual bool Subscribe(const std::string& topic, int qos = 0)
    {
        (void)topic;
        (void)qos;
        return false;
    }
    virtual bool IsConnected() const { return false; }
    virtual void Disconnect() {}
};
