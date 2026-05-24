/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include <system/time_service.h>

#include <ctime>
#include <mooncake_log.h>
#include <settings.h>

namespace stackchan::system {

void apply_timezone(std::string_view tz)
{
    setenv("TZ", std::string(tz).c_str(), 1);
    tzset();
}

std::string load_timezone()
{
    Settings settings("system", false);
    return settings.GetString("tz", "GMT0");
}

void save_timezone(std::string_view tz)
{
    Settings settings("system", true);
    settings.SetString("tz", std::string(tz));
    mclog::tagInfo("TimeService", "timezone updated to: {}", tz);
}

}  // namespace stackchan::system
