/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once

namespace stackchan::hal::hardware {

// Board composition is registered from stackchan_board.cpp through DECLARE_BOARD.
// The concrete board class stays private to keep callers behind Board/DeviceRuntime facades.
constexpr const char* kStackChanBoardName = "m5stack-stack-chan";

}  // namespace stackchan::hal::hardware
