/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once
#include "../avatar/decorators/decorators.h"
#include "../modifiable.h"
#include <system/device_runtime.h>
#include <cstdint>
#include <memory>
#include <string_view>

namespace stackchan {

enum class ExpressionPreset {
    Neutral,
    Happy,
    Laughing,
    Love,
    Sad,
    Crying,
    Angry,
    Thinking,
    Surprised,
    Sleepy,
    Doubtful,
};

inline ExpressionPreset expression_preset_from_string(std::string_view emotion)
{
    if (emotion == "happy") {
        return ExpressionPreset::Happy;
    }
    if (emotion == "laughing") {
        return ExpressionPreset::Laughing;
    }
    if (emotion == "love") {
        return ExpressionPreset::Love;
    }
    if (emotion == "sad") {
        return ExpressionPreset::Sad;
    }
    if (emotion == "crying") {
        return ExpressionPreset::Crying;
    }
    if (emotion == "angry") {
        return ExpressionPreset::Angry;
    }
    if (emotion == "thinking") {
        return ExpressionPreset::Thinking;
    }
    if (emotion == "surprised") {
        return ExpressionPreset::Surprised;
    }
    if (emotion == "sleepy") {
        return ExpressionPreset::Sleepy;
    }
    if (emotion == "doubtful") {
        return ExpressionPreset::Doubtful;
    }
    return ExpressionPreset::Neutral;
}

inline avatar::Emotion base_emotion_for_preset(ExpressionPreset preset)
{
    switch (preset) {
        case ExpressionPreset::Happy:
        case ExpressionPreset::Laughing:
        case ExpressionPreset::Love:
            return avatar::Emotion::Happy;
        case ExpressionPreset::Sad:
        case ExpressionPreset::Crying:
            return avatar::Emotion::Sad;
        case ExpressionPreset::Angry:
            return avatar::Emotion::Angry;
        case ExpressionPreset::Thinking:
        case ExpressionPreset::Surprised:
        case ExpressionPreset::Doubtful:
            return avatar::Emotion::Doubt;
        case ExpressionPreset::Sleepy:
            return avatar::Emotion::Sleepy;
        case ExpressionPreset::Neutral:
        default:
            return avatar::Emotion::Neutral;
    }
}

class ExpressionPresetModifier : public Modifier {
public:
    ExpressionPresetModifier(ExpressionPreset preset, uint32_t durationMs, bool allowMotion, int restoreYaw,
                             int restorePitch, avatar::Emotion restoreEmotion = avatar::Emotion::Neutral)
        : _preset(preset),
          _duration_ms(durationMs < 100 ? 100 : durationMs),
          _allow_motion(allowMotion),
          _restore_yaw(restoreYaw),
          _restore_pitch(restorePitch),
          _restore_emotion(restoreEmotion)
    {
    }

    void finish(Modifiable& stackchan, bool restoreMotion = true, bool restoreRgb = true)
    {
        if (!_started || _finished) {
            requestDestroy();
            return;
        }

        _finished = true;
        if (stackchan.hasAvatar()) {
            auto& avatar = stackchan.avatar();
            avatar.clearDecorators();
            avatar.clearSpeech();
            reset_face(avatar);
            avatar.setEmotion(_restore_emotion);
            avatar.setModifyLock(_prev_avatar_lock);
        }

        if (_allow_motion) {
            if (restoreMotion) {
                stackchan.motion().moveWithSpeed(_restore_yaw, _restore_pitch, 220);
            }
            stackchan.motion().setModifyLock(_prev_motion_lock);
        }

        if (restoreRgb) {
            set_rgb(stackchan, "#000000", 0.2f);
        }
        requestDestroy();
    }

    void _update(Modifiable& stackchan) override
    {
        const uint32_t now = GetDeviceRuntime().millis();
        if (!_started) {
            _started    = true;
            _start_time = now;
            on_start(stackchan);
        }

        if (now - _start_time >= _duration_ms) {
            finish(stackchan);
            return;
        }

        apply_phase(stackchan, now - _start_time);
    }

private:
    void on_start(Modifiable& stackchan)
    {
        if (stackchan.hasAvatar()) {
            auto& avatar = stackchan.avatar();
            _prev_avatar_lock = avatar.isModifyLocked();
            avatar.setModifyLock(true);
            avatar.clearDecorators();
            reset_face(avatar);
            avatar.setEmotion(base_emotion_for_preset(_preset));
            apply_face(avatar);
            apply_decorators(avatar);
        }

        _prev_motion_lock = stackchan.motion().isModifyLocked();
        if (_allow_motion) {
            stackchan.motion().setModifyLock(true);
        }

        apply_rgb(stackchan);
        apply_phase(stackchan, 0);
    }

    void reset_face(avatar::Avatar& avatar)
    {
        reset_feature(avatar.leftEye(), 100);
        reset_feature(avatar.rightEye(), 100);
        reset_feature(avatar.mouth(), 0);
    }

    void reset_feature(avatar::Feature& feature, int weight)
    {
        feature.setPosition({0, 0});
        feature.setRotation(0);
        feature.setWeight(weight);
        feature.setSize(0);
    }

    void set_feature(avatar::Feature& feature, int x, int y, int rotation, int weight, int size = 0)
    {
        feature.setPosition({x, y});
        feature.setRotation(rotation);
        feature.setWeight(weight);
        feature.setSize(size);
    }

    void apply_face(avatar::Avatar& avatar)
    {
        switch (_preset) {
            case ExpressionPreset::Happy:
                set_feature(avatar.mouth(), 0, 0, 0, 34);
                return;
            case ExpressionPreset::Laughing:
                set_feature(avatar.leftEye(), -6, -3, 1550, 46);
                set_feature(avatar.rightEye(), 6, -3, -1550, 46);
                set_feature(avatar.mouth(), 0, 2, 0, 78);
                return;
            case ExpressionPreset::Love:
                set_feature(avatar.leftEye(), -4, -2, 1550, 52);
                set_feature(avatar.rightEye(), 4, -2, -1550, 52);
                set_feature(avatar.mouth(), 0, 0, 0, 48);
                return;
            case ExpressionPreset::Sad:
                set_feature(avatar.leftEye(), 0, 5, -400, 62);
                set_feature(avatar.rightEye(), 0, 5, 400, 62);
                set_feature(avatar.mouth(), 0, 11, 1800, 18);
                return;
            case ExpressionPreset::Crying:
                set_feature(avatar.leftEye(), -3, 9, -520, 45);
                set_feature(avatar.rightEye(), 3, 9, 520, 45);
                set_feature(avatar.mouth(), 0, 14, 1800, 30);
                return;
            case ExpressionPreset::Angry:
                set_feature(avatar.leftEye(), -2, -2, 520, 54);
                set_feature(avatar.rightEye(), 2, -2, -520, 54);
                set_feature(avatar.mouth(), 0, 8, 1800, 16);
                return;
            case ExpressionPreset::Thinking:
                set_feature(avatar.leftEye(), -10, -5, 250, 70);
                set_feature(avatar.rightEye(), 7, 4, -120, 84);
                set_feature(avatar.mouth(), -8, 8, 3500, 14);
                avatar.setSpeech("...");
                return;
            case ExpressionPreset::Surprised:
                set_feature(avatar.leftEye(), -2, -7, 0, 100, 22);
                set_feature(avatar.rightEye(), 2, -7, 0, 100, 22);
                set_feature(avatar.mouth(), 0, -1, 0, 92);
                return;
            case ExpressionPreset::Sleepy:
                set_feature(avatar.leftEye(), 0, 7, -50, 28);
                set_feature(avatar.rightEye(), 0, 7, 50, 28);
                set_feature(avatar.mouth(), 0, 9, 0, 8);
                avatar.setSpeech("Zzz...");
                return;
            case ExpressionPreset::Doubtful:
                set_feature(avatar.leftEye(), -7, -1, 180, 72);
                set_feature(avatar.rightEye(), 8, 4, -180, 86);
                set_feature(avatar.mouth(), -8, 8, 3500, 12);
                return;
            case ExpressionPreset::Neutral:
            default:
                set_feature(avatar.mouth(), 0, 0, 0, 0);
                return;
        }
    }

    void apply_decorators(avatar::Avatar& avatar)
    {
        const uint32_t lifetime_ms = _duration_ms > 200 ? _duration_ms - 100 : _duration_ms;
        switch (_preset) {
            case ExpressionPreset::Love:
                avatar.addDecorator(std::make_unique<avatar::HeartDecorator>(lv_screen_active(), lifetime_ms, 360));
                avatar.addDecorator(std::make_unique<avatar::ShyDecorator>(lv_screen_active(), lifetime_ms));
                return;
            case ExpressionPreset::Angry:
                avatar.addDecorator(std::make_unique<avatar::AngryDecorator>(lv_screen_active(), lifetime_ms, 260));
                return;
            case ExpressionPreset::Crying:
                avatar.addDecorator(std::make_unique<avatar::SweatDecorator>(lv_screen_active(), lifetime_ms, 520));
                return;
            case ExpressionPreset::Surprised:
                avatar.addDecorator(std::make_unique<avatar::SweatDecorator>(lv_screen_active(), lifetime_ms, 360));
                return;
            default:
                return;
        }
    }

    void apply_rgb(Modifiable& stackchan)
    {
        switch (_preset) {
            case ExpressionPreset::Happy:
            case ExpressionPreset::Laughing:
                set_rgb(stackchan, "#FFD34D", 0.12f);
                return;
            case ExpressionPreset::Love:
                set_rgb(stackchan, "#FF6FB3", 0.12f);
                return;
            case ExpressionPreset::Sad:
            case ExpressionPreset::Crying:
                set_rgb(stackchan, "#4D8DFF", 0.16f);
                return;
            case ExpressionPreset::Angry:
                set_rgb(stackchan, "#FF3838", 0.08f);
                return;
            case ExpressionPreset::Thinking:
            case ExpressionPreset::Doubtful:
                set_rgb(stackchan, "#5D8CFF", 0.16f);
                return;
            case ExpressionPreset::Surprised:
                set_rgb(stackchan, "#4DE6FF", 0.08f);
                return;
            case ExpressionPreset::Sleepy:
                set_rgb(stackchan, "#7A5CFF", 0.2f);
                return;
            case ExpressionPreset::Neutral:
            default:
                set_rgb(stackchan, "#000000", 0.2f);
                return;
        }
    }

    void set_rgb(Modifiable& stackchan, std::string_view hex, float durationSec)
    {
        stackchan.leftNeonLight().setDuration(durationSec);
        stackchan.rightNeonLight().setDuration(durationSec);
        stackchan.leftNeonLight().setColor(hex);
        stackchan.rightNeonLight().setColor(hex);
    }

    void apply_phase(Modifiable& stackchan, uint32_t elapsedMs)
    {
        if (!_allow_motion) {
            return;
        }

        uint8_t next_phase = 0;
        if (elapsedMs > 900) {
            next_phase = 3;
        } else if (elapsedMs > 560) {
            next_phase = 2;
        } else if (elapsedMs > 260) {
            next_phase = 1;
        }
        if (next_phase == _phase) {
            return;
        }
        _phase = next_phase;

        switch (_preset) {
            case ExpressionPreset::Happy:
                move_relative(stackchan, _phase == 1 ? 90 : 0, _phase == 2 ? -40 : 0, 260);
                return;
            case ExpressionPreset::Laughing:
                if (stackchan.hasAvatar()) {
                    stackchan.avatar().mouth().setWeight(_phase % 2 == 0 ? 78 : 56);
                }
                move_relative(stackchan, _phase % 2 == 0 ? -120 : 120, _phase == 2 ? -70 : 20, 420);
                return;
            case ExpressionPreset::Love:
                move_relative(stackchan, _phase % 2 == 0 ? -140 : 140, -40, 260);
                return;
            case ExpressionPreset::Sad:
            case ExpressionPreset::Crying:
                move_relative(stackchan, 0, 130, 180);
                return;
            case ExpressionPreset::Angry:
                move_relative(stackchan, _phase % 2 == 0 ? -140 : 140, 60, 520);
                return;
            case ExpressionPreset::Thinking:
            case ExpressionPreset::Doubtful:
                move_relative(stackchan, _phase < 2 ? -180 : 120, 80, 220);
                return;
            case ExpressionPreset::Surprised:
                move_relative(stackchan, _phase == 0 ? 0 : (_phase % 2 == 0 ? -90 : 90), -130, 620);
                return;
            case ExpressionPreset::Sleepy:
                move_relative(stackchan, 0, 170, 150);
                return;
            case ExpressionPreset::Neutral:
            default:
                move_relative(stackchan, 0, 0, 240);
                return;
        }
    }

    void move_relative(Modifiable& stackchan, int yawOffset, int pitchOffset, int speed)
    {
        stackchan.motion().moveWithSpeed(_restore_yaw + yawOffset, _restore_pitch + pitchOffset, speed);
    }

    ExpressionPreset _preset;
    uint32_t _duration_ms;
    bool _allow_motion;
    int _restore_yaw;
    int _restore_pitch;
    avatar::Emotion _restore_emotion;

    bool _started = false;
    bool _finished = false;
    uint32_t _start_time = 0;
    uint8_t _phase = 255;
    bool _prev_avatar_lock = false;
    bool _prev_motion_lock = false;
};

}  // namespace stackchan
