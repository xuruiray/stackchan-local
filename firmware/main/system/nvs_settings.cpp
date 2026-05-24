/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include <system/nvs_settings.h>

#include <system/device_runtime.h>
#include <esp_err.h>
#include <nvs_flash.h>
#include <mooncake_log.h>

namespace stackchan::system {

void init_nvs_or_reset()
{
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);
}

}  // namespace stackchan::system

void DeviceRuntime::factoryReset()
{
    mclog::tagInfo("DeviceRuntime-NVS", "start factory reset");
    ESP_ERROR_CHECK(nvs_flash_erase());
    reboot();
}
