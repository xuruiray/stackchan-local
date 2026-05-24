#pragma once

#include "network_interface.h"

class EspNetwork final : public NetworkInterface {
public:
    std::unique_ptr<Http> CreateHttp(int timeout_seconds) override;
    std::unique_ptr<WebSocket> CreateWebSocket(int timeout_seconds) override;
    std::unique_ptr<Mqtt> CreateMqtt(int timeout_seconds) override;
    std::unique_ptr<Udp> CreateUdp(int timeout_seconds) override;
};
