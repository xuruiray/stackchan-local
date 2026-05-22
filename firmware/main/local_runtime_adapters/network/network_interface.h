#pragma once

#include "http.h"
#include "mqtt.h"
#include "udp.h"
#include "web_socket.h"

#include <memory>

class NetworkInterface {
public:
    virtual ~NetworkInterface() = default;

    virtual std::unique_ptr<Http> CreateHttp(int timeout_seconds) = 0;
    virtual std::unique_ptr<WebSocket> CreateWebSocket(int timeout_seconds) = 0;
    virtual std::unique_ptr<Mqtt> CreateMqtt(int timeout_seconds) = 0;
    virtual std::unique_ptr<Udp> CreateUdp(int timeout_seconds) = 0;
};
