/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once

#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

namespace stackchan::system {

class TaskRunner {
public:
    BaseType_t create_pinned(const char* name, TaskFunction_t task, uint32_t stack_depth, void* arg,
                             UBaseType_t priority, BaseType_t core_id, uint32_t caps) const
    {
        return xTaskCreatePinnedToCoreWithCaps(task, name, stack_depth, arg, priority, nullptr, core_id, caps);
    }
};

}  // namespace stackchan::system
