/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once

#include <string>
#include <string_view>
#include <vector>

namespace stackchan::system {

struct ServiceStatus {
    std::string name;
    bool running = false;
    std::string reason;
};

class ServiceRegistry {
public:
    void mark(std::string_view name, bool running, std::string_view reason = {});
    std::vector<ServiceStatus> statuses() const;

private:
    std::vector<ServiceStatus> statuses_;
};

}  // namespace stackchan::system
