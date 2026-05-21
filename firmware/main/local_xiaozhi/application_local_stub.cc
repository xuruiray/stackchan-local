#include "application.h"

#include "board.h"
#include "display.h"
#include "hal/board/hal_bridge.h"

#include <esp_log.h>
#include <esp_system.h>

static const char* TAG = "LocalApplicationStub";

Application::Application()
{
    state_machine_.TransitionTo(kDeviceStateStarting);
    state_machine_.TransitionTo(kDeviceStateActivating);
    state_machine_.TransitionTo(kDeviceStateIdle);
}

Application::~Application() = default;

void Application::Initialize()
{
    ESP_LOGI(TAG, "legacy cloud application initialize ignored in StackChan Local");
}

void Application::Run()
{
    ESP_LOGW(TAG, "legacy cloud application run ignored in StackChan Local");
}

bool Application::SetDeviceState(DeviceState state)
{
    return state_machine_.TransitionTo(state);
}

void Application::Schedule(std::function<void()>&& callback)
{
    if (callback) {
        callback();
    }
}

void Application::Alert(const char* status, const char* message, const char* emotion, const std::string_view& sound)
{
    (void)emotion;
    if (!sound.empty()) {
        hal_bridge::app_play_sound(sound);
    }

    auto* display = Board::GetInstance().GetDisplay();
    if (display != nullptr) {
        display->ShowNotification((message != nullptr && message[0] != '\0') ? message : status);
    }
}

void Application::DismissAlert()
{
}

void Application::AbortSpeaking(AbortReason reason)
{
    (void)reason;
}

void Application::ToggleChatState()
{
}

void Application::StartListening()
{
}

void Application::StopListening()
{
}

void Application::Reboot()
{
    esp_restart();
}

void Application::WakeWordInvoke(const std::string& wake_word)
{
    ESP_LOGI(TAG, "wake word ignored by legacy cloud stub: %s", wake_word.c_str());
}

bool Application::UpgradeFirmware(const std::string& url, const std::string& version)
{
    (void)url;
    (void)version;
    ESP_LOGW(TAG, "legacy cloud firmware upgrade is disabled in StackChan Local");
    return false;
}

bool Application::CanEnterSleepMode()
{
    return true;
}

void Application::SendMcpMessage(const std::string& payload)
{
    (void)payload;
}

void Application::SetAecMode(AecMode mode)
{
    aec_mode_ = mode;
}

void Application::PlaySound(const std::string_view& sound)
{
    hal_bridge::app_play_sound(sound);
}

void Application::ResetProtocol()
{
    protocol_.reset();
    ota_.reset();
}

Ota::Ota() = default;

Ota::~Ota() = default;
