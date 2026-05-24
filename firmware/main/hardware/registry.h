/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

#include <driver/i2c_master.h>

class StackChanCamera;

namespace stackchan::hal::hardware {

struct HardwareModuleStatus {
    std::string name;
    bool available = false;
    std::string reason;
};

class HardwareRegistry {
public:
    void set_board_name(std::string_view board_name);
    std::string board_name() const;

    void register_i2c_bus(i2c_master_bus_handle_t bus);
    i2c_master_bus_handle_t i2c_bus() const;

    void register_camera(StackChanCamera* camera);
    StackChanCamera* camera() const;

    void set_module_status(std::string_view name, bool available, std::string_view reason = {});
    HardwareModuleStatus module_status(std::string_view name) const;
    std::vector<HardwareModuleStatus> module_statuses() const;

private:
    std::string board_name_;
    i2c_master_bus_handle_t i2c_bus_ = nullptr;
    StackChanCamera* camera_ = nullptr;
    std::vector<HardwareModuleStatus> module_statuses_;
};

HardwareRegistry& GetHardwareRegistry();

}  // namespace stackchan::hal::hardware
