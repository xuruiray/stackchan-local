/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once

namespace stackchan::hal::hardware {

// Board composition is registered from board_profile.cpp through DECLARE_BOARD.
// The concrete board class stays private while the profile owns M5Stack-specific wiring.
constexpr const char* kStackChanBoardName = "m5stack-stack-chan";

}  // namespace stackchan::hal::hardware
