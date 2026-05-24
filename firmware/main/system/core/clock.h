/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once

#include <cstdint>

namespace stackchan::system {

class Clock {
public:
    uint32_t millis() const;
    void delay(uint32_t ms) const;
};

}  // namespace stackchan::system
