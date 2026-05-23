/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include "command_dispatcher.h"

namespace stackchan::hal::local_companion {

bool command_updates_activity(std::string_view kind)
{
    return kind != "trackFace" && kind != "cameraStream";
}

}  // namespace stackchan::hal::local_companion
