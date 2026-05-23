/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once

#include <string_view>

namespace stackchan::hal::local_companion {

bool command_updates_activity(std::string_view kind);

}  // namespace stackchan::hal::local_companion
