/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include <system/core/service_registry.h>

#include <algorithm>

namespace stackchan::system {

void ServiceRegistry::mark(std::string_view name, bool running, std::string_view reason)
{
    auto existing = std::find_if(statuses_.begin(), statuses_.end(),
                                 [name](const ServiceStatus& item) { return item.name == name; });
    if (existing == statuses_.end()) {
        statuses_.push_back({std::string(name), running, std::string(reason)});
        return;
    }
    existing->running = running;
    existing->reason = std::string(reason);
}

std::vector<ServiceStatus> ServiceRegistry::statuses() const
{
    return statuses_;
}

}  // namespace stackchan::system
