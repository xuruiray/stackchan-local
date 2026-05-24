/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include "mic_level_sensor.h"
#include <system/device_runtime.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <esp_heap_caps.h>
#include <mooncake_log.h>
#include <memory>
#include <vector>
#include <board.h>
#include <audio/audio_codec.h>
#include <hardware/board/config.h>

static const std::string_view _tag = "MicLevel";

namespace {

constexpr size_t _mic_test_duration_seconds      = 3;
constexpr size_t _mic_test_playback_chunk_frames = 512;
constexpr size_t _mic_waveform_point_count       = 128;
constexpr size_t _mic_waveform_samples_per_point = 6;
constexpr size_t _mic_waveform_capture_frames    = _mic_waveform_point_count * _mic_waveform_samples_per_point;
constexpr size_t _mic_level_capture_frames       = 768;
constexpr size_t _mic_level_meter_channels       = 1;
constexpr size_t _mic_level_noise_history_size   = 24;
constexpr float _mic_level_min_rms               = 0.000001f;
constexpr float _mic_level_noise_gate_db         = 3.0f;
constexpr float _mic_level_active_span_db        = 18.0f;
bool _mic_level_owns_input                       = false;

struct MicTestFrame {
    int16_t mic;
    int16_t reference;
};

struct MicLevelChannelStats {
    double mean = 0.0;
    double sum_sq = 0.0;
    int32_t peak = 0;
};

float dbfs_from_rms(float rms)
{
    return rms > _mic_level_min_rms ? 20.0f * std::log10(rms) : -96.0f;
}

float calibrated_mic_level(float dbfs)
{
    static std::array<float, _mic_level_noise_history_size> noise_history{};
    static size_t noise_history_count = 0;
    static size_t noise_history_index = 0;
    static float noise_floor_dbfs = -30.0f;
    static float smoothed_level = 0.0f;

    noise_history[noise_history_index] = dbfs;
    noise_history_index = (noise_history_index + 1) % noise_history.size();
    noise_history_count = std::min(noise_history_count + 1, noise_history.size());

    std::array<float, _mic_level_noise_history_size> sorted = noise_history;
    std::sort(sorted.begin(), sorted.begin() + noise_history_count);
    const size_t percentile_index = noise_history_count > 1 ? (noise_history_count - 1) / 4 : 0;
    const float percentile_floor = sorted[percentile_index];

    if (noise_history_count == 1) {
        noise_floor_dbfs = percentile_floor;
    } else {
        const float alpha = noise_history_count < noise_history.size()
                                ? 0.45f
                                : (percentile_floor > noise_floor_dbfs ? 0.12f : 0.3f);
        noise_floor_dbfs = noise_floor_dbfs * (1.0f - alpha) + percentile_floor * alpha;
    }
    noise_floor_dbfs = std::clamp(noise_floor_dbfs, -82.0f, -6.0f);

    const float above_noise = dbfs - noise_floor_dbfs - _mic_level_noise_gate_db;
    const float normalized = std::clamp(above_noise / _mic_level_active_span_db, 0.0f, 1.0f);
    const float target_level = std::pow(normalized, 0.65f);
    const float alpha = target_level > smoothed_level ? 0.55f : 0.2f;
    smoothed_level = std::clamp(smoothed_level * (1.0f - alpha) + target_level * alpha, 0.0f, 1.0f);
    return smoothed_level;
}

}  // namespace

std::string DeviceRuntime::startMicTest(std::function<void(MicTestStatus)> onStatusUpdate)
{
    mclog::tagInfo(_tag, "start mic test");
    onStatusUpdate(MicTestStatus::Starting);

    auto& board      = Board::GetInstance();
    auto audio_codec = board.GetAudioCodec();
    if (!audio_codec) {
        mclog::tagError(_tag, "audio codec unavailable");
        clearupMicTest();
        onStatusUpdate(MicTestStatus::Failed);
        return "audio codec unavailable";
    }

    const size_t total_frames   = AUDIO_INPUT_SAMPLE_RATE * _mic_test_duration_seconds;
    const size_t input_channels = std::max(audio_codec->input_channels(), 1);
    auto* recorded_frames       = static_cast<MicTestFrame*>(
        heap_caps_malloc(total_frames * sizeof(MicTestFrame), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
    if (!recorded_frames) {
        mclog::tagError(_tag, "failed to allocate %u bytes for mic test buffer",
                        static_cast<unsigned>(total_frames * sizeof(MicTestFrame)));
        clearupMicTest();
        onStatusUpdate(MicTestStatus::Failed);
        return "failed to allocate mic test buffer";
    }

    audio_codec->EnableInput(true);
    onStatusUpdate(MicTestStatus::Recording);

    size_t recorded_frame_count = 0;
    std::vector<int16_t> input_chunk;

    while (recorded_frame_count < total_frames) {
        const size_t frames_to_read = std::min(total_frames - recorded_frame_count, _mic_test_playback_chunk_frames);
        input_chunk.resize(frames_to_read * input_channels);
        if (!audio_codec->InputData(input_chunk)) {
            mclog::tagError(_tag, "mic read failed after %u frames", static_cast<unsigned>(recorded_frame_count));
            break;
        }

        for (size_t frame_index = 0; frame_index < frames_to_read; ++frame_index) {
            const size_t sample_index                               = frame_index * input_channels;
            recorded_frames[recorded_frame_count + frame_index].mic = input_chunk[sample_index];
            recorded_frames[recorded_frame_count + frame_index].reference =
                input_channels > 1 ? input_chunk[sample_index + 1] : input_chunk[sample_index];
        }
        recorded_frame_count += frames_to_read;
    }

    audio_codec->EnableInput(false);

    if (recorded_frame_count == 0) {
        mclog::tagError(_tag, "mic test captured no audio");
        heap_caps_free(recorded_frames);
        clearupMicTest();
        onStatusUpdate(MicTestStatus::Failed);
        return "mic test captured no audio";
    }

    audio_codec->EnableOutput(true);
    onStatusUpdate(MicTestStatus::Playing);

    std::array<int16_t, _mic_test_playback_chunk_frames> playback_chunk{};
    std::vector<int16_t> output_chunk;
    output_chunk.reserve(_mic_test_playback_chunk_frames);
    size_t played_frames = 0;
    while (played_frames < recorded_frame_count) {
        const size_t frames_to_write = std::min(recorded_frame_count - played_frames, playback_chunk.size());
        for (size_t i = 0; i < frames_to_write; ++i) {
            playback_chunk[i] = recorded_frames[played_frames + i].mic;
        }

        output_chunk.assign(playback_chunk.begin(), playback_chunk.begin() + frames_to_write);
        audio_codec->OutputData(output_chunk);
        played_frames += frames_to_write;
    }

    heap_caps_free(recorded_frames);
    clearupMicTest();
    onStatusUpdate(MicTestStatus::Done);
    return {};
}

void DeviceRuntime::getMicWaveformFrame(std::vector<int16_t>& data)
{
    data.assign(_mic_waveform_point_count, 0);

    auto& board      = Board::GetInstance();
    auto audio_codec = board.GetAudioCodec();
    if (!audio_codec) {
        mclog::tagError(_tag, "audio codec unavailable for waveform capture");
        return;
    }

    const size_t input_channels = std::max(audio_codec->input_channels(), 1);
    std::vector<int16_t> input_chunk(_mic_waveform_capture_frames * input_channels);
    if (!audio_codec->input_enabled()) {
        audio_codec->EnableInput(true);
    }

    const bool read_ok = audio_codec->InputData(input_chunk);

    if (!read_ok) {
        mclog::tagError(_tag, "mic waveform capture failed");
        return;
    }

    for (size_t point_index = 0; point_index < _mic_waveform_point_count; ++point_index) {
        int16_t selected_sample = 0;
        int32_t peak_magnitude  = -1;

        for (size_t sample_offset = 0; sample_offset < _mic_waveform_samples_per_point; ++sample_offset) {
            const size_t frame_index = point_index * _mic_waveform_samples_per_point + sample_offset;
            const int16_t sample     = input_chunk[frame_index * input_channels];
            const int32_t magnitude  = std::abs(static_cast<int32_t>(sample));
            if (magnitude > peak_magnitude) {
                peak_magnitude  = magnitude;
                selected_sample = sample;
            }
        }

        data[point_index] = selected_sample;
    }
}

LocalMicLevelSnapshot DeviceRuntime::getMicLevelSnapshot()
{
    LocalMicLevelSnapshot snapshot;

    auto& board      = Board::GetInstance();
    auto audio_codec = board.GetAudioCodec();
    if (!audio_codec) {
        snapshot.reason = "audio_codec_unavailable";
        return snapshot;
    }

    const size_t input_channels = std::max(audio_codec->input_channels(), 1);
    constexpr size_t measured_channels = _mic_level_meter_channels;
    constexpr size_t capture_frames = _mic_level_capture_frames;
    std::vector<int16_t> input_chunk(capture_frames * input_channels);

    const bool was_input_enabled = audio_codec->input_enabled();
    if (!was_input_enabled) {
        audio_codec->EnableInput(true);
        _mic_level_owns_input = true;
        // The first DMA read after opening the ES7210 input often contains startup bias.
        audio_codec->InputData(input_chunk);
    }

    const bool read_ok = audio_codec->InputData(input_chunk);

    // Keep the input path open for the 1 Hz level meter. Reopening ES7210 on
    // every sensor snapshot causes I2S disable warnings and noisy level spikes.

    snapshot.channels = static_cast<uint8_t>(std::min<size_t>(input_channels, 2));
    snapshot.updatedAt = GetDeviceRuntime().millis();

    if (!read_ok) {
        snapshot.available = false;
        snapshot.reason = "capture_failed";
        if (_mic_level_owns_input && audio_codec->input_enabled()) {
            audio_codec->EnableInput(false);
            _mic_level_owns_input = false;
        }
        return snapshot;
    }

    snapshot.available = true;

    std::array<MicLevelChannelStats, _mic_level_meter_channels> stats{};
    for (size_t frame_index = 0; frame_index < capture_frames; ++frame_index) {
        for (size_t channel = 0; channel < measured_channels; ++channel) {
            stats[channel].mean += input_chunk[frame_index * input_channels + channel];
        }
    }
    for (size_t channel = 0; channel < measured_channels; ++channel) {
        stats[channel].mean /= static_cast<double>(capture_frames);
    }

    float selected_rms = 0.0f;
    float selected_peak = 0.0f;
    for (size_t frame_index = 0; frame_index < capture_frames; ++frame_index) {
        for (size_t channel = 0; channel < measured_channels; ++channel) {
            const double centered =
                static_cast<double>(input_chunk[frame_index * input_channels + channel]) - stats[channel].mean;
            const int32_t magnitude = std::abs(static_cast<int32_t>(std::lround(centered)));
            stats[channel].peak = std::max(stats[channel].peak, magnitude);
            const double normalized = centered / 32768.0;
            stats[channel].sum_sq += normalized * normalized;
        }
    }

    for (size_t channel = 0; channel < measured_channels; ++channel) {
        const float rms = static_cast<float>(std::sqrt(stats[channel].sum_sq / static_cast<double>(capture_frames)));
        if (rms >= selected_rms) {
            selected_rms = rms;
            selected_peak = static_cast<float>(stats[channel].peak) / 32768.0f;
        }
    }

    const float dbfs = dbfs_from_rms(selected_rms);
    snapshot.rms = std::clamp(selected_rms, 0.0f, 1.0f);
    snapshot.peak = std::clamp(selected_peak, 0.0f, 1.0f);
    snapshot.dbfs = std::max(-96.0f, std::min(0.0f, dbfs));
    snapshot.level = calibrated_mic_level(snapshot.dbfs);
    return snapshot;
}

void DeviceRuntime::releaseMicLevelInput()
{
    auto& board      = Board::GetInstance();
    auto audio_codec = board.GetAudioCodec();
    if (!audio_codec) {
        _mic_level_owns_input = false;
        return;
    }

    if (_mic_level_owns_input && audio_codec->input_enabled()) {
        audio_codec->EnableInput(false);
    }
    _mic_level_owns_input = false;
}

void DeviceRuntime::clearupMicTest()
{
    auto& board      = Board::GetInstance();
    auto audio_codec = board.GetAudioCodec();
    if (!audio_codec) {
        return;
    }

    if (audio_codec->output_enabled()) {
        audio_codec->EnableOutput(false);
    }

    if (audio_codec->input_enabled()) {
        audio_codec->EnableInput(false);
    }
    _mic_level_owns_input = false;
}
