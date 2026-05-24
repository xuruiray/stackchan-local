/*
 * SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
 *
 * SPDX-License-Identifier: MIT
 */
#include <system/core/clock.h>

#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

namespace stackchan::system {

uint32_t Clock::millis() const
{
    return xTaskGetTickCount() * portTICK_PERIOD_MS;
}

void Clock::delay(uint32_t ms) const
{
    vTaskDelay(pdMS_TO_TICKS(ms));
}

}  // namespace stackchan::system
