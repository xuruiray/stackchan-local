/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include <system/core/settings.h>

#include <system/device_runtime.h>
#include <esp_err.h>
#include <esp_log.h>
#include <nvs_flash.h>
#include <mooncake_log.h>

#define TAG "Settings"

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

Settings::Settings(const std::string& ns, bool read_write) : ns_(ns), read_write_(read_write)
{
    nvs_open(ns.c_str(), read_write_ ? NVS_READWRITE : NVS_READONLY, &nvs_handle_);
}

Settings::~Settings()
{
    if (nvs_handle_ != 0) {
        if (read_write_ && dirty_) {
            ESP_ERROR_CHECK(nvs_commit(nvs_handle_));
        }
        nvs_close(nvs_handle_);
    }
}

std::string Settings::GetString(const std::string& key, const std::string& default_value)
{
    if (nvs_handle_ == 0) {
        return default_value;
    }

    size_t length = 0;
    if (nvs_get_str(nvs_handle_, key.c_str(), nullptr, &length) != ESP_OK) {
        return default_value;
    }

    std::string value;
    value.resize(length);
    ESP_ERROR_CHECK(nvs_get_str(nvs_handle_, key.c_str(), value.data(), &length));
    while (!value.empty() && value.back() == '\0') {
        value.pop_back();
    }
    return value;
}

void Settings::SetString(const std::string& key, const std::string& value)
{
    if (!read_write_) {
        ESP_LOGW(TAG, "Namespace %s is not open for writing", ns_.c_str());
        return;
    }
    ESP_ERROR_CHECK(nvs_set_str(nvs_handle_, key.c_str(), value.c_str()));
    dirty_ = true;
}

int32_t Settings::GetInt(const std::string& key, int32_t default_value)
{
    if (nvs_handle_ == 0) {
        return default_value;
    }

    int32_t value = 0;
    if (nvs_get_i32(nvs_handle_, key.c_str(), &value) != ESP_OK) {
        return default_value;
    }
    return value;
}

void Settings::SetInt(const std::string& key, int32_t value)
{
    if (!read_write_) {
        ESP_LOGW(TAG, "Namespace %s is not open for writing", ns_.c_str());
        return;
    }
    ESP_ERROR_CHECK(nvs_set_i32(nvs_handle_, key.c_str(), value));
    dirty_ = true;
}

bool Settings::GetBool(const std::string& key, bool default_value)
{
    if (nvs_handle_ == 0) {
        return default_value;
    }

    uint8_t value = 0;
    if (nvs_get_u8(nvs_handle_, key.c_str(), &value) != ESP_OK) {
        return default_value;
    }
    return value != 0;
}

void Settings::SetBool(const std::string& key, bool value)
{
    if (!read_write_) {
        ESP_LOGW(TAG, "Namespace %s is not open for writing", ns_.c_str());
        return;
    }
    ESP_ERROR_CHECK(nvs_set_u8(nvs_handle_, key.c_str(), value ? 1 : 0));
    dirty_ = true;
}

void Settings::EraseKey(const std::string& key)
{
    if (!read_write_) {
        ESP_LOGW(TAG, "Namespace %s is not open for writing", ns_.c_str());
        return;
    }
    auto ret = nvs_erase_key(nvs_handle_, key.c_str());
    if (ret != ESP_ERR_NVS_NOT_FOUND) {
        ESP_ERROR_CHECK(ret);
    }
}

void Settings::EraseAll()
{
    if (!read_write_) {
        ESP_LOGW(TAG, "Namespace %s is not open for writing", ns_.c_str());
        return;
    }
    ESP_ERROR_CHECK(nvs_erase_all(nvs_handle_));
}

void DeviceRuntime::factoryReset()
{
    mclog::tagInfo("DeviceRuntime-NVS", "start factory reset");
    ESP_ERROR_CHECK(nvs_flash_erase());
    reboot();
}
