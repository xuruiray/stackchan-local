/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once

#include <string>
#include <string_view>

#include <hardware/registry.h>
#include <system/core/clock.h>
#include <system/core/event_bus.h>
#include <system/core/service_registry.h>
#include <system/core/task_runner.h>

namespace stackchan::system {

class SystemContext {
public:
    Clock& clock();
    EventBus& events();
    TaskRunner& tasks();
    ServiceRegistry& services();
    stackchan::hal::hardware::HardwareRegistry& hardware();

    void mark_boot_phase(std::string_view phase);
    std::string boot_phase() const;

private:
    Clock clock_;
    EventBus events_;
    TaskRunner tasks_;
    ServiceRegistry services_;
    std::string boot_phase_ = "not_started";
};

SystemContext& GetSystemContext();

}  // namespace stackchan::system
