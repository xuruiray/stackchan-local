#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

class Udp {
public:
    virtual ~Udp() = default;

    virtual bool Connect(const std::string& host, uint16_t port)
    {
        (void)host;
        (void)port;
        return false;
    }
    virtual int Send(const void* data, size_t len)
    {
        (void)data;
        (void)len;
        return -1;
    }
    virtual int Receive(void* data, size_t len, uint32_t timeout_ms = 0)
    {
        (void)data;
        (void)len;
        (void)timeout_ms;
        return -1;
    }
    virtual void Close() {}
};
