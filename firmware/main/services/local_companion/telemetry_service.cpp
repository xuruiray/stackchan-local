/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include "telemetry_service.h"

#include <hal/hal.h>
#include "protocol_utils.h"
#include <string>

namespace stackchan::hal::local_companion {

void prepare_robot_event(ArduinoJson::JsonDocument& doc, const char* kind, uint32_t event_counter)
{
    doc["type"]          = "robot.event";
    doc["seq"]           = event_counter;
    doc["eventId"]       = GetHAL().getFactoryMacString("") + "-" + kind + "-" + std::to_string(event_counter);
    doc["deviceId"]      = GetHAL().getFactoryMacString(":");
    doc["timestamp"]     = iso_now();
    doc["event"]["kind"] = kind;
}

}  // namespace stackchan::hal::local_companion
