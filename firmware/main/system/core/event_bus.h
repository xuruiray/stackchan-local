/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once

#include <string_view>

namespace stackchan::system {

class EventBus {
public:
    void publish(std::string_view event_name)
    {
        last_event_ = event_name;
    }

    std::string_view last_event() const
    {
        return last_event_;
    }

private:
    std::string_view last_event_;
};

}  // namespace stackchan::system
