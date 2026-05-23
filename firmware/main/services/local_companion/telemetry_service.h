/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once

#include <ArduinoJson.hpp>
#include <cstdint>

namespace stackchan::hal::local_companion {

void prepare_robot_event(ArduinoJson::JsonDocument& doc, const char* kind, uint32_t event_counter);

}  // namespace stackchan::hal::local_companion
