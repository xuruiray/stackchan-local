/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include <smooth_ui_toolkit.hpp>
#include <uitk/short_namespace.hpp>
#include <mooncake_log.h>
#include <mooncake.h>
#include <app/local_companion/local_companion_app.h>
#include <system/device_runtime.h>

using namespace mooncake;
using namespace smooth_ui_toolkit;

extern "C" void app_main(void)
{
    // Setup logger
    mclog::set_level(mclog::level_info);
    mclog::set_time_format(mclog::time_format_unix_milliseconds);

    // Device runtime init
    GetDeviceRuntime().init();

    // Setup ui hal
    ui_hal::on_delay([](uint32_t ms) { GetDeviceRuntime().delay(ms); });
    ui_hal::on_get_tick([]() { return GetDeviceRuntime().millis(); });

    // Local-only runtime: boot directly into the desktop companion instead of
    // the original multi-app launcher/cloud flow.
    GetMooncake().installApp(std::make_unique<AppLocalCompanion>());

    // Main loop
    while (1) {
        GetDeviceRuntime().feedTheDog();
        GetDeviceRuntime().updateHeapStatusLog();

        GetMooncake().update();

        // Local-only firmware never exits into the legacy Xiaozhi cloud runtime.
    }
}
