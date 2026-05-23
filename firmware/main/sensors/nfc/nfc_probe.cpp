/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include "nfc_probe.h"

#include <hardware/i2c/i2c_bus.h>

namespace stackchan::hal::sensors {

void NfcProbe::init(LocalPeripheralProbeSnapshot& snapshot)
{
    snapshot.nfcDriver = "st25r3916-probe";
    snapshot.nfcAddress = kAddress;
    snapshot.nfcAvailable = probe_i2c(bus_, kAddress);
    snapshot.nfcStatus = snapshot.nfcAvailable ? "chip_detected" : "";
    snapshot.nfcReason = snapshot.nfcAvailable ? "" : "not_detected_i2c_0x50";
}

}  // namespace stackchan::hal::sensors
