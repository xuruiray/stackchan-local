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
#include <string_view>

static const std::string_view _tag = "HardwareStatus";

namespace {

using stackchan::hal::sensors::Ina226;
using stackchan::hal::sensors::IrGpio;
using stackchan::hal::sensors::Ltr553;
using stackchan::hal::sensors::NfcProbe;
using stackchan::hal::sensors::diagnostic_read_reg;
using stackchan::hal::sensors::probe_i2c;

constexpr size_t kMaxI2cScanStages = 8;
constexpr uint32_t kPeripheralRetryIntervalMs = 5000;
constexpr uint32_t kPeripheralRetryScanIntervalMs = 60000;

std::mutex snapshot_mutex;
LocalPeripheralProbeSnapshot snapshot;
std::unique_ptr<Ltr553> ltr553;
std::unique_ptr<Ina226> ina226;
std::unique_ptr<NfcProbe> nfc_probe;
std::unique_ptr<IrGpio> ir_gpio;
uint32_t next_peripheral_retry_ms = 0;
uint32_t next_peripheral_retry_scan_ms = 0;
uint32_t next_ltr553_retry_ms = 0;

void append_address_if_missing(std::vector<uint8_t>& addresses, uint8_t address)
{
    if (std::find(addresses.begin(), addresses.end(), address) == addresses.end()) {
        addresses.push_back(address);
    }
}

void append_registered_address_if_available(std::vector<uint8_t>& addresses, std::string_view module, uint8_t address)
{
    auto status = stackchan::hal::hardware::GetHardwareRegistry().module_status(module);
    if (status.available) {
        append_address_if_missing(addresses, address);
    }
}

void append_known_driver_addresses(std::vector<uint8_t>& addresses)
{
    append_registered_address_if_available(addresses, "camera-gc0308", 0x21);
    append_registered_address_if_available(addresses, "pmic-axp2101", 0x34);
    append_registered_address_if_available(addresses, "touch-ft6336", 0x38);
    append_registered_address_if_available(addresses, "io-expander-aw9523", 0x58);
    append_registered_address_if_available(addresses, "head-touch-si12t", 0x68);
    append_registered_address_if_available(addresses, "imu-bmi270", 0x69);
    append_registered_address_if_available(addresses, "rtc-pcf8563", 0x51);
    append_registered_address_if_available(addresses, "body-io-py32", 0x6f);
    append_registered_address_if_available(addresses, "sensor-ltr553", Ltr553::kAddress);
    append_registered_address_if_available(addresses, "power-monitor-ina226", Ina226::kAddress);
    append_registered_address_if_available(addresses, "nfc-st25r3916", NfcProbe::kAddress);
}

void set_peripheral_module_statuses(const LocalPeripheralProbeSnapshot& snapshot)
{
    auto& registry = stackchan::hal::hardware::GetHardwareRegistry();
    registry.set_module_status("ir-gpio", snapshot.irAvailable, snapshot.irReason);
    registry.set_module_status("sensor-ltr553", snapshot.proximityAvailable || snapshot.ambientLightAvailable,
                               !snapshot.proximityReason.empty() ? snapshot.proximityReason : snapshot.ambientLightReason);
    registry.set_module_status("power-monitor-ina226", snapshot.powerMonitorAvailable, snapshot.powerMonitorReason);
    registry.set_module_status("nfc-st25r3916", snapshot.nfcAvailable, snapshot.nfcReason);
}

bool has_missing_probe_peripherals(const LocalPeripheralProbeSnapshot& snapshot)
{
    return !snapshot.proximityAvailable || !snapshot.ambientLightAvailable || !snapshot.powerMonitorAvailable ||
           !snapshot.nfcAvailable;
}

bool retry_missing_probe_peripherals(LocalPeripheralProbeSnapshot& snapshot, uint32_t now)
{
    if (!has_missing_probe_peripherals(snapshot) || static_cast<int32_t>(now - next_peripheral_retry_ms) < 0) {
        return false;
    }

    next_peripheral_retry_ms = now + kPeripheralRetryIntervalMs;
    bool attempted = false;

    if ((!snapshot.proximityAvailable || !snapshot.ambientLightAvailable) && ltr553) {
        ltr553->init(snapshot);
        attempted = true;
    }
    if (!snapshot.powerMonitorAvailable && ina226) {
        ina226->init(snapshot);
        attempted = true;
    }
    if (!snapshot.nfcAvailable && nfc_probe) {
        nfc_probe->init(snapshot);
        attempted = true;
    }

    if (attempted) {
        set_peripheral_module_statuses(snapshot);
    }
    return attempted;
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

        ir_gpio = std::make_unique<IrGpio>();
        ir_gpio->init(snapshot);

        ltr553 = std::make_unique<Ltr553>(i2c_bus);
        ltr553->init(snapshot);

        ina226 = std::make_unique<Ina226>(i2c_bus);
        ina226->init(snapshot);

        nfc_probe = std::make_unique<NfcProbe>(i2c_bus);
        nfc_probe->init(snapshot);

        set_peripheral_module_statuses(snapshot);
        next_peripheral_retry_ms = millis() + 2000;
        next_ltr553_retry_ms = millis() + 2000;
        next_peripheral_retry_scan_ms = millis() + 10000;
    }
    recordI2cDiagnosticScan("peripheral_probe_done");
}

LocalPeripheralProbeSnapshot DeviceRuntime::getLocalPeripheralProbeSnapshot()
{
    bool retried = false;
    bool scan_retry = false;
    const uint32_t now = millis();
    {
        std::lock_guard<std::mutex> lock(snapshot_mutex);
        LocalPeripheralProbeSnapshot current = snapshot;
        retried = retry_missing_probe_peripherals(current, now);
        if (ltr553) {
            ltr553->refresh(current);
        }
        if (ina226) {
            ina226->refresh(current);
        }
        set_peripheral_module_statuses(current);
        snapshot = current;
        if (retried && static_cast<int32_t>(now - next_peripheral_retry_scan_ms) >= 0) {
            next_peripheral_retry_scan_ms = now + kPeripheralRetryScanIntervalMs;
            scan_retry = true;
        }
    }

    if (scan_retry) {
        recordI2cDiagnosticScan("peripheral_retry");
    }

    std::lock_guard<std::mutex> lock(snapshot_mutex);
    return snapshot;
}

LocalPeripheralProbeSnapshot DeviceRuntime::getLocalLtr553Snapshot()
{
    const uint32_t now = millis();
    {
        std::lock_guard<std::mutex> lock(snapshot_mutex);
        LocalPeripheralProbeSnapshot current = snapshot;
        if ((!current.proximityAvailable || !current.ambientLightAvailable) &&
            static_cast<int32_t>(now - next_ltr553_retry_ms) >= 0 && ltr553) {
            next_ltr553_retry_ms = now + kPeripheralRetryIntervalMs;
            ltr553->init(current);
        }
        if (ltr553) {
            ltr553->refresh(current);
        }
        set_peripheral_module_statuses(current);
        snapshot = current;
        return snapshot;
    }
}

bool DeviceRuntime::pollLocalNfcEvent(LocalNfcEvent& event)
{
    const uint32_t now = millis();
    std::lock_guard<std::mutex> lock(snapshot_mutex);
    if (!nfc_probe) {
        return false;
    }

    const bool has_event = nfc_probe->pollEvent(event, snapshot, now);
    set_peripheral_module_statuses(snapshot);
    return has_event;
}

bool DeviceRuntime::pollLocalIrEvent(LocalIrEvent& event)
{
    const uint32_t now = millis();
    std::lock_guard<std::mutex> lock(snapshot_mutex);
    if (!ir_gpio) {
        return false;
    }

    return ir_gpio->pollEvent(event, now);
}

void DeviceRuntime::recordI2cDiagnosticScan(std::string_view stage)
{
    LocalI2cScanStageSnapshot scan;
    std::snprintf(scan.stage.data(), scan.stage.size(), "%.*s",
                  static_cast<int>(std::min(stage.size(), scan.stage.size() - 1)), stage.data());
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
            0x3A,  // LTR507 alternate address
            0x3B,  // LTR507 alternate address
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

        auto& registry = stackchan::hal::hardware::GetHardwareRegistry();
        const bool ltr_registered = registry.module_status("sensor-ltr553").available;
        const bool ina_registered = registry.module_status("power-monitor-ina226").available;
        uint8_t one_byte = 0;
        uint8_t two_bytes[2] = {};
        const bool ltr_by_read =
            ltr_registered || diagnostic_read_reg(i2c_bus, Ltr553::kAddress, Ltr553::kPartIdRegister, &one_byte, 1);
        const bool ina_by_read =
            ina_registered || diagnostic_read_reg(i2c_bus, Ina226::kAddress, 0x00, two_bytes, sizeof(two_bytes));
        if (ltr_by_read) {
            append_address_if_missing(scan.addresses, Ltr553::kAddress);
        }
        if (ina_by_read) {
            append_address_if_missing(scan.addresses, Ina226::kAddress);
        }
        if (isIoExpanderAvailable()) {
            append_address_if_missing(scan.addresses, 0x6f);
        }
        append_known_driver_addresses(scan.addresses);
        std::sort(scan.addresses.begin(), scan.addresses.end());

        scan.foundLtr553 = ltr_by_read;
        scan.foundIna226 = ina_by_read;
        scan.foundNfc = std::find(scan.addresses.begin(), scan.addresses.end(), NfcProbe::kAddress) != scan.addresses.end();
    }

    std::lock_guard<std::mutex> lock(snapshot_mutex);
    auto& scans = snapshot.i2cScans;
    scans.erase(std::remove_if(scans.begin(), scans.end(),
                               [&scan](const LocalI2cScanStageSnapshot& item) {
                                   return std::string_view(item.stage.data()) == std::string_view(scan.stage.data());
                               }),
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
    mclog::tagInfo(_tag, "i2c scan {}: {}", scan.stage.data(), address_log.empty() ? "none" : address_log.c_str());
}
