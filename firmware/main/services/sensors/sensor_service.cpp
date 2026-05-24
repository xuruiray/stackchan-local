/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include <system/device_runtime.h>

#include <hardware/registry.h>
#include <hardware/bus/i2c_bus.h>
#include <hardware/sensors/ina226/ina226_sensor.h>
#include <hardware/sensors/ir/ir_sensor.h>
#include <hardware/sensors/ltr553/ltr553_sensor.h>
#include <hardware/sensors/nfc/nfc_probe.h>

#include <algorithm>
#include <cstdio>
#include <memory>
#include <mooncake_log.h>
#include <mutex>

static const std::string_view _tag = "SensorSnapshot";

namespace {

using stackchan::hal::sensors::diagnostic_read_reg;
using stackchan::hal::sensors::diagnostic_write_ping;
using stackchan::hal::sensors::Ina226;
using stackchan::hal::sensors::IrGpio;
using stackchan::hal::sensors::Ltr553;
using stackchan::hal::sensors::NfcProbe;
using stackchan::hal::sensors::probe_i2c;

constexpr size_t kMaxI2cScanStages = 8;

std::mutex snapshot_mutex;
LocalPeripheralProbeSnapshot snapshot;
std::unique_ptr<Ltr553> ltr553;
std::unique_ptr<Ina226> ina226;
std::unique_ptr<NfcProbe> nfc_probe;

void append_address_if_missing(std::vector<uint8_t>& addresses, uint8_t address)
{
    if (std::find(addresses.begin(), addresses.end(), address) == addresses.end()) {
        addresses.push_back(address);
    }
}

}  // namespace

void DeviceRuntime::peripheral_probe_init()
{
    mclog::tagInfo(_tag, "init");
    auto i2c_bus = stackchan::hal::hardware::GetHardwareRegistry().i2c_bus();

    recordI2cDiagnosticScan("peripheral_probe_start");
    {
        std::lock_guard<std::mutex> lock(snapshot_mutex);
        snapshot = LocalPeripheralProbeSnapshot();

        IrGpio().init(snapshot);

        ltr553 = std::make_unique<Ltr553>(i2c_bus);
        ltr553->init(snapshot);

        ina226 = std::make_unique<Ina226>(i2c_bus);
        ina226->init(snapshot);

        nfc_probe = std::make_unique<NfcProbe>(i2c_bus);
        nfc_probe->init(snapshot);
    }
    recordI2cDiagnosticScan("peripheral_probe_done");
}

LocalPeripheralProbeSnapshot DeviceRuntime::getLocalPeripheralProbeSnapshot()
{
    std::lock_guard<std::mutex> lock(snapshot_mutex);
    LocalPeripheralProbeSnapshot current = snapshot;
    if (ltr553) {
        ltr553->refresh(current);
    }
    if (ina226) {
        ina226->refresh(current);
    }
    snapshot = current;
    return current;
}

void DeviceRuntime::recordI2cDiagnosticScan(std::string_view stage)
{
    LocalI2cScanStageSnapshot scan;
    scan.stage = std::string(stage);
    scan.uptimeMs = millis();

    auto i2c_bus = stackchan::hal::hardware::GetHardwareRegistry().i2c_bus();
    if (!i2c_bus) {
        scan.reason = "i2c_bus_unavailable";
    } else {
        static constexpr uint8_t kDiagnosticAddresses[] = {
            0x21,  // GC0308 camera control
            Ltr553::kAddress,
            0x34,  // AXP2101 PMIC
            0x36,  // AW88298 audio amp
            0x38,  // FT6336 touch
            0x40,  // ES7210 audio ADC
            Ina226::kAddress,
            NfcProbe::kAddress,
            0x51,  // BM8563 RTC
            0x58,  // AW9523 CoreS3 IO expander
            0x68,  // Si12T head touch
            0x69,  // BMI270 IMU
            0x6f,  // PY32 StackChan body IO expander
            0x71,  // PY32 alternate ADD_SEL address
        };
        for (const auto address : kDiagnosticAddresses) {
            if (probe_i2c(i2c_bus, address)) {
                append_address_if_missing(scan.addresses, address);
            }
        }

        uint8_t one_byte = 0;
        uint8_t two_bytes[2] = {};
        const bool py32_by_read = diagnostic_read_reg(i2c_bus, 0x6f, 0x02, &one_byte, 1);
        const bool ltr_by_read = diagnostic_read_reg(i2c_bus, Ltr553::kAddress, Ltr553::kPartIdRegister, &one_byte, 1);
        const bool ina_by_read = diagnostic_read_reg(i2c_bus, Ina226::kAddress, 0x00, two_bytes, sizeof(two_bytes));
        const bool nfc_by_ping = diagnostic_write_ping(i2c_bus, NfcProbe::kAddress, 0x00);
        if (py32_by_read || isIoExpanderAvailable()) {
            append_address_if_missing(scan.addresses, 0x6f);
        }
        if (ltr_by_read) {
            append_address_if_missing(scan.addresses, Ltr553::kAddress);
        }
        if (ina_by_read) {
            append_address_if_missing(scan.addresses, Ina226::kAddress);
        }
        if (nfc_by_ping) {
            append_address_if_missing(scan.addresses, NfcProbe::kAddress);
        }
        std::sort(scan.addresses.begin(), scan.addresses.end());

        scan.foundLtr553 = std::find(scan.addresses.begin(), scan.addresses.end(), Ltr553::kAddress) != scan.addresses.end();
        scan.foundIna226 = std::find(scan.addresses.begin(), scan.addresses.end(), Ina226::kAddress) != scan.addresses.end();
        scan.foundNfc = std::find(scan.addresses.begin(), scan.addresses.end(), NfcProbe::kAddress) != scan.addresses.end();
    }

    std::lock_guard<std::mutex> lock(snapshot_mutex);
    auto& scans = snapshot.i2cScans;
    scans.erase(std::remove_if(scans.begin(), scans.end(),
                               [&scan](const LocalI2cScanStageSnapshot& item) { return item.stage == scan.stage; }),
                scans.end());
    scans.push_back(scan);
    if (scans.size() > kMaxI2cScanStages) {
        scans.erase(scans.begin(), scans.begin() + static_cast<long>(scans.size() - kMaxI2cScanStages));
    }

    std::string address_log;
    for (const auto address : scan.addresses) {
        char chunk[8];
        snprintf(chunk, sizeof(chunk), "%s0x%02x", address_log.empty() ? "" : " ", address);
        address_log += chunk;
    }
    mclog::tagInfo(_tag, "i2c scan {}: {}", scan.stage.c_str(), address_log.empty() ? "none" : address_log.c_str());
}
