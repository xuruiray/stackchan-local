/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include <hardware/registry.h>

#include <algorithm>

namespace stackchan::hal::hardware {

void HardwareRegistry::set_board_name(std::string_view board_name)
{
    board_name_ = std::string(board_name);
}

std::string HardwareRegistry::board_name() const
{
    return board_name_;
}

void HardwareRegistry::register_i2c_bus(i2c_master_bus_handle_t bus)
{
    i2c_bus_ = bus;
    set_module_status("i2c-main", bus != nullptr, bus ? "" : "i2c_bus_unavailable");
}

i2c_master_bus_handle_t HardwareRegistry::i2c_bus() const
{
    return i2c_bus_;
}

void HardwareRegistry::register_camera(StackChanCamera* camera)
{
    camera_ = camera;
    set_module_status("camera-gc0308", camera != nullptr, camera ? "" : "camera_unavailable");
}

StackChanCamera* HardwareRegistry::camera() const
{
    return camera_;
}

void HardwareRegistry::set_module_status(std::string_view name, bool available, std::string_view reason)
{
    auto existing = std::find_if(module_statuses_.begin(), module_statuses_.end(),
                                 [name](const HardwareModuleStatus& item) { return item.name == name; });
    if (existing == module_statuses_.end()) {
        module_statuses_.push_back({std::string(name), available, std::string(reason)});
        return;
    }
    existing->available = available;
    existing->reason = std::string(reason);
}

HardwareModuleStatus HardwareRegistry::module_status(std::string_view name) const
{
    auto existing = std::find_if(module_statuses_.begin(), module_statuses_.end(),
                                 [name](const HardwareModuleStatus& item) { return item.name == name; });
    if (existing == module_statuses_.end()) {
        return {std::string(name), false, "not_registered"};
    }
    return *existing;
}

std::vector<HardwareModuleStatus> HardwareRegistry::module_statuses() const
{
    return module_statuses_;
}

HardwareRegistry& GetHardwareRegistry()
{
    static HardwareRegistry registry;
    return registry;
}

}  // namespace stackchan::hal::hardware
