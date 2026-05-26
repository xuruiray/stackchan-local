#include "board_profile.h"
#include <system/legacy_runtime/board/wifi_board.h>
#include <hardware/audio/audio_device.h>
#include <hardware/io_expander/io_expander.h>
#include <hardware/registry.h>
#include <hardware/power/axp2101_power.h>
#include <hardware/touch/screen_touch.h>
#include <services/display/avatar_display.h>
#include "pinmap.h"
#include "hardware_config.h"
#include <system/power_policy/power_save_timer.h>
#include <system/core/settings.h>

#include <esp_log.h>
#include <driver/i2c_master.h>
#include <wifi_station.h>
#include <esp_lcd_panel_io.h>
#include <esp_lcd_panel_ops.h>
#include <esp_lcd_ili9341.h>
#include <esp_timer.h>
#include <algorithm>
#include <hardware/camera/camera_device.h>
#include <system/runtime_bridge/embedded_runtime_bridge.h>

#define TAG "M5Stack-StackChan-Board"

using stackchan::hal::hardware::CoreS3IoExpander;
using stackchan::hal::hardware::StackChanBacklight;
using stackchan::hal::hardware::StackChanPmic;
using stackchan::hal::hardware::StackChanScreenTouch;

class M5StackCoreS3Board : public WifiBoard {
private:
    static constexpr int kPowerSaveSleepDelaySeconds = 300;
    static constexpr int kPowerStatePollIntervalMs   = 1000;

    i2c_master_bus_handle_t i2c_bus_;
    StackChanPmic* pmic_;
    CoreS3IoExpander* aw9523_;
    StackChanScreenTouch* ft6336_;
    LvglDisplay* display_;
    StackChanCamera* camera_;
    esp_timer_handle_t touchpad_timer_;
    PowerSaveTimer* power_save_timer_;
    embedded_runtime_bridge::RuntimePowerConfig runtime_power_config_;
    bool last_power_save_enabled_      = false;
    int64_t last_power_state_check_ms_ = 0;

    bool ShouldEnablePowerSave(bool has_external_power, bool is_discharging) const
    {
        return is_discharging || (has_external_power && runtime_power_config_.allowShutdownWhenCharging);
    }

    void UpdatePowerSaveEnabled(bool has_external_power, bool is_discharging)
    {
        const bool should_enable_power_save = ShouldEnablePowerSave(has_external_power, is_discharging);
        if (should_enable_power_save == last_power_save_enabled_) {
            return;
        }

        ESP_LOGI(TAG, "Power save timer %s: external_power=%d, discharging=%d, allowShutdownWhenCharging=%d",
                 should_enable_power_save ? "enabled" : "disabled", has_external_power, is_discharging,
                 runtime_power_config_.allowShutdownWhenCharging);
        power_save_timer_->SetEnabled(should_enable_power_save);
        last_power_save_enabled_ = should_enable_power_save;
    }

    void PollPowerSaveState()
    {
        const int64_t now_ms = esp_timer_get_time() / 1000;
        if (last_power_state_check_ms_ != 0 && (now_ms - last_power_state_check_ms_) < kPowerStatePollIntervalMs) {
            return;
        }
        last_power_state_check_ms_ = now_ms;

        UpdatePowerSaveEnabled(pmic_->IsExternalPowerConnected(), pmic_->IsDischarging());
    }

    void InitializePowerSaveTimer()
    {
        runtime_power_config_ = embedded_runtime_bridge::get_runtime_power_config();

        const int seconds_to_shutdown = runtime_power_config_.idleShutdownTimeSeconds > 0
                                            ? static_cast<int>(runtime_power_config_.idleShutdownTimeSeconds)
                                            : -1;
        const int seconds_to_sleep    = seconds_to_shutdown == -1
                                            ? kPowerSaveSleepDelaySeconds
                                            : std::min(kPowerSaveSleepDelaySeconds, seconds_to_shutdown);

        ESP_LOGI(TAG, "Init power save timer: sleep=%d s, shutdown=%d s, allow_shutdown_when_charging=%d",
                 seconds_to_sleep, seconds_to_shutdown, runtime_power_config_.allowShutdownWhenCharging);

        power_save_timer_ = new PowerSaveTimer(-1, seconds_to_sleep, seconds_to_shutdown);
        power_save_timer_->OnEnterSleepMode([this]() {
            GetDisplay()->SetPowerSaveMode(true);
            // GetBacklight()->SetBrightness(10);
        });
        power_save_timer_->OnExitSleepMode([this]() {
            GetDisplay()->SetPowerSaveMode(false);
            GetBacklight()->RestoreBrightness();
        });
        power_save_timer_->OnShutdownRequest([this]() { pmic_->PowerOff(); });
        UpdatePowerSaveEnabled(pmic_->IsExternalPowerConnected(), pmic_->IsDischarging());
    }

    void InitializeI2c()
    {
        // Initialize I2C peripheral
        i2c_master_bus_config_t i2c_bus_cfg = {
            .i2c_port          = STACKCHAN_I2C_PORT,
            .sda_io_num        = STACKCHAN_I2C_SDA_PIN,
            .scl_io_num        = STACKCHAN_I2C_SCL_PIN,
            .clk_source        = I2C_CLK_SRC_DEFAULT,
            .glitch_ignore_cnt = 7,
            .intr_priority     = 0,
            .trans_queue_depth = 0,
            .flags =
                {
                    .enable_internal_pullup = 1,
                },
        };
        ESP_ERROR_CHECK(i2c_new_master_bus(&i2c_bus_cfg, &i2c_bus_));
        stackchan::hal::hardware::GetHardwareRegistry().register_i2c_bus(i2c_bus_);
    }

    void I2cDetect()
    {
        uint8_t address;
        printf("     0  1  2  3  4  5  6  7  8  9  a  b  c  d  e  f\r\n");
        for (int i = 0; i < 128; i += 16) {
            printf("%02x: ", i);
            for (int j = 0; j < 16; j++) {
                fflush(stdout);
                address       = i + j;
                esp_err_t ret = i2c_master_probe(i2c_bus_, address, 200);
                if (ret == ESP_OK) {
                    printf("%02x ", address);
                } else if (ret == ESP_ERR_TIMEOUT) {
                    printf("UU ");
                } else {
                    printf("-- ");
                }
            }
            printf("\r\n");
        }
    }

    void InitializeAxp2101()
    {
        ESP_LOGI(TAG, "Init AXP2101");
        pmic_ = new StackChanPmic(i2c_bus_, AXP2101_I2C_ADDR);
        stackchan::hal::hardware::GetHardwareRegistry().set_module_status("pmic-axp2101", pmic_ != nullptr,
                                                                           pmic_ ? "" : "init_failed");
    }

    void InitializeAw9523()
    {
        ESP_LOGI(TAG, "Init AW9523");
        aw9523_ = new CoreS3IoExpander(i2c_bus_, AW9523_I2C_ADDR);
        stackchan::hal::hardware::GetHardwareRegistry().set_module_status("io-expander-aw9523", aw9523_ != nullptr,
                                                                           aw9523_ ? "" : "init_failed");
        vTaskDelay(pdMS_TO_TICKS(50));
    }

    void PollTouchpad()
    {
        if (!ft6336_->UpdateTouchPoint()) {
            return;
        }
        auto& touch_point = ft6336_->GetTouchPoint();

        // Update hal touch point
        embedded_runtime_bridge::set_touch_point(touch_point.num, touch_point.x, touch_point.y);
    }

    void InitializeFt6336TouchPad()
    {
        ESP_LOGI(TAG, "Init FT6336");
        ft6336_ = new StackChanScreenTouch(i2c_bus_, FT6336_I2C_ADDR);
        stackchan::hal::hardware::GetHardwareRegistry().set_module_status("touch-ft6336", ft6336_ != nullptr,
                                                                           ft6336_ ? "" : "init_failed");

        // 创建定时器，20ms 间隔
        esp_timer_create_args_t timer_args = {
            .callback =
                [](void* arg) {
                    M5StackCoreS3Board* board = (M5StackCoreS3Board*)arg;
                    board->PollTouchpad();
                    board->PollPowerSaveState();
                },
            .arg                   = this,
            .dispatch_method       = ESP_TIMER_TASK,
            .name                  = "touchpad_timer",
            .skip_unhandled_events = true,
        };

        ESP_ERROR_CHECK(esp_timer_create(&timer_args, &touchpad_timer_));
        ESP_ERROR_CHECK(esp_timer_start_periodic(touchpad_timer_, 20 * 1000));
    }

    void InitializeSpi()
    {
        spi_bus_config_t buscfg = {};
        buscfg.mosi_io_num      = DISPLAY_SPI_MOSI_PIN;
        buscfg.miso_io_num      = DISPLAY_SPI_MISO_PIN;
        buscfg.sclk_io_num      = DISPLAY_SPI_SCLK_PIN;
        buscfg.quadwp_io_num    = GPIO_NUM_NC;
        buscfg.quadhd_io_num    = GPIO_NUM_NC;
        buscfg.max_transfer_sz  = DISPLAY_WIDTH * DISPLAY_HEIGHT * sizeof(uint16_t);
        ESP_ERROR_CHECK(spi_bus_initialize(DISPLAY_SPI_HOST, &buscfg, SPI_DMA_CH_AUTO));
    }

    void InitializeIli9342Display()
    {
        ESP_LOGI(TAG, "Init IlI9342");

        esp_lcd_panel_io_handle_t panel_io = nullptr;
        esp_lcd_panel_handle_t panel       = nullptr;

        ESP_LOGD(TAG, "Install panel IO");
        esp_lcd_panel_io_spi_config_t io_config = {};
        io_config.cs_gpio_num                   = DISPLAY_PANEL_CS_PIN;
        io_config.dc_gpio_num                   = DISPLAY_PANEL_DC_PIN;
        io_config.spi_mode                      = DISPLAY_SPI_MODE;
        io_config.pclk_hz                       = DISPLAY_PIXEL_CLOCK_HZ;
        io_config.trans_queue_depth             = 10;
        io_config.lcd_cmd_bits                  = 8;
        io_config.lcd_param_bits                = 8;
        ESP_ERROR_CHECK(esp_lcd_new_panel_io_spi(DISPLAY_SPI_HOST, &io_config, &panel_io));

        ESP_LOGD(TAG, "Install LCD driver");
        esp_lcd_panel_dev_config_t panel_config = {};
        panel_config.reset_gpio_num             = GPIO_NUM_NC;
        panel_config.rgb_ele_order              = LCD_RGB_ELEMENT_ORDER_BGR;
        panel_config.bits_per_pixel             = 16;
        ESP_ERROR_CHECK(esp_lcd_new_panel_ili9341(panel_io, &panel_config, &panel));

        esp_lcd_panel_reset(panel);
        aw9523_->ResetIli9342();

        esp_lcd_panel_init(panel);
        esp_lcd_panel_invert_color(panel, true);
        esp_lcd_panel_swap_xy(panel, DISPLAY_SWAP_XY);
        esp_lcd_panel_mirror(panel, DISPLAY_MIRROR_X, DISPLAY_MIRROR_Y);

        // display_ = new StackChanLcdDisplay(panel_io, panel, DISPLAY_WIDTH, DISPLAY_HEIGHT, DISPLAY_OFFSET_X,
        //                                    DISPLAY_OFFSET_Y, DISPLAY_MIRROR_X, DISPLAY_MIRROR_Y, DISPLAY_SWAP_XY);
        display_ = new StackChanAvatarDisplay(panel_io, panel, DISPLAY_WIDTH, DISPLAY_HEIGHT, DISPLAY_OFFSET_X,
                                              DISPLAY_OFFSET_Y, DISPLAY_MIRROR_X, DISPLAY_MIRROR_Y, DISPLAY_SWAP_XY);
        stackchan::hal::hardware::GetHardwareRegistry().set_module_status("display-ili9342", display_ != nullptr,
                                                                           display_ ? "" : "init_failed");
    }

    void InitializeCamera()
    {
        ESP_LOGI(TAG, "Init Camera");
        camera_ = nullptr;

#if CONFIG_ESP_VIDEO_ENABLE_DVP_VIDEO_DEVICE
        static esp_cam_ctlr_dvp_pin_config_t dvp_pin_config = {
            .data_width = CAM_CTLR_DATA_WIDTH_8,
            .data_io =
                {
                    [0] = CAMERA_PIN_D0,
                    [1] = CAMERA_PIN_D1,
                    [2] = CAMERA_PIN_D2,
                    [3] = CAMERA_PIN_D3,
                    [4] = CAMERA_PIN_D4,
                    [5] = CAMERA_PIN_D5,
                    [6] = CAMERA_PIN_D6,
                    [7] = CAMERA_PIN_D7,
                },
            .vsync_io = CAMERA_PIN_VSYNC,
            .de_io    = CAMERA_PIN_HREF,
            .pclk_io  = CAMERA_PIN_PCLK,
            .xclk_io  = CAMERA_PIN_XCLK,
        };

        esp_video_init_sccb_config_t sccb_config = {
            .init_sccb  = false,
            .i2c_handle = i2c_bus_,
            .freq       = CAMERA_SCCB_FREQ_HZ,
        };

        esp_video_init_dvp_config_t dvp_config = {
            .sccb_config = sccb_config,
            .reset_pin   = CAMERA_PIN_RESET,
            .pwdn_pin    = CAMERA_PIN_PWDN,
            .dvp_pin     = dvp_pin_config,
            .xclk_freq   = XCLK_FREQ_HZ,
        };

        esp_video_init_config_t video_config = {
            .dvp = &dvp_config,
        };

        camera_ = new StackChanCamera(video_config);
        camera_->SetHMirror(false);
        stackchan::hal::hardware::GetHardwareRegistry().register_camera(camera_);
        stackchan::hal::hardware::GetHardwareRegistry().set_module_status("camera-gc0308", camera_ != nullptr,
                                                                           camera_ ? "" : "init_failed");
#else
        ESP_LOGW(TAG, "DVP video device support is disabled; camera will be unavailable");
        stackchan::hal::hardware::GetHardwareRegistry().set_module_status("camera-gc0308", false,
                                                                           "dvp_video_disabled");
#endif
    }

public:
    M5StackCoreS3Board()
    {
        stackchan::hal::hardware::GetHardwareRegistry().set_board_name(stackchan::hal::hardware::kStackChanBoardName);
        InitializeI2c();
        InitializeAxp2101();
        InitializePowerSaveTimer();
        InitializeAw9523();
        InitializeSpi();
        InitializeIli9342Display();
        InitializeCamera();
        InitializeFt6336TouchPad();
        GetBacklight()->RestoreBrightness();
    }

    virtual AudioCodec* GetAudioCodec() override
    {
        static CoreS3AudioCodec audio_codec(i2c_bus_, AUDIO_INPUT_SAMPLE_RATE, AUDIO_OUTPUT_SAMPLE_RATE,
                                            AUDIO_I2S_GPIO_MCLK, AUDIO_I2S_GPIO_BCLK, AUDIO_I2S_GPIO_WS,
                                            AUDIO_I2S_GPIO_DOUT, AUDIO_I2S_GPIO_DIN, AUDIO_CODEC_AW88298_ADDR,
                                            AUDIO_CODEC_ES7210_ADDR, AUDIO_INPUT_REFERENCE);
        return &audio_codec;
    }

    virtual Display* GetDisplay() override
    {
        return display_;
    }

    virtual Camera* GetCamera() override
    {
        return camera_;
    }

    void PowerOff()
    {
        pmic_->PowerOff();
    }

    virtual bool GetBatteryLevel(int& level, bool& charging, bool& discharging) override
    {
        charging    = pmic_->IsCharging();
        discharging = pmic_->IsDischarging();
        UpdatePowerSaveEnabled(pmic_->IsExternalPowerConnected(), discharging);

        level = pmic_->GetBatteryLevel();
        return true;
    }

    virtual void SetPowerSaveLevel(PowerSaveLevel level) override
    {
        if (level != PowerSaveLevel::LOW_POWER) {
            power_save_timer_->WakeUp();
        }
        WifiBoard::SetPowerSaveLevel(level);
    }

    virtual Backlight* GetBacklight() override
    {
        static StackChanBacklight backlight(pmic_);
        return &backlight;
    }

    i2c_master_bus_handle_t GetI2cBus()
    {
        return i2c_bus_;
    }
};

DECLARE_BOARD(M5StackCoreS3Board);

i2c_master_bus_handle_t embedded_runtime_bridge::board_get_i2c_bus()
{
    auto bus = stackchan::hal::hardware::GetHardwareRegistry().i2c_bus();
    if (bus) {
        return bus;
    }
    auto& board = (M5StackCoreS3Board&)Board::GetInstance();
    return board.GetI2cBus();
}

StackChanCamera* embedded_runtime_bridge::board_get_camera()
{
    auto camera = stackchan::hal::hardware::GetHardwareRegistry().camera();
    if (camera) {
        return camera;
    }
    auto& board = Board::GetInstance();
    return (StackChanCamera*)board.GetCamera();
}

int embedded_runtime_bridge::board_get_battery_level()
{
    auto& board      = Board::GetInstance();
    int level        = 0;
    bool charging    = false;
    bool discharging = false;
    if (board.GetBatteryLevel(level, charging, discharging)) {
        return level;
    } else {
        return 100;
    }
}

bool embedded_runtime_bridge::board_is_battery_charging()
{
    auto& board      = Board::GetInstance();
    int level        = 0;
    bool charging    = false;
    bool discharging = false;
    if (board.GetBatteryLevel(level, charging, discharging)) {
        return charging;
    } else {
        return false;
    }
}

void embedded_runtime_bridge::board_power_off()
{
    auto& board = (M5StackCoreS3Board&)Board::GetInstance();
    board.PowerOff();
}

void embedded_runtime_bridge::board_set_backlight_brightness(uint8_t brightness, bool permanent)
{
    auto& board    = Board::GetInstance();
    auto backlight = board.GetBacklight();
    if (backlight) {
        backlight->SetBrightness(brightness, false);
        if (permanent) {
            Settings settings("display", true);
            settings.SetInt("brightness", brightness);
        }
    }
}

uint8_t embedded_runtime_bridge::board_get_backlight_brightness()
{
    auto& board    = Board::GetInstance();
    auto backlight = board.GetBacklight();
    if (backlight) {
        return backlight->brightness();
    } else {
        return 0;
    }
}

void embedded_runtime_bridge::board_set_speaker_volume(uint8_t volume, bool permanent)
{
    auto& board      = Board::GetInstance();
    auto audio_codec = board.GetAudioCodec();
    if (audio_codec) {
        Settings settings("audio", false);
        const int persisted_volume = settings.GetInt("output_volume", audio_codec->output_volume());
        audio_codec->SetOutputVolume(volume);
        if (!permanent) {
            Settings writable_settings("audio", true);
            writable_settings.SetInt("output_volume", persisted_volume);
            return;
        }
    }
}

uint8_t embedded_runtime_bridge::board_get_speaker_volume()
{
    int volume = 70;
    Settings settings("audio", false);
    volume = settings.GetInt("output_volume", volume);
    if (volume <= 0) {
        volume = 10;
    }
    return volume;
}
