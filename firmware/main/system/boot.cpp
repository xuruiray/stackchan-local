/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include <system/device_runtime.h>
#include <system/runtime_bridge/embedded_runtime_bridge.h>
#include <system/nvs_settings.h>
#include <memory>
#include <mooncake_log.h>

static std::unique_ptr<DeviceRuntime> _device_runtime_instance;
static const std::string_view _tag = "DeviceRuntime";

DeviceRuntime& GetDeviceRuntime()
{
    if (!_device_runtime_instance) {
        mclog::tagInfo(_tag, "creating device runtime instance");
        _device_runtime_instance = std::make_unique<DeviceRuntime>();
    }
    return *_device_runtime_instance.get();
}

void DeviceRuntime::init()
{
    mclog::tagInfo(_tag, "init");

    stackchan::system::init_nvs_or_reset();

    board_init();
    recordI2cDiagnosticScan("after_board_init_axp2101");
    head_touch_init();
    io_expander_init();
    peripheral_probe_init();
    rtc_init();
    imu_init();
    servo_init();
    lvgl_init();
}

/* -------------------------------------------------------------------------- */
/*                                    Board                                   */
/* -------------------------------------------------------------------------- */

void DeviceRuntime::board_init()
{
    mclog::tagInfo(_tag, "board init");
    embedded_runtime_bridge::board_init();
}

/* -------------------------------------------------------------------------- */
/*                                   Display                                  */
/* -------------------------------------------------------------------------- */
#include <system/runtime_bridge/embedded_runtime_bridge.h>

void DeviceRuntime::lvglLock()
{
    embedded_runtime_bridge::disply_lvgl_lock();
}

void DeviceRuntime::lvglUnlock()
{
    embedded_runtime_bridge::disply_lvgl_unlock();
}

void DeviceRuntime::setBackLightBrightness(uint8_t brightness, bool permanent)
{
    embedded_runtime_bridge::board_set_backlight_brightness(brightness, permanent);
}

uint8_t DeviceRuntime::getBackLightBrightness()
{
    return embedded_runtime_bridge::board_get_backlight_brightness();
}

void DeviceRuntime::setSpeakerVolume(uint8_t volume, bool permanent)
{
    embedded_runtime_bridge::board_set_speaker_volume(volume, permanent);
}

uint8_t DeviceRuntime::getSpeakerVolume()
{
    return embedded_runtime_bridge::board_get_speaker_volume();
}

/* -------------------------------------------------------------------------- */
/*                                    Lvgl                                    */
/* -------------------------------------------------------------------------- */
#include <system/runtime_bridge/embedded_runtime_bridge.h>
#include <services/expression_motion/stackchan.h>

static void lvgl_read_cb(lv_indev_t* indev, lv_indev_data_t* data)
{
    embedded_runtime_bridge::lock();
    auto& bridge_data = embedded_runtime_bridge::get_data();

    // mclog::tagInfo(_tag, "touchpoint: {}, x: {}, y: {}", bridge_data.touchPoint.num, bridge_data.touchPoint.x,
    //                bridge_data.touchPoint.y);

    if (bridge_data.touchPoint.num == 0) {
        data->state = LV_INDEV_STATE_RELEASED;
    } else {
        data->state   = LV_INDEV_STATE_PRESSED;
        data->point.x = bridge_data.touchPoint.x;
        data->point.y = bridge_data.touchPoint.y;
    }

    embedded_runtime_bridge::unlock();
}

void DeviceRuntime::lvgl_init()
{
    mclog::tagInfo(_tag, "lvgl init");

    embedded_runtime_bridge::disply_lvgl_lock();

    mclog::tagInfo(_tag, "create lvgl touchpad indev");
    lvTouchpad = lv_indev_create();
    lv_indev_set_type(lvTouchpad, LV_INDEV_TYPE_POINTER);
    lv_indev_set_read_cb(lvTouchpad, lvgl_read_cb);
    lv_indev_set_group(lvTouchpad, lv_group_get_default());
    lv_indev_set_display(lvTouchpad, embedded_runtime_bridge::display_get_lvgl_display());

    embedded_runtime_bridge::disply_lvgl_unlock();
}
