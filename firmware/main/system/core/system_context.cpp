/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include <system/core/system_context.h>

namespace stackchan::system {

Clock& SystemContext::clock()
{
    return clock_;
}

EventBus& SystemContext::events()
{
    return events_;
}

TaskRunner& SystemContext::tasks()
{
    return tasks_;
}

ServiceRegistry& SystemContext::services()
{
    return services_;
}

stackchan::hal::hardware::HardwareRegistry& SystemContext::hardware()
{
    return stackchan::hal::hardware::GetHardwareRegistry();
}

void SystemContext::mark_boot_phase(std::string_view phase)
{
    boot_phase_ = std::string(phase);
    events_.publish(boot_phase_);
}

std::string SystemContext::boot_phase() const
{
    return boot_phase_;
}

SystemContext& GetSystemContext()
{
    static SystemContext context;
    return context;
}

}  // namespace stackchan::system
