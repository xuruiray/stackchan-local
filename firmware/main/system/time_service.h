/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once

#include <string>
#include <string_view>

namespace stackchan::system {

void apply_timezone(std::string_view tz);
std::string load_timezone();
void save_timezone(std::string_view tz);

}  // namespace stackchan::system
